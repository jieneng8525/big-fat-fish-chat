# 大肥鱼Chat (Big Fat Fish Chat)

English | [简体中文](README.zh-CN.md)

A **fully static** chat client built on the official [DeepSeek](https://www.deepseek.com) API.

**No backend.** The browser talks to `api.deepseek.com` directly, and your API key lives only in your own browser's localStorage — it never passes through any third-party server. The whole site is a handful of static files you can drop onto any static host.

## Features

**Chat**
- Streaming output, collapsible thinking blocks, and web search with cited sources
- Multiple answer versions: regenerate, then switch between `1/3`, `2/3` to compare
- Edit your question, switch branches, continue from any point in the conversation
- File attachments (images, PDF, Office documents)
- Markdown rendering: syntax highlighting, tables, KaTeX math, Mermaid diagrams

**Data**
- Conversations and attachments persist in the browser's IndexedDB — closing the tab loses nothing
- Import / export history (compatible with ZIP files exported from DeepSeek)
- **Full-text search** across every conversation, with keyword highlighting

**Interface**
- Light and dark themes
- **Wallpaper**: pick an image or video from a local folder as the background (Chromium-based browsers only)
- Text colors adapt automatically to the wallpaper's brightness for readability
- Export conversations to TXT / Markdown / HTML / Word / Excel / PowerPoint
- Shortcuts: `Ctrl+K` new chat, `Ctrl+F` search, `Esc` then `F2` to stop generating

**Other**
- Usage stats: locally accumulated token counts with an estimated cost
- Account balance: queries the official `/user/balance` endpoint for the real balance

## Usage

### Option 1: Use it online

Open the deployed URL and enter your own [DeepSeek API key](https://platform.deepseek.com/api_keys) in Settings the first time.

### Option 2: Download and run — nothing to install

Download the archive from [Releases](releases), extract it, and **double-click `index.html`**. No Node.js, no build step.

### Option 3: Build it yourself

Requires Node.js 20 or newer:

```sh
git clone https://github.com/<your-name>/<repo-name>.git   # replace with this repo's address
cd <repo-name>
corepack pnpm install
corepack pnpm dev     # dev server at http://localhost:8090
```

Production build:

```sh
corepack pnpm build   # output in dist/
```

`dist/` contains only static files. Upload it to any static host (Cloudflare Pages, Vercel, GitHub Pages, Nginx — anything).

**Cloudflare Pages settings**:

| Setting | Value |
|---|---|
| Build command | `corepack pnpm install && corepack pnpm build` |
| Build output directory | `dist` |

See [`docs/deploy-cloudflare-pages.md`](docs/deploy-cloudflare-pages.md) for step-by-step instructions and a security checklist.

## About API key security

**Your key stays in your own browser's localStorage** — this project has no server to upload it to.

The trade-offs you should know about:

- You must **re-enter it** after switching browsers or machines, or after clearing site data
- **Don't enter your key on a public computer**
- Anyone visiting a site you deploy sees an empty input field and **cannot obtain your key**

**This project will never ship a built-in key.** If you fork it and want a turnkey build for your team, be aware: any key compiled into frontend code is visible in plaintext via DevTools, which is effectively publishing it. The only way to actually hide a key is a server-side proxy — and then it's no longer a static site.

## Where data is stored

Everything stays on your machine. Nothing is uploaded anywhere.

| Data | Location |
|---|---|
| Conversations, attachments, search index | IndexedDB database `chat-demo` |
| API key, theme, language and other settings | localStorage `chat-demo:*` |
| Wallpaper folder permission | IndexedDB `chat-demo-wallpaper-handles` |

Clearing browser site data **wipes all of it**. Back up important conversations with "Export all conversation history" first.

## Development

```sh
corepack pnpm dev     # dev server with hot reload
corepack pnpm type    # type check
corepack pnpm lint    # lint
corepack pnpm build   # production build
```

Stack: React 18 + TypeScript + Zustand + Rspack (SWC).

**Note**: after running `pnpm build`, the old `dist/` stays around. Delete it before starting the dev server again — otherwise the dev server also serves those stale files as static assets, which shows up as hot-reload 404s and CSS being served as `text/html`.

## Known limitations

- **Choosing a wallpaper folder** works only in Chromium-based browsers (Chrome, Edge). Firefox and Safari lack the File System Access API.
- **Automatically following your desktop wallpaper is impossible**: browsers cannot read which image Wallpaper Engine (or similar) is currently displaying, so you must pick a file manually. See [`docs/desktop-wallpaper-note.md`](docs/desktop-wallpaper-note.md) for the details.
- **Prompts live in the frontend**: anyone can edit the code to change them, so they are not a security boundary.
- **No cross-device sync**: data is local, so a new device starts empty unless you export and import manually.

## Credits

Based on the official [DeepSeek chat-demo](https://github.com/deepseek-ai/chat-demo).

## License

MIT — see [LICENSE](LICENSE).
