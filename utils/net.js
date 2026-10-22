import os from "os"
import { AsyncLocalStorage } from "node:async_hooks"
import { acceptLanguage, minRequestInterval, rateLimitThreshold, treat403AsRateLimit, userAgent } from "../config.js"
import { printGreen, printRed, printYellow } from "./colorOut.js"

// 咪咕域名，用于识别需要限流的请求
const MIGU_HOST_RE = /(^|\.)miguvideo\.com$/i

// 统一请求头，尽量贴近真实客户端
// User-Agent 留空时保持 Node 默认值，但会被风控识别为自动化请求
const baseHeaders = {
  Accept: "application/json, text/plain, */*",
}
if (userAgent) {
  baseHeaders["User-Agent"] = userAgent
}
if (acceptLanguage) {
  baseHeaders["Accept-Language"] = acceptLanguage
}

// 连续被限流的次数，达到阈值后熔断，避免把软限流打成 IP 封禁
let consecutiveRateLimit = 0
// 熔断开始的时间，用于冷却期结束后恢复服务
let rateLimitTrippedAt = 0
// 是否已放行试探：熔断期间最多只允许一个探针请求打到上游
let probeInFlight = false
// 试探上下文：用 AsyncLocalStorage 把「本次请求是探针」传递到深层调用，
// 避免为了透传一个标志而改动 getAndroidURL / getAndroidURL720p 等所有函数签名
const probeContext = new AsyncLocalStorage()
// 上一次发起请求的时间，用于计算请求间隔
let lastRequestTime = 0
// 节流串行链，保证同一时刻只有一个请求在等待间隔
let throttleChain = Promise.resolve()

/**
 * 脱敏 URL，只保留协议、主机名和路径，去掉查询参数
 * 播放地址的签名参数属于需要脱敏的内容，不能进日志
 * @param {string} url - 请求地址
 * @returns {string} - 脱敏后的地址
 */
function sanitizeURL(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch (error) {
    return "<无效地址>"
  }
}

/**
 * 限流错误，调用方捕获后应中止本轮抓取而不是继续重试
 * message 使用脱敏地址，完整地址保留在 url 字段供内部判断
 */
class RateLimitError extends Error {
  constructor(status, url) {
    super(`请求被限流: ${status} ${sanitizeURL(url)}`)
    this.name = "RateLimitError"
    this.status = status
    this.url = url
  }
}

/**
 * 判断是否为咪咕域名
 * @param {string} url - 请求地址
 * @returns {boolean} - 是否属于咪咕域名
 */
function isMiguURL(url) {
  try {
    return MIGU_HOST_RE.test(new URL(url).hostname)
  } catch (error) {
    return false
  }
}

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * 全局限流，串行执行并保证相邻请求的最小间隔
 * @param {string} url - 请求地址
 * @returns {Promise<void>}
 */
async function throttle(url) {
  if (!isMiguURL(url)) {
    return
  }
  // 非法配置时退化为 400 毫秒
  const interval = Number.isFinite(minRequestInterval) && minRequestInterval >= 0
    ? minRequestInterval
    : 400
  const task = throttleChain.then(async () => {
    const elapsed = Date.now() - lastRequestTime
    if (elapsed < interval) {
      await wait(interval - elapsed)
    }
    lastRequestTime = Date.now()
  })
  // 失败不能污染后续链路
  throttleChain = task.catch(() => { })
  return task
}

/**
 * 是否已经触发熔断
 * @returns {boolean} - 是否需要停止抓取
 */
function isRateLimited() {
  return rateLimitThreshold > 0 && consecutiveRateLimit >= rateLimitThreshold
}

/**
 * 熔断是否已过冷却期
 * 冷却期内的请求直接拒绝，冷却期后放行一次试探，仍被限流则重新计时
 * @param {number} cooldownMs - 冷却时长，单位毫秒
 * @returns {boolean} - 是否可以尝试恢复
 */
function canRecover(cooldownMs) {
  return isRateLimited() && Date.now() - rateLimitTrippedAt >= cooldownMs
}

/**
 * 重置限流计数，新一轮任务开始时调用
 */
function resetRateLimit() {
  consecutiveRateLimit = 0
  rateLimitTrippedAt = 0
}

/**
 * 是否应放行一次探针请求
 * 冷却期未到、已有探针在途、或并未处于熔断状态时返回 false
 * @param {number} cooldownMs - 冷却时长，单位毫秒
 * @returns {boolean} - 是否放行探针
 */
function shouldProbe(cooldownMs) {
  if (!isRateLimited() || probeInFlight) {
    return false
  }
  return Date.now() - rateLimitTrippedAt >= cooldownMs
}

/**
 * 在试探上下文中执行任务
 * 该上下文内的所有 miguFetch 都会允许穿过熔断打到上游，
 * 并根据真实响应结果决定恢复或重新计时
 * @param {Function} task - 要执行的任务
 * @returns {Promise<any>} - 任务返回值
 */
async function runProbe(task) {
  if (probeInFlight) {
    throw new Error("已有探针请求在途")
  }
  probeInFlight = true
  let resolved = false
  const probe = {
    enabled: true,
    onResult: (success) => {
      resolved = true
      if (success) {
        resetRateLimit()
        printGreen("探针收到成功响应，熔断解除")
      } else {
        // 保持熔断并重新计时，避免立即再次试探
        rateLimitTrippedAt = Date.now()
        printYellow("探针未获得成功响应，熔断继续")
      }
    },
  }
  try {
    return await probeContext.run(probe, task)
  } finally {
    probeInFlight = false
    // 探针没有拿到任何响应（网络错误、超时、本地异常）：保持原冷却时间
    if (!resolved) {
      printYellow("探针未收到上游响应，保持原冷却时间")
    }
  }
}

/**
 * 获取当前连续限流次数
 * @returns {number} - 连续限流次数
 */
function getRateLimitCount() {
  return consecutiveRateLimit
}

/**
 * 发起一次请求，自动附加统一请求头与节流
 * 429 及（可配置的）403 视为限流并抛出 RateLimitError
 * @param {string} url - 请求地址
 * @param {object} opts - fetch 选项
 * @param {object} opts.allowWhileRateLimited - 试探选项（不会透传给 fetch）
 * @param {boolean} opts.allowWhileRateLimited.enabled - 熔断期是否允许本次请求打到上游
 * @param {Function} opts.allowWhileRateLimited.onResult - 收到响应后回调，参数为是否成功
 * @returns {Promise<Response>} - 响应对象
 */
async function miguFetch(url, opts = {}) {
  const { allowWhileRateLimited, ...fetchOpts } = opts
  const probe = allowWhileRateLimited || probeContext.getStore()
  const probing = probe?.enabled === true
  if (isRateLimited() && !probing) {
    throw new RateLimitError(0, url)
  }
  await throttle(url)

  const headers = { ...baseHeaders, ...(fetchOpts.headers || {}) }
  const res = await fetch(url, { ...fetchOpts, headers })

  const isRateLimitStatus = res.status === 429 || (res.status === 403 && treat403AsRateLimit)
  if (isRateLimitStatus) {
    consecutiveRateLimit++
    rateLimitTrippedAt = Date.now()
    printRed(`请求被限流(${res.status})，连续第${consecutiveRateLimit}次: ${sanitizeURL(url)}`)
    // 试探失败：重新计时熔断
    probe?.onResult?.(false)
    throw new RateLimitError(res.status, url)
  }
  if (res.ok) {
    consecutiveRateLimit = 0
    rateLimitTrippedAt = 0
    // 2xx 才能证明限流已解除
    probe?.onResult?.(true)
  } else {
    // 5xx 等无法证明限流解除，保持熔断与原有冷却时间
    probe?.onResult?.(false)
  }
  return res
}

/**
 * 请求并解析 JSON
 * 网络错误或解析失败返回 null，限流时抛出 RateLimitError
 * @param {string} url - 请求地址
 * @param {object} opts - fetch 选项
 * @param {number} timeout - 超时时间，单位毫秒
 * @param {number} retry - 失败重试次数
 * @returns {Promise<any|null>} - 解析后的 JSON
 */
async function fetchUrl(url, opts = {}, timeout = 6000, retry = 2) {
  let attempt = 0
  while (true) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort()
      printRed("请求超时")
    }, timeout);
    try {
      const res = await miguFetch(url, {
        ...opts,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      // 非 2xx 直接放弃，不解析也不重试
      // 5xx 重试只会放大请求量，对恢复没有帮助
      if (!res.ok) {
        printYellow(`上游返回 ${res.status}，放弃本次请求: ${sanitizeURL(url)}`)
        return null
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      // 限流必须上抛，由调用方中止任务，不能重试
      if (err instanceof RateLimitError) {
        throw err
      }
      attempt++
      if (attempt > retry) {
        console.error("请求失败:", err);
        return null;
      }
      // 指数退避后重试
      const backoff = 1000 * Math.pow(2, attempt - 1)
      printYellow(`请求失败，${backoff}毫秒后重试(${attempt}/${retry}): ${sanitizeURL(url)}`)
      await wait(backoff)
    }
  }
}

function getLocalIPv(ver = 4) {
  const ips = []
  const inter = os.networkInterfaces()
  for (let net in inter) {
    for (let netPort of inter[net]) {
      if (netPort.family === `IPv${ver}`) {
        ips.push(netPort.address)
      }
    }
  }
  return ips
}

export {
  getLocalIPv, fetchUrl, miguFetch, RateLimitError, sanitizeURL,
  isRateLimited, canRecover, resetRateLimit, getRateLimitCount,
  shouldProbe, runProbe
}
