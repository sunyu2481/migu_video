import { test } from "node:test"
import assert from "node:assert"
import http from "node:http"
import { get302URL } from "../utils/androidURL.js"

/**
 * 启动一个永远不返回 Location 的服务，模拟被限流后的空响应
 * @returns {Promise<{url: string, count: Function, close: Function}>}
 */
function startNoLocationServer() {
  let requests = 0
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      requests++
      res.writeHead(200, { "Content-Type": "text/plain" })
      res.end("blocked")
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

test("无 Location 时最多请求 6 次，不会死循环", async () => {
  const s = await startNoLocationServer()
  try {
    const result = await get302URL({ url: s.url })
    assert.equal(result, "")
    // 修复前这里会无限循环，测试会超时
    assert.equal(s.count(), 6)
  } finally {
    await s.close()
  }
}, { timeout: 15000 })

test("返回非 bofang 的 Location 时直接采用", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: "https://cdn.example.com/video.m3u8" })
    res.end()
  })
  await new Promise(r => server.listen(0, "127.0.0.1", r))
  const url = `http://127.0.0.1:${server.address().port}/play`
  try {
    const result = await get302URL({ url })
    assert.equal(result, "https://cdn.example.com/video.m3u8")
  } finally {
    await new Promise(r => server.close(r))
  }
})
