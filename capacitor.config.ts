import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置。
 *
 * 两种运行方式，差别只有 webDir 里的内容从哪来：
 *
 *   A（当前）：webDir 指向构建产物 dist，打包进 APK。
 *     界面在本地，秒开，离线也能打开；发消息仍然需要联网（模型在服务端）。
 *
 *   B（以后）：设了 APP_SERVER_URL 后，WebView 直接加载该网址。
 *     改代码不用重新打包，但要联网才能打开。
 *
 * 切换方式（不需要改这个文件）：
 *   A：corepack pnpm cap:sync
 *   B：$env:APP_SERVER_URL="https://你的域名"; corepack pnpm cap:sync
 *
 * 之所以现在就把开关留出来：实测项目里没有硬编码绝对路径、publicPath 是 'auto'、
 * 且不使用前端路由，这三项正好是 A/B 切换最容易出问题的地方，这里都不存在。
 * 所以切换成本就是一次 sync，代码一行都不用动。
 */
const serverUrl = (process.env.APP_SERVER_URL ?? '').trim()

const config: CapacitorConfig = {
  appId: 'chat.bigfatfish.app',
  appName: '大肥鱼Chat',
  webDir: 'dist',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          // 远程地址是 https，不允许明文回退
          cleartext: false,
        },
      }
    : {}),
  android: {
    // WebView 里 localStorage / IndexedDB 的持久化由系统负责，默认即可
    allowMixedContent: false,
  },
}

export default config
