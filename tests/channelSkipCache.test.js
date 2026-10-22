import { test, beforeEach } from "node:test"
import assert from "node:assert"
import { channel, channelCache } from "../utils/appUtils.js"
import { RateLimitError } from "../utils/net.js"

// 每个用例使用独立频道 ID，避免共享模块级 urlCache 互相干扰
let counter = 0
let pid

beforeEach(() => {
  counter++
  pid = String(900000 + counter)
})

/**
 * 构造受控的上游响应
 * @returns {object} - 播放地址结果
 */
function makePlayResult() {
  return {
    url: "https://play.example.com/live.m3u8?puData=abc",
    rateType: 3,
    content: { message: "ok" },
  }
}

test("首次请求访问上游，fromCache 为 false", async () => {
  let called = 0
  const result = await channel(`/${pid}`, "", "", {
    fetchPlayURL: async () => {
      called++
      return makePlayResult()
    },
  })
  assert.equal(called, 1, "应真实调用上游")
  assert.equal(result.fromCache, false)
  assert.equal(result.code, 302)
})

test("第二次请求命中缓存，fromCache 为 true 且不再访问上游", async () => {
  let called = 0
  const fetchPlayURL = async () => {
    called++
    return makePlayResult()
  }
  await channel(`/${pid}`, "", "", { fetchPlayURL })
  const second = await channel(`/${pid}`, "", "", { fetchPlayURL })

  assert.equal(called, 1, "第二次应走缓存，不再调用上游")
  assert.equal(second.fromCache, true)
  assert.equal(second.code, 302)
})

test("skipCache=true 时即使缓存有效也会访问上游", async () => {
  let called = 0
  const fetchPlayURL = async () => {
    called++
    return makePlayResult()
  }
  // 先填充缓存
  await channel(`/${pid}`, "", "", { fetchPlayURL })
  assert.equal(channelCache(pid, "").haveCache, true, "缓存应已存在")

  // 跳过缓存
  const result = await channel(`/${pid}`, "", "", { fetchPlayURL, skipCache: true })

  assert.equal(called, 2, "skipCache 必须真实调用上游")
  assert.equal(result.fromCache, false)
})

test("skipCache=true 时上游抛限流会向上传播", async () => {
  await channel(`/${pid}`, "", "", { fetchPlayURL: async () => makePlayResult() })

  await assert.rejects(
    () => channel(`/${pid}`, "", "", {
      skipCache: true,
      fetchPlayURL: async () => {
        throw new RateLimitError(429, "http://play.miguvideo.com/playurl")
      },
    }),
    (err) => err instanceof RateLimitError
  )
})

test("skipCache=false 时缓存命中不会调用上游", async () => {
  let called = 0
  const fetchPlayURL = async () => {
    called++
    return makePlayResult()
  }
  await channel(`/${pid}`, "", "", { fetchPlayURL })
  const result = await channel(`/${pid}`, "", "", { fetchPlayURL, skipCache: false })

  assert.equal(called, 1)
  assert.equal(result.fromCache, true)
})

test("非法频道 ID 在缓存检查前返回", async () => {
  const result = await channel("/notanumber", "", "", {
    fetchPlayURL: async () => {
      throw new Error("不应被调用")
    },
  })
  assert.equal(result.desc, "地址格式错误")
  assert.equal(result.fromCache, false)
})
