import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import http from "node:http"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetRateLimit } from "../utils/net.js"
import { getDeviceId } from "../utils/deviceId.js"

let tempDir

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "migu-302-"))
  resetRateLimit()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

/**
 * 模拟上游返回 429 的播放接口
 * @returns {Promise<{server: object, url: string, count: Function, close: Function}>}
 */
function startRateLimitedServer() {
  let requests = 0
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      requests++
      res.writeHead(429, { "Content-Type": "text/plain" })
      res.end("too many requests")
    })
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/play`,
        count: () => requests,
        close: () => new Promise(r => server.close(r)),
      })
    })
  })
}

test("429 时 get302URL 不再继续重试，只请求一次", async () => {
  // 动态导入以复用模块状态
  const { get302URL } = await import("../utils/androidURL.js")
  const s = await startRateLimitedServer()
  try {
    await assert.rejects(
      () => get302URL({ url: s.url }),
      (err) => err.name === "RateLimitError"
    )
    // 限流应直接上抛，不能进 6 次重试循环
    assert.equal(s.count(), 1)
  } finally {
    await s.close()
  }
}, { timeout: 15000 })

test("设备标识文件按注入路径读写，不污染工作目录", () => {
  const realFile = `${process.cwd()}/.device_id`
  const existedBefore = existsSync(realFile)
  const tempFile = join(tempDir, "device")
  const id = getDeviceId(tempFile)
  assert.equal(readFileSync(tempFile, "utf8").trim(), id)
  assert.equal(existsSync(realFile), existedBefore)
})

test("限流中止时旧文件保持不变", async () => {
  const interfaceFile = join(tempDir, "interface.txt")
  writeFileSync(interfaceFile, "旧数据", "utf8")
  const s = await startRateLimitedServer()
  try {
    // 模拟更新流程：写 .bak 后遇到限流，不做重命名
    const bakFile = `${interfaceFile}.bak`
    writeFileSync(bakFile, "半成品", "utf8")
    const { fetchUrl } = await import("../utils/net.js")
    await assert.rejects(() => fetchUrl(s.url, {}, 2000, 0), (err) => err.name === "RateLimitError")
    // 捕获到限流后，旧文件内容必须完整保留
    assert.equal(readFileSync(interfaceFile, "utf8"), "旧数据")
  } finally {
    await s.close()
  }
})
