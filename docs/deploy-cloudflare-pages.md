# 静态托管部署（Cloudflare Pages / Netlify）

## 〇、为什么有两份部署

同一份 `dist` 同时部署到了两处，**内容完全一致，只为解决国内可达性**：

| 地址 | 国内直连 | 说明 |
| --- | --- | --- |
| `https://big-fat-fish-chat.netlify.app/` | ✅ 能打开 | **国内请用这个** |
| `https://big-fat-fish-chat.pages.dev/` | ❌ 时通时不通 | `pages.dev` 在国内被间歇性干扰，需要代理 |

实测（国内网络、不走代理）：`*.netlify.app` 的多个站点均返回 200；
`big-fat-fish-chat.pages.dev` 与 `dash.cloudflare.com` 均超时，而同为 Cloudflare 的
`www.cloudflare.com` 正常 —— 说明是**部分域名被针对**，不是 Cloudflare 整体不可用。

两边的免费子域都可能随时间变化，所以**保留两个地址**，哪个能用用哪个。
真要长期稳定，只能换自己的域名。

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

### Netlify 的填法（与上面同一份产物）

Netlify 新版控制台是 Import from Git 或直接拖 `dist` 文件夹。连仓库时填：

| 配置项 | 值 |
| --- | --- |
| Branch to deploy | `main` |
| Base directory | 留空（或 `/`） |
| Build command | `corepack pnpm install && corepack pnpm build` |
| Publish directory | `dist` |
| Node version | `20` |

注意两点：

1. **新站点默认是私有的**，直接访问会返回 `401 Unauthorized`。
   要在项目里点 **Make it public**（或在 Access & security 里关掉访问控制），
   公开之后才是 200。
2. Netlify 的 `Publish directory` 必须是 `dist`，留空会找不到 `index.html`。

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
