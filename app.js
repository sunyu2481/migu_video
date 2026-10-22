import http from "node:http"
import { host, pass, port, programInfoUpdateInterval, token, userId, rateLimitCooldownMs } from "./config.js";
import { getDateTimeStr } from "./utils/time.js";
import update from "./utils/updateData.js";
import { printBlue, printGreen, printMagenta, printRed } from "./utils/colorOut.js";
import { delay } from "./utils/fetchList.js";
import { channel, interfaceStr } from "./utils/appUtils.js";
import {
  RateLimitError, isRateLimited, canRecover, resetRateLimit,
  shouldProbe, runProbe
} from "./utils/net.js";

// 在线请求触发限流后的冷却时长，冷却结束才放行一次试探请求
const RATE_LIMIT_COOLDOWN_MS = rateLimitCooldownMs

// 运行时长
var hours = 0
let loading = false

/**
 * 熔断期内的快速失败检查，只在会访问上游的频道请求前调用
 * 静态文件接口不消耗上游配额，因此不参与熔断
 * @returns {{limited: boolean, recover: boolean}} - 是否拒绝、是否放行试探
 */
function checkRateLimit() {
  if (!isRateLimited()) {
    return { limited: false, recover: false }
  }
  // 熔断期间只允许一个探针请求，其余请求继续快速失败
  if (!shouldProbe(RATE_LIMIT_COOLDOWN_MS)) {
    return { limited: true, recover: false }
  }
  return { limited: false, recover: true }
}

const server = http.createServer(async (req, res) => {

  while (loading) {
    await delay(50)
  }

  loading = true

  // 拿到锁之后的所有路径都必须走 try/finally 释放
  // 提前 return（认证失败、熔断、非法请求）同样在 try 内，避免锁泄漏导致服务卡死
  try {
    // 获取请求方法、URL 和请求头
    let { method, url, headers } = req;
    // 身份认证
    if (pass != "") {
      const urlSplit = url.split("/")
      if (urlSplit[1] != pass) {
        printRed(`身份认证失败`)
        res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
        res.end(`身份认证失败`); // 发送文件内容
        return
      } else {
        printGreen("身份认证成功")
        // 有密码且传入用户信息
        if (urlSplit.length > 3) {
          url = url.substring(pass.length + 1)
        } else {
          url = urlSplit.length == 2 ? "/" : "/" + urlSplit[urlSplit.length - 1]
        }
      }
    }

    let urlToken = ""
    let urlUserId = ""
    // 匹配是否存在用户信息
    if (/\/{1}[^\/\s]{1,}\/{1}[^\/\s]{1,}/.test(url)) {
      const urlSplit = url.split("/")
      if (urlSplit.length >= 3) {
        urlUserId = urlSplit[1]
        urlToken = urlSplit[2]
        url = urlSplit.length == 3 ? "/" : "/" + urlSplit[urlSplit.length - 1]
      }
    } else {
      urlUserId = userId
      urlToken = token
    }

    // printGreen("")
    printMagenta("请求地址：" + url)

    // HEAD shares GET routing; Node's HTTP server omits the response body.
    if (method != "GET" && method != "HEAD") {
      res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
      res.end(JSON.stringify({
        data: '请使用GET请求',
      }));
      printRed(`使用非GET请求:${method}`)
      return
    }

    const interfaceList = "/,/interface.txt,/m3u,/txt,/playback.xml,/main.m3u"

    // 接口：只读本地文件，不访问上游，因此不受熔断影响
    if (interfaceList.indexOf(url) !== -1) {
      const interfaceObj = interfaceStr(url, headers, urlUserId, urlToken)
      if (interfaceObj.content == null) {
        interfaceObj.content = "获取失败"
      }
      // 设置响应头
      res.setHeader('Content-Type', interfaceObj.contentType);
      if (url == "/m3u") {
        res.setHeader('content-disposition', "inline; filename=\"interface.m3u\"");
      }
      res.statusCode = 200;
      res.end(interfaceObj.content); // 发送文件内容
      return
    }

    // 熔断检查放在确认是频道请求之后、调用上游之前
    // 静态接口已在上面返回，不会被误拦，也不会误触发试探重置
    const limit = checkRateLimit()
    if (limit.limited) {
      res.writeHead(503, { 'Content-Type': 'application/json;charset=UTF-8' });
      res.end("上游服务限流，请稍后再试")
      return
    }
    const isProbing = limit.recover
    if (isProbing) {
      printGreen("限流冷却结束，本次请求将绕过缓存试探上游")
    }

    // 频道；试探请求在 runProbe 上下文中执行：
    // 1. 允许穿过本地熔断真正打到上游
    // 2. 由真实响应（2xx / 429 / 5xx / 网络错误）决定解除还是继续熔断
    // 3. 同时跳过缓存，避免把缓存命中误当成上游试探
    const result = isProbing
      ? await runProbe(() => channel(url, urlUserId, urlToken, { skipCache: true }))
      : await channel(url, urlUserId, urlToken)

    // 结果异常
    if (result.code != 302) {

      printRed(result.desc)
      res.writeHead(result.code, {
        'Content-Type': 'application/json;charset=UTF-8',
      });
      res.end(result.desc)
      return
    }

    res.writeHead(result.code, {
      'Content-Type': 'application/json;charset=UTF-8',
      location: result.playURL
    });

    res.end()
  } catch (error) {
    // 限流时返回 503，提示稍后再试，避免客户端立即重试放大流量
    if (error instanceof RateLimitError) {
      printRed(`上游限流: ${error.message}`)
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json;charset=UTF-8' })
      }
      res.end("上游服务限流，请稍后再试")
    } else {
      console.log(error)
      printRed("请求处理出错")
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json;charset=UTF-8' })
      }
      res.end("服务异常")
    }
  } finally {
    loading = false
  }
})

/**
 * 执行一轮更新
 * 定时任务没有在线请求的冷却恢复路径，这里按同一冷却时长自行判断，
 * 否则一旦更新触发限流，后续定时任务会一直被熔断拒绝，数据永久停止更新
 * @param {number} hours - 已运行小时数
 */
async function runUpdate(hours) {
  if (isRateLimited()) {
    if (!shouldProbe(RATE_LIMIT_COOLDOWN_MS)) {
      printRed(`上游限流冷却中，跳过本次更新`)
      return
    }
    printGreen("限流冷却结束，本次更新将重新尝试")
    // 与在线试探共用同一状态机：只有真实拿到 2xx 才解除熔断
    await runProbe(() => update(hours))
    return
  }
  await update(hours)
}

server.listen(port, async () => {
  const updateInterval = parseInt(programInfoUpdateInterval)
  // 更新
  setInterval(async () => {
    printBlue(`准备更新文件 ${getDateTimeStr(new Date())}`)
    hours += updateInterval
    try {
      await runUpdate(hours)
    } catch (error) {
      console.log(error)
      printRed("更新失败")
    }

    printBlue(`当前已运行${hours}小时`)
  }, updateInterval * 60 * 60 * 1000);

  try {
    // 初始化数据
    await runUpdate(hours)
  } catch (error) {
    console.log(error)
    printRed("更新失败")
  }

  printGreen(`本地地址: http://localhost:${port}${pass == "" ? "" : "/" + pass}`)
  printGreen(`本程序完全免费，如果您是通过付费渠道获取，那么恭喜你成功被骗了`)
  printGreen("开源地址: https://github.com/develop202/migu_video 欢迎issue 感谢star")
  if (host != "") {
    printGreen(`自定义地址: ${host}${pass == "" ? "" : "/" + pass}`)
  }
})
