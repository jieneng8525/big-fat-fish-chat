# Cloudflare Pages 部署配置

## 一、这个项目部署时要注意什么

**不需要任何服务端逻辑。** 这是纯静态站点：构建产物 `dist/` 里只有 HTML/CSS/JS
和图标，浏览器直接和 `api.deepseek.com` 通信，没有中间层。

**没有前端路由。** 应用不使用 URL 路由（没有 react-router，也不改 location），
所有状态在内存和 IndexedDB 里，URL 永远是 `/`。所以**不需要配置 SPA 404 回退**——
这一点和常见的前端项目不同，别照抄别人的 `_redirects` 规则。

**资源路径是相对 + 根绝对混用：**
- JS / CSS 用相对路径（`static/js/main.xxx.js`）
- favicon 用绝对路径（`/favicon.svg`）

因此**必须部署在域名根目录**。Cloudflare Pages 默认就是根目录
（`https://<项目名>.pages.dev/`），满足条件；如果以后绑自定义域名挂到子路径，
favicon 会 404。

## 二、第一次部署

1. 把项目推到 GitHub 仓库
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. 选仓库，配置构建：

| 配置项 | 值 |
|---|---|
| Framework preset | None |
| Build command | `corepack pnpm install && corepack pnpm build` |
| Build output directory | `dist` |
| Node version | 20 或以上（环境变量 `NODE_VERSION=20`） |

**构建不需要任何环境变量。** 项目不内置 Key，产物里也不会有 Key。

## 三、怎么确认部署的产物是安全的

部署完，打开网址按 F12 → Sources，搜 `sk-`。

**搜不到任何 `sk-` 开头的字符串，才算安全。**

这个项目不内置 Key —— Key 由每个用户在浏览器里自己填，不会进入构建产物。
万一搜到了，说明有人往代码里硬编码了 Key，**立刻去 DeepSeek 控制台吊销它**。

本地也能先查一遍：

```powershell
# 在项目根目录执行
Remove-Item dist -Recurse -Force
corepack pnpm build
Select-String -Path "dist\static\js\*.js" -Pattern '(?<![A-Za-z])sk-[A-Za-z0-9]{20,}'
```

没有输出 = 安全。

**注意正则里的 `(?<![A-Za-z])`**：不加它的话，`task-list`、`mask-_4f2ab`
这类 CSS 类名里的 `sk-` 会造成误报，白紧张一场。

## 四、用法（给使用者看）

打开网址后**第一次会要求填 API Key**，填自己的 DeepSeek Key。

Key 只存在该浏览器的 localStorage，不会上传到任何服务器——
因为这个项目根本没有服务器。**换浏览器或清站点数据后要重新填。**

## 五、给团队用怎么办

**不要内置 Key。** 这是个纯静态站点，任何人打开都能读走前端代码。

如果想给团队一个「打开就能用、不用填 Key」的版本，只有一条路：
**加服务端代理**，让请求从服务器发到 `api.deepseek.com`，Key 存在服务器上。
那样 Key 藏得住，但需要一台服务器和访问控制（否则谁都能白嫖你的余额），
就不再是纯静态站点了。

**纯静态 + 不填 Key + 不泄露，这三件事无法同时成立。**

## 六、以后更新

改了代码 push 到仓库，Cloudflare 自动重新构建部署。

**注意**：本地跑过 `pnpm build` 之后，`dist/` 会留着旧产物。
下次启动 dev 前先删掉它，否则 dev server 会把旧文件当静态资源一起返回，
表现为 HMR 报 404、CSS 被当成 `text/html`（做过一次，排查了很久）。
