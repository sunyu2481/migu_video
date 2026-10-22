import fs from "node:fs"

// 注意：以下写入函数必须使用同步 API。
// 调用方写完 .bak 后会立即同步重命名发布，若这里用异步写入，
// 重命名可能先于写入完成，导致发布出去的是空文件或截断内容。

function createFile(filePath) {
  if (!fs.existsSync(filePath)) {
    writeFile(filePath, "")
  }
}

function writeFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content)
  } catch (error) {
    throw new Error(`${filePath}:写入失败 ${error.message}`)
  }
}

function appendFile(filePath, content) {
  try {
    fs.appendFileSync(filePath, content)
  } catch (error) {
    throw new Error(`${filePath}:追加失败 ${error.message}`)
  }
}

function appendFileSync(filePath, content) {
  try {
    fs.appendFileSync(filePath, content)
  } catch (error) {
    throw new Error(`${filePath}:同步追加失败 ${error.message}`)
  }
}

function readFileSync(filePath) {
  return fs.readFileSync(filePath)
}

function renameFileSync(oldFilePath, newFilePath) {
  try {
    fs.renameSync(oldFilePath, newFilePath)
  } catch (error) {
    throw new Error(`文件重命名失败${oldFilePath} -> ${newFilePath}: ${error.message}`)
  }
}

function copyFileSync(filePath, newFilePath, mode) {
  try {
    fs.copyFileSync(filePath, newFilePath, mode)
  } catch (error) {
    throw new Error(`文件复制失败${filePath} -> ${newFilePath}: ${error.message}`)
  }
}

export { createFile, writeFile, appendFile, appendFileSync, readFileSync, renameFileSync, copyFileSync }
