import { getStringMD5 } from "./EncryUtils.js";
import { getddCalcuURL, getddCalcuURL720p } from "./ddCalcuURL.js";
import { printDebug, printGreen, printRed, printYellow } from "./colorOut.js";
import { fetchUrl, miguFetch, RateLimitError, sanitizeURL } from "./net.js";
import { enableH265, enableHDR } from "../config.js";
import { getDeviceId } from "./deviceId.js";

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

// 设备标识，持久化复用，避免每次启动都变成一台新设备
// 惰性初始化：模块加载时不读写文件，避免仅 import 就产生副作用（测试污染真实 .device_id）
let clientIdCache = null
/**
 * 获取设备标识，首次调用时才读取或生成
 * @returns {string} - 设备标识
 */
function getClientId() {
  if (clientIdCache == null) {
    clientIdCache = getDeviceId()
  }
  return clientIdCache
}

/**
 * 生成响应摘要，避免把播放地址等敏感内容打进日志
 * @param {any} respData - 接口响应
 * @returns {object} - 仅包含状态字段的摘要
 */
function summarizeResponse(respData) {
  if (respData == null || typeof respData != "object") {
    return respData
  }
  return {
    rid: respData.rid,
    code: respData.code,
    message: respData.message,
    rateType: respData.body?.urlInfo?.rateType,
    logined: respData.body?.auth?.logined,
  }
}

/**
 * 生成请求头摘要，隐藏用户凭据
 * @param {object} headers - 请求头
 * @returns {object} - 脱敏后的请求头
 */
function sanitizeHeaders(headers) {
  const hidden = new Set(["userid", "usertoken", "authorization", "cookie", "clientid"])
  const result = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = hidden.has(key.toLowerCase()) ? "***" : value
  }
  return result
}
/**
 * @typedef {object} SaltSign
 * @property {string} salt 盐值
 * @property {string} sign 签名
 */

/**
 * @param {string} md5 - md5字符串
 * @returns {SaltSign} -
 */
function getSaltAndSign(md5) {

  const salt = 1230024
  const suffix = "3ce941cc3cbc40528bfd1c64f9fdf6c0migu0123"
  const sign = getStringMD5(md5 + suffix)
  return {
    salt: salt,
    sign: sign
  }
}

/**
 * 为一次请求生成时间戳、签名与查询参数
 * 每次请求都重新签名，避免复用同一签名被判定为重放
 * @param {string} pid - 节目ID
 * @param {number} rateType - 清晰度
 * @param {string} appVersion - 版本号
 * @param {string} enableH265Str - h265 参数
 * @param {string} enableHDRStr - HDR 参数
 * @returns {string} - 查询字符串
 */
function buildPlayParams(pid, rateType, appVersion, enableH265Str, enableHDRStr) {
  const timestramp = Date.now()
  const md5 = getStringMD5(timestramp + pid + appVersion)
  const result = getSaltAndSign(md5)
  return "?sign=" + result.sign + "&rateType=" + rateType
    + "&contId=" + pid + "&timestamp=" + timestramp + "&salt=" + result.salt
    + "&flvEnable=true&super4k=true" + enableH265Str + enableHDRStr
}

/**
 * @param {string} userId - 用户ID
 * @param {string} token - 用户token
 * @param {string} pid - 节目ID
 * @param {number} rateType - 清晰度
 * @returns {} - 
 */
async function getAndroidURL(userId, token, pid, rateType) {

  if (rateType <= 1) {
    return {
      url: "",
      rateType: 0,
      content: null
    }
  }
  const appVersion = "26000370"
  let headers = {
    AppVersion: 2600037000,
    TerminalId: "android",
    "X-UP-CLIENT-CHANNEL-ID": "2600037000-99000-200300220100002",
    ClientId: getClientId(),
  }
  // cctv5和5+开启flv后不能回放
  if (pid != "641886683" && pid != "641886773") {
    headers["appCode"] = "miguvideo_default_android"
  }

  if (rateType != 2 && userId && token) {
    headers.UserId = userId
    headers.UserToken = token
  }
  let enableHDRStr = ""
  if (enableHDR) {
    enableHDRStr = "&4kvivid=true&2Kvivid=true&vivid=2"
  }
  let enableH265Str = ""
  if (enableH265) {
    enableH265Str = "&h265N=true"
  }
  // 请求
  const baseURL = "https://play.miguvideo.com/playurl/v1/play/playurl"
  let params = buildPlayParams(pid, rateType, appVersion, enableH265Str, enableHDRStr)
  printDebug(`请求链接: ${sanitizeURL(baseURL)}`)
  let respData = await fetchUrl(baseURL + params, {
    headers: headers
  })

  printDebug(summarizeResponse(respData))

  if (respData?.rid == 'TIPS_NEED_MEMBER') {
    printYellow("该账号没有会员 正在降低画质")
    let respRateType = parseInt(respData.body.urlInfo?.rateType) > 4 ? 4 : 3
    params = buildPlayParams(pid, respRateType, appVersion, enableH265Str, enableHDRStr)
    printDebug(`请求链接: ${sanitizeURL(baseURL)}`)
    respData = await fetchUrl(baseURL + params, {
      headers: headers
    })

    if (respData?.rid == 'TIPS_NEED_MEMBER') {
      printYellow("账号非钻石会员 降低画质")

      params = buildPlayParams(pid, 3, appVersion, enableH265Str, enableHDRStr)
      printDebug(`请求链接: ${sanitizeURL(baseURL)}`)
      respData = await fetchUrl(baseURL + params, {
        headers: headers
      })
    }
  }

  printDebug(summarizeResponse(respData))
  // console.log(respData)
  const url = respData?.body?.urlInfo?.url
  // console.log(rateType)
  // console.log(url)
  if (!url) {
    return {
      url: "",
      rateType: 0,
      content: respData
    }
  }
  pid = respData.body.content.contId

  // 将URL加密
  const resURL = getddCalcuURL(url, pid, "android", rateType, userId)

  rateType = respData.body.urlInfo?.rateType
  // console.log("清晰度" + rateType)
  return {
    url: resURL,
    rateType: parseInt(rateType),
    content: respData
  }

}


/**
 * 旧版高清画质
 * @param {string} pid - 节目ID
 * @returns {} - 
 */
async function getAndroidURL720p(pid) {
  // 获取url
  const timestramp = Math.round(Date.now()).toString()
  const appVersion = "2600034600"
  const appVersionID = appVersion + "-99000-201600010010028"
  let headers = {
    AppVersion: `${appVersion}`,
    TerminalId: "android",
    "X-UP-CLIENT-CHANNEL-ID": `${appVersionID}`,
    ClientId: getClientId(),
  }
  // cctv5和5+开启flv后不能回放
  if (pid != "641886683" && pid != "641886773") {
    headers["appCode"] = "miguvideo_default_android"
  }
  // console.log(headers)
  const str = timestramp + pid + appVersion.substring(0, 8)
  const md5 = getStringMD5(str)

  const salt = String(Math.floor(Math.random() * 1000000)).padStart(6, '0') + '25'
  const suffix = "2cac4f2c6c3346a5b34e085725ef7e33migu" + salt.substring(0, 4)
  const sign = getStringMD5(md5 + suffix)

  let rateType = 3
  let enableHDRStr = ""
  if (enableHDR) {
    enableHDRStr = "&4kvivid=true&2Kvivid=true&vivid=2"
  }
  let enableH265Str = ""
  if (enableH265) {
    enableH265Str = "&h265N=true"
  }
  // 请求
  const baseURL = "https://play.miguvideo.com/playurl/v1/play/playurl"
  const params = "?sign=" + sign + "&rateType=" + rateType
    + "&contId=" + pid + "&timestamp=" + timestramp + "&salt=" + salt
    + "&flvEnable=true&super4k=true" + enableH265Str + enableHDRStr
  printDebug(`请求链接: ${sanitizeURL(baseURL)}`)
  printDebug(sanitizeHeaders(headers))
  const respData = await fetchUrl(baseURL + params, {
    headers: headers
  })

  printDebug(summarizeResponse(respData))
  // console.dir(respData, { depth: null })
  const url = respData?.body?.urlInfo?.url
  // console.log(rateType)
  // console.log(url)
  if (!url) {
    return {
      url: "",
      rateType: 0,
      content: respData
    }
  }

  rateType = respData.body.urlInfo?.rateType
  pid = respData.body.content.contId

  // 将URL加密
  const resURL = getddCalcuURL720p(url, pid)

  return {
    url: resURL,
    rateType: parseInt(rateType),
    content: respData
  }

}

async function get302URL(resObj) {
  try {
    const maxRetry = 6
    for (let z = 1; z <= maxRetry; z++) {
      if (z >= 2) {
        printYellow(`获取失败,正在第${z - 1}次重试`)
      }
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        controller.abort()
        printRed("请求超时")
      }, 6000);
      let location = null
      try {
        const obj = await miguFetch(resObj.url, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal
        })
        location = obj.headers.get("Location")
      } catch (err) {
        // 限流时直接放弃，不再重试，避免把软限流打成 IP 封禁
        if (err instanceof RateLimitError) {
          clearTimeout(timeoutId)
          throw err
        }
        console.log(err)
      } finally {
        clearTimeout(timeoutId)
      }

      if (location && !location.startsWith("http://bofang")) {
        return location
      }
      if (z != maxRetry) {
        await delay(300)
      }
    }
  } catch (error) {
    // 限流必须继续上抛，否则这里的通用捕获会让上面的重抛失效
    if (error instanceof RateLimitError) {
      throw error
    }
    console.log(error)
  }
  printRed(`获取失败,返回原链接`)
  return ""
}

function printLoginInfo(resObj) {
  if (resObj.content.body?.auth?.logined) {
    printGreen("登录认证成功")
    if (resObj.content.body.auth.authResult == "FAIL") {
      printRed(`认证失败 视频内容不完整 可能缺少相关VIP: ${resObj.content.body.auth.resultDesc}`)
    }
  } else {
    printYellow("未登录")
  }
}

export { getAndroidURL, getAndroidURL720p, get302URL, printLoginInfo }
