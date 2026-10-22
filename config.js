/**
 * 解析布尔环境变量
 * 未设置时返回默认值；显式设置时只有 true/1/yes/on 视为真，
 * 避免 "false" 这类字符串因非空而被误判为真
 * @param {string|undefined} value - 环境变量值
 * @param {boolean} defaultValue - 未设置时的默认值
 * @returns {boolean} - 解析结果
 */
function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue
  }
  return ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase())
}

// 用户id
const userId = process.env.muserId
// 用户token 可以使用网页登录获取
const token = process.env.mtoken
// 本地运行端口号
const port = process.env.mport || 1234
// 公网/自定义访问地址
const host = process.env.mhost || ""
// 画质
// 4蓝光(需要登录且账号有VIP)
// 3高清
// 2标清
const rateType = process.env.mrateType || 3
// 是否刷新token，可能是导致封号的原因
const mrefreshToken = parseBool(process.env.mrefreshToken, false)
const debug = parseBool(process.env.mdebug, false)
// 访问密码 大小写字母和数字 添加后访问格式 http://ip:port/mpass/...
const pass = process.env.mpass || ""
// 是否开启hdr
const enableHDR = parseBool(process.env.menableHDR, true)
// 是否开启h265(原画画质)，开启可能存在兼容性问题，比如浏览器播放没有画面
const enableH265 = parseBool(process.env.menableH265, true)
// 节目信息更新间隔 单位小时 不建议设置太短
const programInfoUpdateInterval = process.env.mupdateInterval || "6"
// 忽略分类，每个分类名用逗号隔开 例如: 央视,卫视,体育-昨天,体育-明天 TV,体育-明天 ps: TV可以忽略所有电视，PE可以忽略所有体育
const ignoreCategory = process.env.mignoreCategory || null
// 是否将TV节目数量较少的分类合并到其他分类
const mergeTVCategory = parseBool(process.env.mmergeTVCategory, true)
// 自定义合并分类，每个分类名用逗号隔开，需先将变量mignoreCategory设置false 格式: 熊猫,综艺,新闻
const customMergeCategory = process.env.mcustomMergeCategory || null
// 请求头中的 User-Agent，留空则保持 Node 默认值
// 建议填入从咪咕 Android 客户端抓包得到的真实 UA，否则风控侧仍可识别为自动化请求
const userAgent = process.env.mUserAgent || ""
// 请求头中的 Accept-Language，留空则保持 Node 默认值
const acceptLanguage = process.env.mAcceptLanguage || "zh-CN,zh;q=0.9,en;q=0.8"
/**
 * 解析非负整数环境变量
 * 解析失败（NaN 或负数）时回退默认值，避免非法配置静默关闭保护
 * @param {string|undefined} value - 环境变量值
 * @param {number} defaultValue - 未设置或非法时的默认值
 * @returns {number} - 解析结果
 */
function parseNonNegativeInt(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return defaultValue
  }
  return parsed
}

// 对咪咕域名的请求最小间隔，单位毫秒，用于限流
const minRequestInterval = parseNonNegativeInt(process.env.mMinRequestInterval, 400)
// 是否把 403 也视为限流。默认 true（最保守，防封 IP）
// 若确认某些 403 表示地区限制或权限不足而非风控，可设为 false 只对 429 熔断
const treat403AsRateLimit = parseBool(process.env.mTreat403AsRateLimit, true)
// 熔断冷却时长，单位毫秒，冷却结束后放行一次试探请求
const rateLimitCooldownMs = parseNonNegativeInt(process.env.mRateLimitCooldownMs, 600000)
// 连续被限流(429/403)多少次后熔断停止本轮抓取，0 表示不熔断
// 默认 1：收到第一个限流信号就收敛，最有利于保住出口 IP
const rateLimitThreshold = parseNonNegativeInt(process.env.mRateLimitThreshold, 1)

export {
  userId, token, port, host, rateType, debug, mrefreshToken, pass, enableHDR,
  programInfoUpdateInterval, enableH265, ignoreCategory, mergeTVCategory,
  customMergeCategory, userAgent, acceptLanguage, minRequestInterval, rateLimitThreshold,
  treat403AsRateLimit, rateLimitCooldownMs
}
