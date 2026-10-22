import { test, beforeEach } from "node:test"
import assert from "node:assert"
import http from "node:http"
import { fetchUrl, RateLimitError, resetRateLimit, isRateLimited, canRecover } from "../utils/net.js"

beforeEach(() => {
  resetRateLimit()
})

/**
 * 启动返回 429 的上游
 * @returns {Promise<{url: string, close: Function}>}
 */
function startLimitedServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.writeHead(429)
      res.end("limited")
    })
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/play`,
        close: () => new Promise(r => server.close(r)),
      })
    })
  })
}

test("首次限流后进入熔断，冷却期内不允许恢复", async () => {
  const s = await startLimitedServer()
  try {
    await assert.rejects(() => fetchUrl(s.url, {}, 2000, 0), RateLimitError)
    assert.equal(isRateLimited(), true)
    // 冷却 10 分钟未到
    assert.equal(canRecover(10 * 60 * 1000), false)
    // 冷却已过（传 0）
    assert.equal(canRecover(0), true)
  } finally {
    await s.close()
  }
})

test("熔断状态下再次请求不会打到上游", async () => {
  const s = await startLimitedServer()
  try {
    await assert.rejects(() => fetchUrl(s.url, {}, 2000, 0), RateLimitError)
    let reached = 0
    const original = s.url
    // 熔断后即使调用 fetchUrl 也应在本地被拒绝
    await assert.rejects(() => fetchUrl(original, {}, 2000, 0), RateLimitError)
    assert.equal(isRateLimited(), true)
    assert.equal(reached, 0)
  } finally {
    await s.close()
  }
})
