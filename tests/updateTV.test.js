import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RateLimitError, resetRateLimit } from "../utils/net.js"
import { updateTV } from "../utils/updateData.js"

let tempDir

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "migu-tv-"))
  resetRateLimit()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

/**
 * 构造测试用分类数据
 * @param {number} count - 频道数量
 * @returns {Array} - 分类数组
 */
function makeCategories(count) {
  const dataList = []
  for (let i = 0; i < count; i++) {
    dataList.push({
      name: `频道${i}`,
      pID: String(i),
      pics: { highResolutionH: "http://logo" },
    })
  }
  return [{ name: "测试分类", dataList }]
}

/**
 * 预置旧数据文件
 * @param {string} dir - 目录
 */
function seedOldFiles(dir) {
  writeFileSync(join(dir, "interface.txt"), "旧M3U", "utf8")
  writeFileSync(join(dir, "interfaceTXT.txt"), "旧TXT", "utf8")
  writeFileSync(join(dir, "playback.xml"), "旧XML", "utf8")
}

test("正常更新会重命名 .bak 并覆盖旧文件", async () => {
  seedOldFiles(tempDir)
  const ok = await updateTV(0, {
    baseDir: tempDir,
    fetchDataList: async () => makeCategories(2),
    writePlaybackData: async () => true,
  })
  assert.equal(ok, undefined)
  const content = readFileSync(join(tempDir, "interface.txt"), "utf8")
  assert.match(content, /频道0/)
  assert.doesNotMatch(content, /旧M3U/)
  // .bak 已被重命名，不再存在
  assert.equal(existsSync(join(tempDir, "interface.txt.bak")), false)
})

test("限流中止时三个旧文件都保持不变，且不做重命名", async () => {
  seedOldFiles(tempDir)

  await assert.rejects(
    () => updateTV(0, {
      baseDir: tempDir,
      fetchDataList: async () => makeCategories(3),
      // 第 2 个频道触发限流
      writePlaybackData: async (program) => {
        if (program.pID === "1") {
          throw new RateLimitError(429, "http://play.miguvideo.com/playurl/v1/play/playurl?sign=x")
        }
        return true
      },
    }),
    (err) => err instanceof RateLimitError
  )

  // 三份旧数据必须原样保留，不能被半成品覆盖
  assert.equal(readFileSync(join(tempDir, "interface.txt"), "utf8"), "旧M3U")
  assert.equal(readFileSync(join(tempDir, "interfaceTXT.txt"), "utf8"), "旧TXT")
  assert.equal(readFileSync(join(tempDir, "playback.xml"), "utf8"), "旧XML")
  // .bak 未被重命名
  assert.equal(existsSync(join(tempDir, "interface.txt.bak")), true)
})

test("限流发生在第一个频道时同样保留旧文件", async () => {
  seedOldFiles(tempDir)

  await assert.rejects(
    () => updateTV(0, {
      baseDir: tempDir,
      fetchDataList: async () => makeCategories(2),
      writePlaybackData: async () => {
        throw new RateLimitError(403, "http://play.miguvideo.com/playurl")
      },
    }),
    (err) => err instanceof RateLimitError
  )

  assert.equal(readFileSync(join(tempDir, "interface.txt"), "utf8"), "旧M3U")
  assert.equal(readFileSync(join(tempDir, "playback.xml"), "utf8"), "旧XML")
})
