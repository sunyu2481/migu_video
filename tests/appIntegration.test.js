import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir
let child
let port

/**
 * 等待服务可用
 * @param {string} url - 探测地址
 * @returns {Promise<boolean>}
 */
async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) })
      await res.text()
      return true
    } catch (error) {
      await new Promise(r => setTimeout(r, 200))
    }
  }
  return false
}

/**
 * 请求并返回 { status, body }
 * @param {string} path - 路径
 * @returns {Promise<{status: number|string, body: string}>}
 */
async function get(path) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000) })
    return { status: res.status, body: await res.text() }
  } catch (error) {
    return { status: "超时", body: "" }
  }
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "migu-int-"))
  for (const name of ["interface.txt", "interfaceTXT.txt", "playback.xml"]) {
    writeFileSync(join(tempDir, name), `# ${name} 测试数据\n`, "utf8")
  }
  port = 21000 + Math.floor(Math.random() * 1000)
  child = spawn(process.execPath, [join(process.cwd(), "app.js")], {
    cwd: tempDir,
    env: {
      ...process.env,
      mport: String(port),
      mignoreCategory: "TV,PE",
      mMinRequestInterval: "0",
      mClientId: "test-client-id",
      // 冷却设为 0，使试探立即可用（这是正式配置项，非测试后门）
      mRateLimitCooldownMs: "0",
    },
    stdio: "ignore",
  })
  const ok = await waitForServer(`http://127.0.0.1:${port}/`)
  assert.equal(ok, true, "服务未能启动")
})

afterEach(() => {
  if (child) {
    child.kill("SIGKILL")
    child = null
  }
  rmSync(tempDir, { recursive: true, force: true })
})

test("静态接口从临时目录读取，不触碰仓库文件", async () => {
  const result = await get("/m3u")
  assert.equal(result.status, 200)
  assert.match(result.body, /interface\.txt 测试数据/)
})

test("所有静态接口在正常状态下返回 200", async () => {
  for (const path of ["/", "/interface.txt", "/m3u", "/txt", "/playback.xml", "/main.m3u"]) {
    const result = await get(path)
    assert.equal(result.status, 200, `${path} 应返回 200`)
  }
})

test("连续请求静态接口不会因全局锁而卡死", async () => {
  const results = []
  for (let i = 0; i < 10; i++) {
    results.push((await get("/txt")).status)
  }
  assert.deepEqual(results, Array(10).fill(200))
})

test("并发请求静态接口全部成功", async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => get("/interface.txt"))
  )
  assert.deepEqual(results.map(r => r.status), Array(8).fill(200))
})

test("非法频道 ID 返回错误信息且服务保持可用", async () => {
  const bad = await get("/notanumber")
  assert.equal(bad.status, 200)
  assert.match(bad.body, /地址格式错误/)
  // 服务仍可用
  assert.equal((await get("/m3u")).status, 200)
})
