import { dataList } from "./fetchList.js"
import { appendFile, appendFileSync, copyFileSync, renameFileSync, writeFile } from "./fileUtil.js"
import { updatePlaybackData } from "./playback.js"
import { mrefreshToken, host, ignoreCategory, token, userId } from "../config.js"
import refreshToken from "./refreshToken.js"
import { printGreen, printRed, printYellow } from "./colorOut.js"
import { getDateString } from "./time.js"
import { fetchUrl, RateLimitError } from "./net.js"

// 忽略分类列表
const ignoreCategorySet = new Set()

/**
 * @param {Number} _hours -更新小时数
 * @param {object} options - 可注入的依赖，仅用于测试
 * @param {string} options.baseDir - 数据文件目录，默认为工作目录
 * @param {Function} options.fetchDataList - 获取分类数据，默认使用 dataList
 * @param {Function} options.writePlaybackData - 写入节目单，默认使用 updatePlaybackData
 */
async function updateTV(_hours, options = {}) {
  const baseDir = options.baseDir || process.cwd()
  const getDataList = options.fetchDataList || dataList
  const writePlaybackData = options.writePlaybackData || updatePlaybackData

  const date = new Date()
  const start = date.getTime()
  let interfacePath = ""
  let interfaceTXTPath = ""
  // 获取数据
  const datas = await getDataList()
  printGreen("TV数据获取成功！")

  interfacePath = `${baseDir}/interface.txt.bak`
  // txt
  interfaceTXTPath = `${baseDir}/interfaceTXT.txt.bak`
  // 创建写入空内容
  writeFile(interfacePath, "")
  // txt
  writeFile(interfaceTXTPath, "")

  appendFile(interfacePath, `#EXTM3U x-tvg-url="\${replace}/playback.xml" catchup="append" catchup-source="?playbackbegin=\${(b)yyyyMMddHHmmss}&playbackend=\${(e)yyyyMMddHHmmss}"\n`)
  printYellow("开始更新TV...")
  // 回放
  const playbackFile = `${baseDir}/playback.xml.bak`
  writeFile(playbackFile,
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<tv generator-info-name="Tak" generator-info-url="${host}">\n`)

  try {
    // 分类列表
    for (let i = 0; i < datas.length; i++) {
      // 忽略分类
      if (ignoreCategorySet.has(datas[i].name)) {
        printYellow(`TV分类###:${datas[i].name} 已屏蔽！`)
        continue
      }

      const data = datas[i].dataList
      // txt
      appendFile(interfaceTXTPath, `${datas[i].name},#genre#\n`)
      // 写入节目
      for (let j = 0; j < data.length; j++) {

        await writePlaybackData(data[j], playbackFile)

        // 写入节目
        appendFile(interfacePath, `#EXTINF:-1 tvg-id="${data[j].name}" tvg-name="${data[j].name}" tvg-logo="${data[j].pics.highResolutionH}" group-title="${datas[i].name}",${data[j].name}\n\${replace}/${data[j].pID}\n`)
        // txt
        appendFile(interfaceTXTPath, `${data[j].name},\${replace}/${data[j].pID}\n`)
        // printGreen(`    节目链接更新成功`)
      }
      printGreen(`分类###:${datas[i].name} 更新完成！`)
    }
  } catch (error) {
    // 限流必须继续上抛，由 update() 中止整轮更新
    // 这里 return 会让外层继续执行 PE 更新，与「限流后中止」的设计矛盾
    if (error instanceof RateLimitError) {
      printRed(`检测到持续限流，已中止TV更新: ${error.message}`)
    }
    throw error
  }

  appendFileSync(playbackFile, `</tv>\n`)

  // 重命名
  renameFileSync(playbackFile, playbackFile.replace(".bak", ""))
  renameFileSync(interfacePath, interfacePath.replace(".bak", ""))
  // txt
  renameFileSync(interfaceTXTPath, interfaceTXTPath.replace(".bak", ""))
  printGreen("TV更新完成！")
  const end = Date.now()
  printYellow(`TV更新耗时: ${(end - start) / 1000}秒`)
}

/**
 * @param {Number} _hours -更新小时数
 * @param {object} options - 可注入的依赖，仅用于测试
 * @param {string} options.baseDir - 数据文件目录，默认为工作目录
 * @param {Function} options.fetchMatchList - 获取赛事列表，默认使用 fetchUrl
 * @param {Function} options.fetchMatchData - 获取单场赛事数据，默认使用 fetchUrl
 * @param {Function} options.fetchReplayList - 获取回放列表，默认使用 fetchUrl
 */
async function updatePE(_hours, options = {}) {
  const baseDir = options.baseDir || process.cwd()
  const fetchMatchList = options.fetchMatchList
    || (() => fetchUrl("http://v0-sc.miguvideo.com/vms-match/v6/staticcache/basic/match-list/normal-match-list/0/all/default/1/miguvideo"))
  const fetchMatchData = options.fetchMatchData
    || ((mgdbId) => fetchUrl(`https://vms-sc.miguvideo.com/vms-match/v6/staticcache/basic/basic-data/${mgdbId}/miguvideo`))
  const fetchReplayList = options.fetchReplayList
    || ((mgdbId) => fetchUrl(`http://app-sc.miguvideo.com/vms-match/v5/staticcache/basic/all-view-list/${mgdbId}/2/miguvideo`))

  const date = new Date()
  const start = date.getTime()
  // 获取PE数据
  const datas = await fetchMatchList()
  printGreen("PE数据获取成功！")
  // console.dir(datas, { depth: null })

  // 屏蔽所有TV分类
  if (ignoreCategorySet.has("TV")) {
    // 创建写入开头
    writeFile(`${baseDir}/interface.txt.bak`, `#EXTM3U x-tvg-url="\${replace}/playback.xml" catchup="append" catchup-source="?playbackbegin=\${(b)yyyyMMddHHmmss}&playbackend=\${(e)yyyyMMddHHmmss}"\n`)
    // txt
    writeFile(`${baseDir}/interfaceTXT.txt.bak`, "")
  } else {
    copyFileSync(`${baseDir}/interface.txt`, `${baseDir}/interface.txt.bak`, 0)
    copyFileSync(`${baseDir}/interfaceTXT.txt`, `${baseDir}/interfaceTXT.txt.bak`, 0)
  }

  const interfacePath = `${baseDir}/interface.txt.bak`
  const interfaceTXTPath = `${baseDir}/interfaceTXT.txt.bak`

  printYellow("开始更新PE...")

  for (let i = 1; i < 4; i++) {
    // 日期
    const date = datas.body?.days[i]
    let relativeDate = `昨天${date.substring(4, 6)}-${date.substring(6, 8)}`
    const dateString = getDateString(new Date())
    if (date == dateString) {
      relativeDate = `今天${date.substring(4, 6)}-${date.substring(6, 8)}`
    } else if (parseInt(date) > parseInt(dateString)) {
      relativeDate = `明天${date.substring(4, 6)}-${date.substring(6, 8)}`
    }
    // 忽略分类
    if (ignoreCategorySet.has(`体育-${relativeDate.substring(0, 2)}`)) {
      printYellow(`PE分类###: 体育-${relativeDate}已屏蔽！`)
      continue
    }

    appendFile(interfaceTXTPath, `体育-${relativeDate},#genre#\n`)
    for (const data of datas.body?.matchList[date]) {

      let pkInfoTitle = data.pkInfoTitle
      if (data.confrontTeams) {
        pkInfoTitle = `${data.confrontTeams[0].name}VS${data.confrontTeams[1].name}`
      }
      // const peResult = await fetch(`http://app-sc.miguvideo.com/vms-match/v5/staticcache/basic/all-view-list/${data.mgdbId}/2/miguvideo`).then(r => r.json())
      const peResult = await fetchMatchData(data.mgdbId)
      try {
        // 比赛已结束
        if (peResult.body.endTime < Date.now()) {
          const replayResult = await fetchReplayList(data.mgdbId)
          let replayList = replayResult.body?.replayList
          if (replayList == null || replayList == undefined) {
            replayList = peResult.body.multiPlayList.replayList
          }
          if (replayList == null || replayList == undefined) {
            printYellow(`${data.mgdbId} ${pkInfoTitle} 无回放`)
            continue
          }
          for (const replay of replayList) {
            if (replay.name.match(/.*集锦|训练.*/) != null) {
              continue
            }
            if (replay.name.match(/.*回放|赛.*/) != null) {
              let timeStr = peResult.body.keyword.substring(7)
              const peResultStartTimeStr = peResult.body.multiPlayList.preList[peResult.body.multiPlayList.preList.length - 1].startTimeStr
              if (peResultStartTimeStr != undefined) {
                timeStr = peResultStartTimeStr.substring(11, 16)
              }
              const competitionDesc = `${data.competitionName} ${pkInfoTitle} ${replay.name} ${timeStr}`
              // 写入赛事
              appendFileSync(interfacePath, `#EXTINF:-1 tvg-id="${pkInfoTitle}" tvg-name="${competitionDesc}" tvg-logo="${data.competitionLogo}" group-title="体育-${relativeDate}",${competitionDesc}\n\${replace}/${replay.pID}\n`)
              appendFileSync(interfaceTXTPath, `${competitionDesc},\${replace}/${replay.pID}\n`)
            }
          }
          continue
        }
        // 比赛未结束
        const liveList = peResult.body.multiPlayList.liveList
        for (const live of liveList) {
          if (live.name.match(/.*集锦.*/) != null || live.startTimeStr == undefined) {
            continue
          }
          const competitionDesc = `${data.competitionName} ${pkInfoTitle} ${live.name} ${live.startTimeStr.substring(11, 16)}`
          // 写入赛事
          appendFileSync(interfacePath, `#EXTINF:-1 tvg-id="${pkInfoTitle}" tvg-name="${competitionDesc}" tvg-logo="${data.competitionLogo}" group-title="体育-${relativeDate}",${competitionDesc}\n\${replace}/${live.pID}\n`)
          appendFileSync(interfaceTXTPath, `${competitionDesc},\${replace}/${live.pID}\n`)
        }
      } catch (error) {
        // 限流不是单条赛事的数据问题，必须上抛中止整轮更新，
        // 否则循环会继续发起请求，并最终用不完整的数据覆盖旧文件
        if (error instanceof RateLimitError) {
          throw error
        }
        printYellow(`${data.mgdbId} ${pkInfoTitle} 更新失败 此警告不影响正常使用 可忽略`)
        // printYellow(error)
      }
    }
    printGreen(`日期 ${date} 更新完成！`)
  }

  // 重命名
  renameFileSync(interfacePath, interfacePath.replace(".bak", ""))
  renameFileSync(interfaceTXTPath, interfaceTXTPath.replace(".bak", ""))
  printGreen("PE更新完成！")
  const end = Date.now()
  printYellow(`PE更新耗时: ${(end - start) / 1000}秒`)
}

/**
 * @param {Number} hours - 更新小时数
 */
async function update(hours) {
  // 处理忽略列表
  if (ignoreCategory != null) {
    if (ignoreCategory.indexOf(",") !== -1) {
      const ignoreCategorySplit = ignoreCategory.split(",")
      for (const categoryString of ignoreCategorySplit) {
        if (categoryString != "") {
          if (!ignoreCategorySet.has(categoryString)) {
            ignoreCategorySet.add(categoryString)
          }
        }
      }
    } else if (ignoreCategory.indexOf("，") !== -1) {
      const ignoreCategorySplit = ignoreCategory.split("，")
      for (const categoryString of ignoreCategorySplit) {
        if (categoryString != "") {
          if (!ignoreCategorySet.has(categoryString)) {
            ignoreCategorySet.add(categoryString)
          }
        }
      }
    } else {
      ignoreCategorySet.add(ignoreCategory)
    }
  }

  if (!(hours % 720)) {
    // 每720小时(一个月)刷新token
    if (userId && token) {
      if (mrefreshToken) {
        await refreshToken(userId, token) ? printGreen("token刷新成功") : printRed("token刷新失败")
      } else {
        printGreen(`跳过token刷新`)
      }
    }
  }

  // TV 与 PE 串行执行，任一环节触发限流都中止整轮更新
  // updateTV/updatePE 内部已保证限流时不做重命名，旧数据不会被半成品覆盖
  try {
    // 未设置TV
    if (ignoreCategorySet.has("TV")) {
      printYellow(`TV更新已屏蔽`)
    } else {
      await updateTV(hours)
    }
    // 未设置PE
    if (ignoreCategorySet.has("PE")) {
      printYellow(`PE更新已屏蔽`)
    } else {
      await updatePE(hours)
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      printRed(`检测到限流，已中止本轮更新: ${error.message}`)
      printRed(`请勿立即重试，建议等待数小时后再次运行`)
      return
    }
    throw error
  }
}

export { updateTV, updatePE }
export default update
