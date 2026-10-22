import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import http from "node:http"
import {
  fetchUrl, miguFetch, RateLimitError,
  isRateLimited, canRecover, resetRateLimit, getRateLimitCount
} from "../utils/net.js"

/**
 * 启动一个可配置响应状态码的本地服务
 * @param {number} status - 返回的状态码
 * @param {object} body - 返回的 JSON 内容
 * @returns {Promise<{url: string, close: Function, count: Function}>}
 */
function startServer(status, body = { ok: true }) {
  let requests = 0
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      requests++
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    })
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/test`,
        close: () => new Promise(r => server.close(r)),
        count: () => requests,
      })
    })
  })
}

beforeEach(() => {
  resetRateLimit()
})

test("429 抛出 RateLimitError 而不是静默返回 null", async () => {
  const s = await startServer(429)
  try {
    await assert.rejects(
      () => fetchUrl(s.url, {}, 2000, 0),
      (err) => err instanceof RateLimitError && err.status === 429
    )
  } finally {
    await s.close()
  }
})

test("403 同样视为限流", async () => {
  const s = await startServer(403)
  try {
    await assert.rejects(
      () => fetchUrl(s.url, {}, 2000, 0),
      (err) => err instanceof RateLimitError && err.status === 403
    )
  } finally {
    await s.close()
  }
})

test("达到阈值后熔断，不再发出新请求", async () => {
  const s = await startServer(429)
  try {
    // 默认阈值为 1：首次限流即熔断
    await assert.rejects(() => fetchUrl(s.url, {}, 2000, 0), RateLimitError)
    assert.equal(getRateLimitCount(), 1)
    assert.equal(isRateLimited(), true)

    const before = s.count()
    await assert.rejects(() => fetchUrl(s.url, {}, 2000, 0), RateLimitError)
    // 熔断后不应再打到上游
    assert.equal(s.count(), before)
  } finally {
    await s.close()
  }
})

test("resetRateLimit 后恢复请求", async () => {
  const s = await startServer(429)
  try {
    await assert.rejects(() => fetchUrl(s.url, {}, 2000, 0), RateLimitError)
    assert.equal(isRateLimited(), true)
    resetRateLimit()
    assert.equal(isRateLimited(), false)
    await assert.rejects(() => fetchUrl(s.url, {}, 2000, 0), RateLimitError)
    assert.equal(getRateLimitCount(), 1)
  } finally {
    await s.close()
  }
})

test("正常响应会清零连续限流计数", async () => {
  const bad = await startServer(429)
  const good = await startServer(200)
  try {
    await assert.rejects(() => fetchUrl(bad.url, {}, 2000, 0), RateLimitError)
    assert.equal(getRateLimitCount(), 1)
    // 熔断后需要重置才能继续，模拟新一轮任务
    resetRateLimit()
    const data = await fetchUrl(good.url, {}, 2000, 0)
    assert.deepEqual(data, { ok: true })
    assert.equal(getRateLimitCount(), 0)
  } finally {
    await bad.close()
    await good.close()
  }
})

test("冷却期未到时 canRecover 返回 false，到期后返回 true", async () => {
  const s = await startServer(429)
  try {
    await assert.rejects(() => fetchUrl(s.url, {}, 2000, 0), RateLimitError)
    assert.equal(canRecover(10 * 60 * 1000), false)
    // 传入 0 冷却时长等价于已到期
    assert.equal(canRecover(0), true)
  } finally {
    await s.close()
  }
})

test("5xx 不重试，只请求一次就返回 null", async () => {
  const s = await startServer(500, { error: "boom" })
  try {
    const data = await fetchUrl(s.url, {}, 2000, 2)
    assert.equal(data, null)
    // 非 2xx 直接放弃，不进入指数退避重试
    assert.equal(s.count(), 1)
  } finally {
    await s.close()
  }
})

test("限流错误信息不含查询参数，避免签名泄漏", async () => {
  const s = await startServer(429)
  try {
    const url = `${s.url}?sign=secret-sign&token=secret-token`
    await assert.rejects(
      () => fetchUrl(url, {}, 2000, 0),
      (err) => {
        assert.equal(err.message.includes("secret-sign"), false)
        assert.equal(err.message.includes("secret-token"), false)
        // 完整地址仍保留在字段上供内部使用
        assert.equal(err.url, url)
        return true
      }
    )
  } finally {
    await s.close()
  }
})

test("非限流的失败按指数退避重试后返回 null", async () => {
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    res.destroy()
  })
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  const url = `http://127.0.0.1:${server.address().port}/test`
  try {
    const data = await fetchUrl(url, {}, 2000, 1)
    assert.equal(data, null)
    // 首次 + 1 次重试
    assert.equal(requests, 2)
  } finally {
    await new Promise(r => server.close(r))
  }
})
