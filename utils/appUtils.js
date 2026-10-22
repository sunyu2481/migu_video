import { get302URL, getAndroidURL, getAndroidURL720p, printLoginInfo } from "./androidURL.js";
import { readFileSync } from "./fileUtil.js";
import { host, pass, rateType, token, userId } from "../config.js";
import { printDebug, printGreen, printGrey, printRed, printYellow } from "./colorOut.js";
import { RateLimitError, sanitizeURL } from "./net.js";

// url缓存 降低请求频率
const urlCache = {}

function interfaceStr(url, headers, urlUserId, urlToken) {

  let result = {
    content: null,
    contentType: 'text/plain;charset=UTF-8'
  }
  let fileName = process.cwd() + "/interface.txt"
  switch (url) {
    case "/playback.xml":
      fileName = process.cwd() + "/playback.xml"
      result.contentType = "text/xml;charset=UTF-8"
      break;

    case "/txt":
      fileName = process.cwd() + "/interfaceTXT.txt"
      break;

    case "/m3u":
      result.contentType = "audio/x-mpegurl; charset=utf-8"
      break;

    case "/main.m3u":
      result.contentType = "application/octet-stream; charset=utf-8"
      break;

    default:
      break;
  }
  try {
    result.content = readFileSync(fileName)
  } catch (error) {
    printRed("文件获取失败")
    console.log(error)
    return result
  }
  if (url == "/playback.xml") {
    return result
  }

  let replaceHost = `http://${headers.host}`

  if (host != "" && (headers["x-real-ip"] || headers["x-forwarded-for"] || host.indexOf(headers.host) != -1)) {
    replaceHost = host
  }

  if (pass != "") {
    replaceHost = `${replaceHost}/${pass}`
  }

  if (urlUserId != userId && urlToken != token) {
    replaceHost = `${replaceHost}/${urlUserId}/${urlToken}`
  }

  result.content = `${result.content}`.replaceAll("${replace}", replaceHost);

  return result
}

/**
 * @param {string} url - 请求路径
 * @param {string} urlUserId - 用户 ID
 * @param {string} urlToken - 用户 token
 * @param {object} options - 可选参数
 * @param {boolean} options.skipCache - 是否跳过缓存，用于熔断冷却后的真实上游试探
 * @param {Function} options.fetchPlayURL - 获取播放地址，默认按登录状态选择 720p 或高清接口
 * @returns {Promise<object>} - 频道结果
 */
async function channel(url, urlUserId, urlToken, options = {}) {

  let result = {
    code: 200,
    pID: "",
    desc: "服务异常",
    playURL: "",
    // 是否来自内存缓存，调用方据此判断本次请求是否真的访问了上游
    fromCache: false
  }
  // 处理频道ID
  let urlSplit = url.split("/")[1]
  let pid = urlSplit
  let params = ""

  // 处理回放参数
  if (urlSplit.match(/\?/)) {
    printGreen("处理传入参数")

    const urlSplit1 = urlSplit.split("?")
    pid = urlSplit1[0]
    params = urlSplit1[1]
  } else {
    printGrey("无参数传入")
  }

  if (isNaN(pid)) {
    result.desc = "地址格式错误"
    return result
  }

  printYellow("频道ID " + pid)

  // 是否存在缓存；试探请求必须绕过缓存，否则本次并未真正探测上游
  const cache = options.skipCache
    ? { haveCache: false, code: 200, playURL: "", cacheDesc: "跳过缓存" }
    : channelCache(pid, params)
  if (cache.haveCache) {
    result.code = cache.code
    result.playURL = cache.playURL
    result.desc = cache.cacheDesc
    result.fromCache = true
    return result
  }

  // 未登录请求720p；测试可注入 fetchPlayURL 以构造受控上游
  const fetchPlayURL = options.fetchPlayURL || (() => {
    if (rateType >= 3 && (!urlUserId || !urlToken)) {
      return getAndroidURL720p(pid)
    }
    return getAndroidURL(urlUserId, urlToken, pid, rateType)
  })

  let resObj = {}
  try {
    resObj = await fetchPlayURL()
  } catch (error) {
    // 限流必须上抛，由 app.js 返回 503，避免客户端把它当成可重试的普通错误
    if (error instanceof RateLimitError) {
      throw error
    }
    console.log(error)
    result.desc = "链接请求出错"
    return result
  }
  // 播放地址含 ddCalcu 签名，日志只保留协议、主机和路径
  printDebug(`添加加密字段后链接 ${sanitizeURL(resObj.url)}`)


  // 可以正确跳转了 不需要再手动过滤了
  // if (resObj.url != "") {
  //   const location = await get302URL(resObj)
  //   if (location != "") {
  //     resObj.url = location
  //   }
  // }
  printLoginInfo(resObj)
  // printRed(resObj.url)
  printGreen(`添加节目缓存 ${pid}`)
  // 缓存有效时长
  let addTime = 3 * 60 * 60 * 1000
  // 节目调整
  if (resObj.url == "") {
    addTime = 1 * 60 * 1000
  }
  // 加入缓存
  urlCache[pid] = {
    // 有效期3小时 节目调整时改为1分钟
    valTime: Date.now() + addTime,
    url: resObj.url,
    content: resObj.content,
  }

  if (resObj.url == "") {
    // 上游限流或请求失败时 content 可能为 null，此处兼容
    let msg = resObj.content?.message ?? "节目调整，暂不提供服务"
    result.desc = `${pid} ${msg}`
    return result
  }
  let playURL = resObj.url

  // 添加回放参数
  if (params != "") {
    const resultParams = new URLSearchParams(params);
    for (const [key, value] of resultParams) {
      playURL = `${playURL}&${key}=${value}`
    }
  }

  printGreen("链接获取成功")
  result.code = 302
  result.playURL = playURL
  return result
}

function channelCache(pid, params) {
  let cache = {
    haveCache: false,
    code: 200,
    pID: "",
    playURL: "",
    cacheDesc: ""
  }
  if (typeof urlCache[pid] === "object") {
    const valTime = urlCache[pid].valTime - Date.now()
    // 缓存是否有效
    if (valTime >= 0) {
      cache.haveCache = true
      let playURL = urlCache[pid].url
      let msg = "节目调整，暂不提供服务"
      if (urlCache[pid].content != null) {
        printLoginInfo(urlCache[pid])
        msg = urlCache[pid].content.message
      }
      // 节目调整
      if (playURL == "") {
        cache.cacheDesc = `${pid} ${msg}`
        return cache
      }

      // 添加回放参数
      if (params != "") {
        const resultParams = new URLSearchParams(params);
        for (const [key, value] of resultParams) {
          playURL = `${playURL}&${key}=${value}`
        }
      }
      printGreen("使用缓存数据")
      cache.code = 302
      cache.cacheDesc = "缓存获取成功"
      cache.playURL = playURL
      return cache
    }
  }
  cache.cacheDesc = "暂无缓存"
  return cache
}

export { interfaceStr, channel, channelCache }
