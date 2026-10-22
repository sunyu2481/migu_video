import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { getStringMD5 } from "./EncryUtils.js"

// 设备标识持久化文件，放在工作目录下
const DEFAULT_DEVICE_FILE = `${process.cwd()}/.device_id`

/**
 * 生成新的设备标识
 * @returns {string} - 设备标识
 */
function generateDeviceId() {
  return getStringMD5(`${Date.now()}${Math.random()}`)
}

/**
 * 获取设备标识
 * 优先使用环境变量 mClientId，其次读取本地文件，都不存在时生成并落盘。
 * 真实客户端的设备标识是稳定的，每次启动都换新会被判定为设备农场。
 * @param {string} filePath - 持久化文件路径，测试时可注入临时目录
 * @returns {string} - 设备标识
 */
function getDeviceId(filePath = DEFAULT_DEVICE_FILE) {
  const fromEnv = process.env.mClientId
  if (fromEnv) {
    return fromEnv
  }
  try {
    if (existsSync(filePath)) {
      const saved = readFileSync(filePath, "utf8").trim()
      if (saved) {
        return saved
      }
    }
  } catch (error) {
    // 读取失败时退化为生成新标识，不影响运行
  }
  const deviceId = generateDeviceId()
  try {
    writeFileSync(filePath, deviceId, "utf8")
  } catch (error) {
    // 只读文件系统下无法持久化，本次运行仍可使用
  }
  return deviceId
}

export { getDeviceId, DEFAULT_DEVICE_FILE }
