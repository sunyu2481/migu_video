import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RateLimitError, resetRateLimit } from "../utils/net.js"
import { updatePE } from "../utils/updateData.js"

let tempDir

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "migu-pe-"))
  resetRateLimit()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

/**
 * 构造今天的日期字符串
 * @returns {string}
 */
function today() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

/**
 * 构造赛事列表响应
 * @returns {object}
 */
function makeMatchList() {
  const d = today()
  return {
    body: {
      days: ["", d, d, d],
      matchList: {
        [d]: [{ mgdbId: "m1", pkInfoTitle: "A VS B", competitionName: "测试杯", competitionLogo: "logo" }],
      },
    },
  }
}

/**
 * 构造已结束的赛事数据（含回放）
 * @returns {object}
 */
function makeEndedMatch() {
  return {
    body: {
      endTime: Date.now() - 1000,
      keyword: "matchXYZ回放",
      multiPlayList: {
        preList: [{ startTimeStr: "2026-01-01 12:00:00" }],
        replayList: [{ pID: "r1", name: "全场回放" }],
      },
    },
  }
}

/**
 * 预置旧数据
 * @param {string} dir - 目录
 */
function seedOldFiles(dir) {
  writeFileSync(join(dir, "interface.txt"), "旧M3U", "utf8")
  writeFileSync(join(dir, "interfaceTXT.txt"), "旧TXT", "utf8")
}

test("正常更新会重命名 .bak 并覆盖旧文件", async () => {
  seedOldFiles(tempDir)
  await updatePE(0, {
    baseDir: tempDir,
    fetchMatchList: async () => makeMatchList(),
    fetchMatchData: async () => makeEndedMatch(),
    fetchReplayList: async () => ({ body: { replayList: [{ pID: "r1", name: "全场回放" }] } }),
  })
  const content = readFileSync(join(tempDir, "interface.txt"), "utf8")
  assert.match(content, /全场回放/)
  // 未屏蔽 TV 时 updatePE 会复制旧文件再追加，旧内容保留是既有设计
  assert.match(content, /旧M3U/)
  assert.equal(existsSync(join(tempDir, "interface.txt.bak")), false)
})

test("回放接口限流时不重命名 .bak，旧文件保持不变", async () => {
  seedOldFiles(tempDir)

  await assert.rejects(
    () => updatePE(0, {
      baseDir: tempDir,
      fetchMatchList: async () => makeMatchList(),
      fetchMatchData: async () => makeEndedMatch(),
      // 回放接口触发限流，位于内层 try/catch 内
      fetchReplayList: async () => {
        throw new RateLimitError(429, "http://app-sc.miguvideo.com/vms-match/v5/staticcache/basic/all-view-list/m1/2/miguvideo")
      },
    }),
    (err) => err instanceof RateLimitError
  )

  // 旧文件必须原样保留
  assert.equal(readFileSync(join(tempDir, "interface.txt"), "utf8"), "旧M3U")
  assert.equal(readFileSync(join(tempDir, "interfaceTXT.txt"), "utf8"), "旧TXT")
  // .bak 未被重命名
  assert.equal(existsSync(join(tempDir, "interface.txt.bak")), true)
})

test("赛事数据接口限流时同样中止且不覆盖", async () => {
  seedOldFiles(tempDir)

  await assert.rejects(
    () => updatePE(0, {
      baseDir: tempDir,
      fetchMatchList: async () => makeMatchList(),
      fetchMatchData: async () => {
        throw new RateLimitError(403, "https://vms-sc.miguvideo.com/vms-match/v6/staticcache/basic/basic-data/m1/miguvideo")
      },
      fetchReplayList: async () => ({ body: { replayList: [] } }),
    }),
    (err) => err instanceof RateLimitError
  )

  assert.equal(readFileSync(join(tempDir, "interface.txt"), "utf8"), "旧M3U")
  assert.equal(existsSync(join(tempDir, "interface.txt.bak")), true)
})
