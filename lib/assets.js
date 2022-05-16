const fs = require('fs')
const { extname, resolve } = require('path')
const zlib = require('zlib')
const wwwroot = resolve(__dirname, '../wwwroot/')
const { saveVisitData, checkUserUUID, dbCheckData, dbGet, dbSave } = require('./database')
const { log } = console

const mimeType = {
  '.plain': 'text/plain',
  '.ico': 'image/x-icon',
  '.md': 'text/plain',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.eot': 'application/vnd.ms-fontobject',
  '.ttf': 'application/font-sfnt'
}
/**
 * 处理服务器基础返回的内容
 */
const dealResponse = ({ ctx, responseType = 'plain', status = 404, resBody }) => {
  ctx.status = status
  ctx.type = mimeType[`.${responseType}`]
  ctx.body = resBody
  return ctx
}

/**
 * 处理服务器基础返回内容，同时设置相关页面缓存，如果命中缓存信息，直接返回
 */
const dealResponseCache = ({ ctx, extType, status = 200, expectedModified, isModified = false }) => {
  ctx.status = status
  isModified ? ctx.set('Content-Type', mimeType[extType]) : (ctx.type = mimeType[extType])
  ctx.set('Cache-Control', 'max-age=3600')
  ctx.set('Last-Modified', new Date(expectedModified).toGMTString())
  if (isModified) {
    return ctx.res.end()
  }
}

// 封装一个流操作完成的 Promise
const streamEnd = fd => new Promise((resolve, reject) => {
  fd.on('end', () => resolve())
  fd.on('finish', () => resolve())
  fd.on('error', reject)
})

const buildHtml = (framents) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>static server</title>
</head>
<body style="text-align: center">
    <h1>静态资源列表：</h1>
    <table style="margin: 0 auto; text-align: left;">
      <tr><td>文件</td><td>查看总人数</td><td>&nbsp;&nbsp;查看总次数</td><td>总命中缓存次数</td></tr>
      ${framents.join('')}
    </table>
</body>
</html>
`

exports.home = async ctx => {
  try {
    const framents = []
    const filesMap = {}

    if (dbCheckData()) {
      const filesData = dbGet()
      filesData.forEach(item => {
        filesMap[item.fileName] = item
      })
    } else {
      dbSave('files', [])
    }

    fs.readdirSync(wwwroot)
      .map(file => {
        const currFileData = filesMap[file] || { visitorTimes: 0, downloads: 0, aimTimes: 0 }
        const visitorTimes = currFileData.visitorTimes
        const downloads = currFileData.downloads
        const aimTimes = currFileData.aimTimes
        const fileHtml = `<td><a href="/assets/${file}">${file}</a></td>`
        const downloadHtml = `<td>| ${visitorTimes} </td>
      <td>| 已查看 ${downloads} 次</td>
      <td>| 命中缓存 ${aimTimes} 次</td>`
        framents.push(`<tr>${fileHtml}${downloadHtml}</tr>`)
      })
    log('visit : home')
    return dealResponse({ ctx, responseType: 'html', status: 200, resBody: buildHtml(framents) })
  } catch (error) {
    log(error.message)
    return dealResponse({ ctx, resBody: '服务器异常啦！！' })
  }
}

exports.serve = async ctx => {
  const fileName = ctx.params.fileName
  const filePath = resolve(wwwroot, `${fileName}`)

  // 参数合法性校验
  // 1. 非允许后缀的资源不予返回
  // 2. 若后缀合法，判断文件是否存在
  const extType = extname(fileName)

  // 如果有文件后缀名 则判断是否为符合规范的后缀名
  // 如果无文件后缀名 则认定为文件夹路径，可以判断路径是否为当前服务器下有效的文件夹路径
  if ((extType && !mimeType[extType]) || !fs.existsSync(filePath)) {
    return dealResponse({ ctx, resBody: `${fileName} 文件找不到啦！！` })
  }

  try {
    // 3. 若文件存在，判断是否是文件类型
    const fStat = fs.statSync(filePath)
    if (!fStat.isFile()) {
      return dealResponse({ ctx, resBody: `${fileName} 是一个文件夹路径呀！！！` })
    }

    // 5. 更新下载次数
    saveVisitData({ fileName })

    // 6. 记录当前访问信息
    checkUserUUID({ fileName, ctx })

    // 7. 304 缓存有效期判断, 使用 If-Modified-Since，用 Etag 也可以
    const modified = ctx.headers['if-modified-since']
    const expectedModified = new Date(fStat.mtime).toGMTString()

    if (modified && modified === expectedModified) {
      saveVisitData({ saveField: 'aimTimes', fileName })
      log(`aimed : ${fileName}`)
      return dealResponseCache({ ctx, extType, status: 304, expectedModified, isModified: true })
    }

    // 8. 文件头信息设置
    log(`first visit : ${fileName}`)
    dealResponseCache({ ctx, extType, expectedModified })

    // 9. gzip 压缩后，把文件流 pipe 回去
    const stream = fs.createReadStream(filePath, {
      flags: 'r'
    })
    stream.on('error', () => {
      ctx.res.end()
    })
    // 10. 根据请求头响应返回内容的压缩格式
    let rs
    const acceptEncoding = ctx.headers['accept-encoding']
    if (acceptEncoding.indexOf('gzip') > -1) {
      ctx.set('Content-Encoding', 'gzip')
      rs = stream.pipe(zlib.createGzip()).pipe(ctx.res)
    } else if (acceptEncoding.indexOf('deflate') > -1) {
      ctx.set('Content-Encoding', 'deflate')
      rs = stream.pipe(zlib.createDeflate()).pipe(ctx.res)
    } else {
      rs = stream.pipe(ctx.res)
    }

    await streamEnd(rs)
    log('streamEnd')
  } catch (error) {
    log(error.message)
    return dealResponse({ ctx, resBody: `${fileName} 文件找不到啦！！` })
  }
}
