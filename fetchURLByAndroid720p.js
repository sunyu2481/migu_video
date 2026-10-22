import { dataList, delay } from "./utils/fetchList.js"
import { getAndroidURL720p } from "./utils/androidURL.js"
import { appendFile, appendFileSync, renameFileSync, writeFile } from "./utils/fileUtil.js"
import { updatePlaybackData } from "./utils/playback.js"
import { printBlue, printGreen, printRed, printYellow } from "./utils/colorOut.js"
import { miguFetch, RateLimitError, resetRateLimit } from "./utils/net.js"

async function fetchURLByAndroid720p() {

  const start = Date.now()

  // 获取数据
  const datas = await dataList()

  printGreen("数据获取成功！")
  // 必须绝对路径
  const path = process.cwd() + '/interface.txt.bak'
  // 创建写入空内容
  writeFile(path, "")

  printYellow("正在更新...")
  // 回放
  const playbackFile = process.cwd() + '/playback.xml.bak'
  writeFile(playbackFile,
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<tv generator-info-name="Tak" generator-info-url="https://github.com/develop202/migu_video">\n`)

  // 写入开头
  appendFile(path, `#EXTM3U x-tvg-url="https://gh-proxy.com/https://raw.githubusercontent.com/develop202/migu_video/refs/heads/main/playback.xml,https://hk.gh-proxy.org/raw.githubusercontent.com/develop202/migu_video/refs/heads/main/playback.xml,https://develop202.github.io/migu_video/playback.xml,https://raw.githubusercontents.com/develop202/migu_video/refs/heads/main/playback.xml" catchup="append" catchup-source="&playbackbegin=\${(b)yyyyMMddHHmmss}&playbackend=\${(e)yyyyMMddHHmmss}"\n`)

  // 新一轮抓取，重置限流计数
  resetRateLimit()

  try {
    // 分类列表
    for (let i = 0; i < datas.length; i++) {

      const data = datas[i].dataList

      printBlue(`开始更新分类###: ${datas[i].name}`)
      // 写入节目
      for (let j = 0; j < data.length; j++) {

        await updatePlaybackData(data[j], playbackFile)

        // 获取链接
        const resObj = await getAndroidURL720p(data[j].pID)

        if (resObj.url != "") {
          const maxRetry = 6
          for (let z = 1; z <= maxRetry; z++) {
            if (z >= 2) {
              printYellow(`${data[j].name} 获取失败,正在第${z - 1}次重试`)
            }
            const obj = await miguFetch(`${resObj.url}`, {
              method: "GET",
              redirect: "manual"
            })

            const location = obj.headers.get("Location")

            if (location && !location.startsWith("http://bofang")) {
              resObj.url = location
              break
            }
            if (z != maxRetry) {
              await delay(300)
            }
          }
        }

        if (resObj.url == "") {
          printRed(`${data[j].name} 更新失败`)
          continue
        }
        // 写入节目
        appendFile(path, `#EXTINF:-1 tvg-id="${data[j].name}" tvg-name="${data[j].name}" tvg-logo="${data[j].pics.highResolutionH}" group-title="${datas[i].name}",${data[j].name}\n${resObj.url}\n`)
        printGreen(`${data[j].name} 更新成功！`)
      }
    }
  } catch (error) {
    // 触发限流后中止本轮抓取，保留旧文件不被破坏，避免把软限流打成 IP 封禁
    if (error instanceof RateLimitError) {
      printRed(`检测到持续限流，已中止本轮抓取: ${error.message}`)
      printRed("请勿立即重试，建议等待数小时后再次运行")
    } else {
      throw error
    }
    return false
  }

  appendFileSync(playbackFile, `</tv>\n`)

  renameFileSync(playbackFile, playbackFile.replace(".bak", ""))
  renameFileSync(path, path.replace(".bak", ""))
  const end = Date.now()
  printYellow(`本次耗时: ${(end - start) / 1000}秒`)
  return true
}

fetchURLByAndroid720p()
