const Koa = require('koa')
const Router = require('koa-router')
const { home, serve } = require('./lib/assets')

// 创建一个 Koa 服务实例
const app = new Koa()
// 创建一个路由的实例
const router = new Router()

// 静态资源请求进来，启用静态服务返回文件
router.get('/', home)
router.get('/assets/:fileName', serve)

const PORT = process.argv.slice(2)[0] || 7000
// 把中间件压入队列，等待执行
app
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(PORT)

console.log(`Server running at http://127.0.0.1:${PORT}/`)
