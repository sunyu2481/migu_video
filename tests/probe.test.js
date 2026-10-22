import { test, beforeEach } from "node:test"
import assert from "node:assert"
import http from "node:http"
import {
  fetchUrl, miguFetch, RateLimitError, resetRateLimit,
  isRateLimited, shouldProbe, runProbe, getRateLimitCount
} from "../utils/net.js"

beforeEach(() => {
  resetRateLimit()
})

/**
 * 启动可切换状态的本地上游
 * @param {number} status - 返回的状态码
 * @returns {Promise<{url: string, count: Function, close: Function}>}
 */
function startServer(status) {
  let requests = 0
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      requests++
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: status === 200 }))
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

/**
 * 让 net.js 进入熔断状态
 * @param {string} url - 返回 429 的地址
 */
async function tripBreaker(url) {
  await assert.rejects(() => fetchUrl(url, {}, 2000, 0), RateLimitError)
  assert.equal(isRateLimited(), true)
}

test("熔断期间普通请求被本地拒绝，不会打到上游", async () => {
  const s = await startServer(429)
  try {
    await tripBreaker(s.url)
    const before = s.count()
    await assert.rejects(() => miguFetch(s.url), RateLimitError)
    assert.equal(s.count(), before)
  } finally {
    await s.close()
  }
})

test("冷却未到时 shouldProbe 为 false", async () => {
  const s = await startServer(429)
  try {
    await tripBreaker(s.url)
    assert.equal(shouldProbe(10 * 60 * 1000), false)
  } finally {
    await s.close()
  }
})

test("冷却到期后 shouldProbe 为 true", async () => {
  const s = await startServer(429)
  try {
    await tripBreaker(s.url)
    // 冷却传 0 等价于已到期
    assert.equal(shouldProbe(0), true)
  } finally {
    await s.close()
  }
})

test("探针请求能真正穿过熔断打到上游", async () => {
  const limited = await startServer(429)
  try {
    await tripBreaker(limited.url)
    const before = limited.count()
    // 熔断中，但探针必须放行
    await runProbe(async () => {
      await miguFetch(limited.url).catch(() => { })
    })
    assert.equal(limited.count(), before + 1, "探针应真实发出请求")
  } finally {
    await limited.close()
  }
})

test("探针收到 2xx 后解除熔断", async () => {
  const limited = await startServer(429)
  const good = await startServer(200)
  try {
    await tripBreaker(limited.url)
    await runProbe(async () => {
      const res = await miguFetch(good.url)
      assert.equal(res.status, 200)
    })
    assert.equal(isRateLimited(), false)
    assert.equal(getRateLimitCount(), 0)
  } finally {
    await limited.close()
    await good.close()
  }
})

test("探针仍被限流时保持熔断并重新计时", async () => {
  const s = await startServer(429)
  try {
    await tripBreaker(s.url)
    // 冷却已到期的前提成立
    assert.equal(shouldProbe(0), true)
    await runProbe(async () => {
      await assert.rejects(() => miguFetch(s.url), RateLimitError)
    })
    assert.equal(isRateLimited(), true)
    // 重新计时：刚探测失败，冷却 10 分钟未到
    assert.equal(shouldProbe(10 * 60 * 1000), false)
  } finally {
    await s.close()
  }
})

test("探针收到 5xx 时保持熔断，不当作解除", async () => {
  const limited = await startServer(429)
  const broken = await startServer(500)
  try {
    await tripBreaker(limited.url)
    await runProbe(async () => {
      const res = await miguFetch(broken.url)
      assert.equal(res.status, 500)
    })
    // 5xx 无法证明限流解除
    assert.equal(isRateLimited(), true)
  } finally {
    await limited.close()
    await broken.close()
  }
})

test("探针遇到网络错误时保持熔断", async () => {
  const limited = await startServer(429)
  try {
    await tripBreaker(limited.url)
    await runProbe(async () => {
      // 指向一个未监听的端口
      await assert.rejects(() => miguFetch("http://127.0.0.1:1/play"))
    })
    assert.equal(isRateLimited(), true)
  } finally {
    await limited.close()
  }
})

test("探针在途时不允许并发第二个探针", async () => {
  const s = await startServer(429)
  try {
    await tripBreaker(s.url)
    let release
    const gate = new Promise(r => { release = r })
    const first = runProbe(async () => {
      await gate
    })
    await assert.rejects(() => runProbe(async () => { }), /已有探针请求在途/)
    release()
    await first
  } finally {
    await s.close()
  }
})

test("探针在途时 shouldProbe 返回 false，避免多个请求同时穿透", async () => {
  const s = await startServer(429)
  try {
    await tripBreaker(s.url)
    let release
    const gate = new Promise(r => { release = r })
    const probe = runProbe(async () => { await gate })
    assert.equal(shouldProbe(0), false)
    release()
    await probe
  } finally {
    await s.close()
  }
})

test("探针结束后允许再次试探（成功场景）", async () => {
  const limited = await startServer(429)
  const good = await startServer(200)
  try {
    await tripBreaker(limited.url)
    await runProbe(async () => { await miguFetch(good.url) })
    assert.equal(isRateLimited(), false)
    // 解除后不再是熔断状态
    assert.equal(shouldProbe(0), false)
  } finally {
    await limited.close()
    await good.close()
  }
})

test("AsyncLocalStorage 上下文不会泄漏到探针之外的请求", async () => {
  const limited = await startServer(429)
  const good = await startServer(200)
  try {
    await tripBreaker(limited.url)
    await runProbe(async () => { await miguFetch(good.url) })
    // 探针已解除熔断
    assert.equal(isRateLimited(), false)
    // 再次熔断后，普通请求仍应被本地拒绝
    await tripBreaker(limited.url)
    const before = limited.count()
    await assert.rejects(() => miguFetch(limited.url), RateLimitError)
    assert.equal(limited.count(), before)
  } finally {
    await limited.close()
    await good.close()
  }
})
