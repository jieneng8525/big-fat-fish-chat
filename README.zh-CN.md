# 大肥鱼Chat

[English](README.md) | 简体中文

**▶ 在线使用：<https://big-fat-fish-chat.pages.dev/>**

大肥鱼自己做的一个 DeepSeek 聊天客户端。自带 API Key 即可使用，不用注册、不经过任何第三方服务器。

基于 [DeepSeek](https://www.deepseek.com) 官方 API 的**纯静态**聊天客户端。

**没有后端**——浏览器直接连 `api.deepseek.com`，你的 Key 只存在自己浏览器的 localStorage 里，不经过任何第三方服务器。整个站点就是几个静态文件，扔到任何静态托管上就能用。

## 功能

**对话**
- 流式输出、深度思考（thinking 块可折叠）、智能搜索（联网检索并给出引用来源）
- 多版本回答：重新生成后可在 `1/3`、`2/3` 之间切换对比
- 编辑提问、分支切换、从任意节点续写
- 附件上传（图片、PDF、Office 文档）
- Markdown 渲染：代码高亮、表格、KaTeX 公式、Mermaid 图

**数据**
- 会话与附件存在浏览器 IndexedDB，关掉网页不会丢
- 导入 / 导出历史（兼容 DeepSeek 官方导出的 ZIP）
- **全文搜索**：跨所有会话搜标题和正文，关键词高亮

**界面**
- 深浅主题切换
- **壁纸**：从本地目录选图片或视频当背景（仅 Chromium 系浏览器）
- 根据壁纸明暗自动调整文字配色，保证可读性
- 导出对话为 TXT / Markdown / HTML / Word / Excel / PPT
- 快捷键：`Ctrl+K` 新建对话、`Ctrl+F` 搜索、`Esc` 后按 `F2` 停止生成

**其他**
- 用量统计：本地累计 token 并按价目估算费用
- 账号余额：直连官方 `/user/balance` 查真实余额

## 使用

### 方式一：直接在线用

打开部署好的网址，首次使用时在设置里填自己的 [DeepSeek API Key](https://platform.deepseek.com/api_keys) 即可。

### 方式二：自己构建

本仓库**不提供预编译的压缩包或 APK**，原因见[为什么不提供下载](#为什么不提供下载)。

需要 Node.js 20 或以上：

```sh
git clone https://github.com/jieneng8525/big-fat-fish-chat.git
cd big-fat-fish-chat
corepack pnpm install
corepack pnpm dev     # 开发服务器：http://localhost:8090
```

生产构建：

```sh
corepack pnpm build   # 产物在 dist/
```

`dist/` 是一堆纯静态文件，直接上传到任意静态托管（Cloudflare Pages / Vercel / GitHub Pages / Nginx）即可。

**Cloudflare Pages 配置**：

| 配置项 | 值 |
|---|---|
| Build command | `corepack pnpm install && corepack pnpm build` |
| Build output directory | `dist` |

详细步骤和安全自查见 [`docs/deploy-cloudflare-pages.md`](docs/deploy-cloudflare-pages.md)。

## 关于 API Key 的安全性

**Key 只存在你自己浏览器的 localStorage 里**，因为这个项目根本没有服务器可以上传它。

由此带来的后果，需要你知道：

- 换浏览器、换电脑、清站点数据后**要重新填**
- **不要在公共电脑上填自己的 Key**
- 别人打开你部署的网站，看到的是空的输入框，**拿不到你的 Key**

**这个项目永远不会内置 Key。** 如果你 fork 后想给团队做开箱即用的版本，请注意：任何编进前端代码的 Key，用户在 F12 里都能看到明文，等于公开。想真正藏住 Key，只有加服务端代理一条路，那样就不再是纯静态站点了。

## 数据存在哪

全部在本机，不上传任何地方：

| 数据 | 位置 |
|---|---|
| 会话、附件、搜索索引 | IndexedDB 数据库 `chat-demo` |
| API Key、主题、语言等设置 | localStorage `chat-demo:*` |
| 壁纸目录授权 | IndexedDB `chat-demo-wallpaper-handles` |

清除浏览器站点数据会**全部清空**。重要对话请先用「导出所有历史对话」备份。

## 安卓 App

同一套前端也用 [Capacitor](https://capacitorjs.com) 8 套壳成了安卓 App。包名 `chat.bigfatfish.app`，minSdk 24，targetSdk 36。

### 界面可以两种方式加载（远程地址必须是安卓专用）

`capacitor.config.ts` 支持两种，切换只要一条命令：

| 方式 | 界面从哪来 | 打开要联网 | 改代码要重新打包 |
|---|---|---|---|
| **A（默认）** | `dist/` 打进 APK | 不要 | 要 |
| **B** | 你自己部署的网址 | 要 | 不要 |

```sh
# A：把构建产物打进 APK
corepack pnpm cap:sync

# B：让 WebView 加载远程地址（路径必须含 /android）
$env:APP_SERVER_URL="https://你的站点.pages.dev/android/"
corepack pnpm cap:sync
```

#### ⚠ 方式 B 的地址必须在 `/android/` 路径下，否则构建直接失败

**安卓端不能和 PC 网页端、移动网页端共用同一份部署。** 设了不含 `/android` 的地址，
`cap sync` 会直接抛错拒绝构建。原因是共用的后果是**静默失效**，不是报错：

- Capacitor 的原生插件只注入给 App 自己的源。远程页面里
  `window.Capacitor.isNativePlatform()` **仍返回 true**（它判断设备，不判断页面），
  代码于是走进原生分支，而插件实际不可用 —— 下载、分享、用浏览器打开 HTML 全部失效，
  **且不报错、无提示**。
- 本项目的安卓修复都依赖原生侧：edge-to-edge 安全区、FileProvider 分享、存储权限、预览配色。
- 网页版与 App 端能力集不同。`supportsDirectoryFollow()` 在 App 里主动隐藏「跟随目录」入口；
  远程页面如果是通用那份，会把这个不可用的按钮又渲染出来。

所以给安卓单独构建一份、部署到 `/android/` 路径下。地址还必须是 HTTPS
（明文回退主动关闭）。

不设 `APP_SERVER_URL` 时用内置 `dist`，这是默认也是最稳的方式。

### 打一个 APK

必须用 **JDK 21** —— JDK 17 会报 `invalid source release: 21`，JDK 25 会报 `Unsupported class file major version 69`。

```sh
corepack pnpm cap:apk      # 构建 dist -> 同步 -> gradlew assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

> ### ⚠️ 不要把构建好的 APK 直接发给别人，请自己重新编译、自己签名
>
> 上面打出来的包用的是**安卓公用调试证书**（`CN=Android Debug`），
> 这把证书的私钥在所有装了 Android SDK 的机器上都一样。
> 任何人拿到这个 APK，都能用同一把私钥重签一个改过的包，
> 系统会把它当成正常更新直接覆盖安装，并**保留原有的**
> `localStorage`（你的 API Key）和 IndexedDB（全部聊天记录）。
>
> 另外，本项目 `applicationId` 是固定的，两个人各打一份包名相同但签名不同，
> 安卓会报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 装不上；
> 用户常见的"解决办法"是先卸载——**那会连同全部聊天记录一起删掉**。
>
> **如果你要把 APK 交给第二个人：自己生成 keystore、把包名改成你自己的、
> 以你自己的名义签名。** 具体步骤见
> [`docs/android-distribution-warning.md`](docs/android-distribution-warning.md)。
>
> 分发可能带来的系统告警、被厂商安全中心标记、被强制卸载、数据丢失，
> 都超出本项目能控制的范围，**作者不承担责任**。自己编译自己签名是唯一稳妥的做法。

### 安卓端的特有行为

- **状态栏**完全透明，WebView 铺满整屏。页面用 `viewport-fit=cover` 加 `env(safe-area-inset-*)`，壁纸能铺到屏幕边缘。曾经试过给 WebView 加 padding 的做法，会把内容整体推下去、露出一条灰带，已撤销，原因写在 `MainActivity.java` 的注释里。
- **视频壁纸的亮度自动取样在安卓 WebView 里不工作**：`canvas.drawImage(video)` 会抛 `SecurityError`，因为硬件解码的画面进不了可读的 canvas。兜底是固定 45% 白纱，文字可读但深色壁纸会被洗白。这是平台限制，不是 bug。

安卓层另有一批平台特有的坑（edge-to-edge 状态栏、CSS Module 的 hash 不匹配、JDK 与 Gradle wrapper 的要求），动这块之前先看 [`docs/android-notes.md`](docs/android-notes.md)。

## 开发

```sh
corepack pnpm dev     # 开发服务器（热更新）
corepack pnpm type    # 类型检查
corepack pnpm lint    # 代码检查
corepack pnpm build   # 生产构建
```

技术栈：React 18 + TypeScript + Zustand + Rspack（SWC）。

**注意**：跑过 `pnpm build` 之后 `dist/` 会留着旧产物。下次启动 dev 前先删掉它，否则 dev server 会把 `dist` 里的旧文件也当静态资源返回，表现为热更新报 404、CSS 被当成 `text/html`。

## 为什么不提供下载

本仓库**不发布任何预编译产物**——没有网页版压缩包，也没有 APK。这是有意的，不是忘了做。

**网页版**：挂个 zip 其实很容易。不做，是因为预编译包一定会和源码慢慢脱节，而使用者又无从核对手里跑的是哪一版。自己构建只有一条命令。

**APK 的风险要大得多。** `cap:apk` 打出来的包用的是 Android SDK 自带的调试证书，而**这把证书的私钥在所有装了 SDK 的机器上都一样**，密码固定为 `android`。任何人都可以用同一张证书给改过的应用重新签名，Android 会认为这是正常更新——包名相同、签名相同，于是覆盖安装并**保留你原有的数据**。从这个仓库分发 APK，等于把这个风险摊给每一个安装的人。

需要 APK 就自己构建、用只有你掌握的密钥签名。完整理由和三个步骤见 [`docs/android-distribution-warning.md`](docs/android-distribution-warning.md)。

## 已知限制

- **壁纸目录选择**只支持 Chromium 系浏览器（Chrome / Edge）。Firefox、Safari 没有 File System Access API。
- **壁纸自动跟随桌面壁纸做不到**：浏览器读不到 Wallpaper Engine 等软件当前显示的是哪张图，只能手动在目录里选一个文件。原因详见 [`docs/desktop-wallpaper-note.md`](docs/desktop-wallpaper-note.md)。
- **提示词在前端**：用户改一下代码就能改，不能当作安全边界。
- **没有多端同步**：数据在本机，换设备就是空的，除非手动导出导入。
- **DeepSeek 导出的 ZIP 里没有文档原件**：包里只有图片。文档类附件导入后能看到文件名和大小，但点了打不开——因为根本没有文件可打开。这是上游导出格式的限制，不是导入代码或设计的问题；实测一份真实归档 1773 个条目：图片 751、JSON 1022、docx/doc/pdf **0**。详见 [`src/services/chat/history/README.md`](src/services/chat/history/README.md)。

## 致谢

基于 [DeepSeek 官方 chat-demo](https://github.com/deepseek-ai/chat-demo) 修改。

## License

MIT，详见 [LICENSE](LICENSE)。
