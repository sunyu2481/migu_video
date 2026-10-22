import { test, afterEach } from "node:test"
import assert from "node:assert"
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getDeviceId } from "../utils/deviceId.js"

// 使用临时目录，绝不触碰仓库里真实的 .device_id
const tempDir = mkdtempSync(join(tmpdir(), "migu-device-"))
const deviceFile = join(tempDir, ".device_id")

afterEach(() => {
  delete process.env.mClientId
  if (existsSync(deviceFile)) {
    rmSync(deviceFile)
  }
})

test("首次调用生成并落盘设备标识", () => {
  if (existsSync(deviceFile)) {
    rmSync(deviceFile)
  }
  const id = getDeviceId(deviceFile)
  assert.match(id, /^[0-9a-f]{32}$/)
  assert.equal(existsSync(deviceFile), true)
  assert.equal(readFileSync(deviceFile, "utf8").trim(), id)
})

test("重复调用返回同一个设备标识", () => {
  const first = getDeviceId(deviceFile)
  const second = getDeviceId(deviceFile)
  assert.equal(first, second)
})

test("环境变量 mClientId 优先于本地文件", () => {
  getDeviceId(deviceFile)
  process.env.mClientId = "custom-client-id"
  assert.equal(getDeviceId(deviceFile), "custom-client-id")
})

test("文件不存在时不会创建仓库根目录的 .device_id", () => {
  const realFile = `${process.cwd()}/.device_id`
  const existedBefore = existsSync(realFile)
  getDeviceId(deviceFile)
  // 测试只应写临时目录，不应改动真实文件的存在状态
  assert.equal(existsSync(realFile), existedBefore)
})
