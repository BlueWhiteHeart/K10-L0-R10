const low = require('lowdb')
const { resolve } = require('path')
const FileSync = require('lowdb/adapters/FileSync')
const { v4: uuidv4 } = require('uuid')

/**
 * 初始化数据库存储
 */
const init = () => {
  // 创建一个数据库实例，这里用 lowdb 的 JSON 存储来模拟数据库而已
  const adapter = new FileSync(resolve(__dirname, './db.json'))
  const db = low(adapter)

  // 初始化数据库，可以看做是数据库的字段定义
  db.defaults({ files: [], count: 0, user: [] }).write()
  return db
}

const db = init()
/**
 * 获取本地 JSON 数据库中指定数据
 * @param {String} field 想要获取的字段属性名
 * @param {Boolean} needValue 是否需要直接返回获取值
 */
const dbGet = (field = 'files', needValue = true) => needValue ? db.get(field).value() : db.get(field)
/**
 * 保存本地 JSON 数据库中指定数据
 * @param {String} field 想要获取的字段属性名
 */
const dbSave = (field = 'files', value) => db.set(field, value).write()
/**
 * 校验本地 JSON 数据库中是否有指定数据
 * @param {String} field 想要获取的字段属性名
 */
const dbCheckData = (field = 'files') => db.has(field).value()
/**
 * 获取默认的存储数据结构
 * @param {String} fileName 想要获取的字段属性名
 */
const getDefaultData = (fileName) => ({ fileName, visitorTimes: 1, visitors: [], downloads: 1, aimTimes: 0 })
/**
 * 校验当前访问用户信息
 * @param {String} fileName 想要获取的字段属性名
 * @param {Object} ctx 默认上下文
 */
const checkUserUUID = ({ fileName, ctx } = {}) => {
  const uuid = ctx.cookies.get('uuid')

  const oldUser = dbGet('user')
  const allFileData = dbGet('files', false)
  const fileData = allFileData.find({ fileName }).value()
  const userData = { visitors: fileData.visitors || [] }
  let newUID = uuid
  if (!uuid) {
    newUID = uuidv4()
    // 给匿名用户种一个 uuid
    ctx.cookies.set('uuid', newUID, {
      maxAge: 10 * 24 * 60 * 1000,
      overwrite: false
    })
  }
  if (!oldUser.includes(newUID)) {
    const allUser = [...oldUser, newUID]
    // 如果当前这个用户是新用户，则需要对总访问人数进行修改保存
    dbSave('user', allUser)
  }
  // 同步当前文件访问人
  if (!userData.visitors.includes(newUID)) {
    userData.visitors.push(newUID)
    userData.visitorTimes = userData.visitors.length
  }
  if (fileData && fileData.fileName) {
    allFileData.find({ fileName }).assign(userData).write()
  } else {
    allFileData.push(getDefaultData(fileName)).write()
  }
}

/**
 * 数据相关持久化操作处理帮助方法
 */
const saveVisitData = ({
  saveDataName = 'files',
  saveField = 'downloads',
  saveValue = '',
  fileName
} = {}) => {
  if (dbCheckData(saveDataName)) {
    const allFileData = dbGet(saveDataName, false)
    const fileData = allFileData.find({ fileName }).value()
    if (fileData && fileData.fileName) {
      allFileData.find({ fileName }).assign({ [saveField]: saveValue || (fileData[saveField] + 1) }).write()
    } else {
      allFileData.push(getDefaultData(fileName)).write()
    }
    // 实时更新 数据库中记录访问文件总个数值，保证和实际值一样
    dbSave('count', dbGet(saveDataName).length)
  } else {
    dbSave(saveDataName, [])
  }
}

module.exports = { dbGet, dbSave, dbCheckData, saveVisitData, checkUserUUID }
