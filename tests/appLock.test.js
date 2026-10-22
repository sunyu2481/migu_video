import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import http from "node:http"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir
let child
let port

/**
 * 等待服务端口可用
 * @param {string} url - 探测地址
 * @param {number} timeoutMs - 超时时间
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
 * 请求并返回状态码，超时视为服务卡死
 * @param {string} url - 请求地址
 * @param {number} timeoutMs - 超时时间
 * @returns {Promise<number|string>}
 */
async function getStatus(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    await res.text()
    return res.status
  } catch (error) {
    return "超时"
  }
}

beforeEach(async () => {
  // 用临时目录作为工作目录，避免测试读写仓库里的 interface.txt / playback.xml
  tempDir = mkdtempSync(join(tmpdir(), "migu-app-"))
  for (const name of ["interface.txt", "interfaceTXT.txt", "playback.xml"]) {
    writeFileSync(join(tempDir, name), "# 测试数据\n", "utf8")
  }
  port = 19000 + Math.floor(Math.random() * 1000)
  // 屏蔽 TV/PE 更新，避免测试发起真实上游请求
  child = spawn(process.execPath, [join(process.cwd(), "app.js")], {
    cwd: tempDir,
    env: {
      ...process.env,
      mport: String(port),
      mignoreCategory: "TV,PE",
      mMinRequestInterval: "0",
      mClientId: "test-client-id",
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

test("连续多次请求不会因全局锁泄漏而卡死", async () => {
  // 认证失败、静态接口、非法频道 ID 都会走提前 return 路径
  const first = await getStatus(`http://127.0.0.1:${port}/`)
  const second = await getStatus(`http://127.0.0.1:${port}/m3u`)
  const third = await getStatus(`http://127.0.0.1:${port}/abc`)
  const fourth = await getStatus(`http://127.0.0.1:${port}/txt`)

  assert.equal(first, 200)
  assert.equal(second, 200)
  assert.equal(third, 200)
  // 若锁泄漏，这里会超时
  assert.equal(fourth, 200)
})

test("并发请求全部返回，不会互相永久阻塞", async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => getStatus(`http://127.0.0.1:${port}/txt`))
  )
  // 全部应为 200，不能出现超时
  assert.deepEqual(results, Array(8).fill(200))
})

test("非 GET 请求走提前返回后，后续请求仍可处理", async () => {
  const post = await new Promise(resolve => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: "/",
      method: "POST",
    }, res => {
      res.resume()
      res.on("end", () => resolve(res.statusCode))
    })
    req.on("error", () => resolve("错误"))
    req.end()
  })
  assert.equal(post, 200)
  // 锁必须在提前返回时释放
  const next = await getStatus(`http://127.0.0.1:${port}/m3u`)
  assert.equal(next, 200)
})
