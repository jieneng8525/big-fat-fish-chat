# 大肥鱼Chat (Big Fat Fish Chat)

English | [简体中文](README.zh-CN.md)

**▶ Try it now: <https://big-fat-fish-chat.netlify.app/>**

Also deployed at <https://big-fat-fish-chat.pages.dev/>. **Use the Netlify one from mainland China** — the `pages.dev` domain is intermittently unreachable there and needs a proxy, while `netlify.app` opens directly. Both serve the same build from the same commit.

Built and maintained by 大肥鱼 (Big Fat Fish). Bring your own DeepSeek API key — no sign-up, no server of ours.

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

### Option 2: Build it yourself

No prebuilt archive is published. This repo intentionally ships **no** precompiled bundles or APKs — see [Why there are no downloads](#why-there-are-no-downloads).

Requires Node.js 20 or newer:

```sh
git clone https://github.com/jieneng8525/big-fat-fish-chat.git
cd big-fat-fish-chat
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

## Android app

The same frontend also ships as an Android app, wrapped with [Capacitor](https://capacitorjs.com) 8. Package id `chat.bigfatfish.app`, minSdk 24, targetSdk 36.

### Two ways the app can load its UI (remote URLs must be Android-only)

`capacitor.config.ts` supports both; switching costs one command:

| Mode | UI comes from | Needs network to open | Code change needs rebuild |
|---|---|---|---|
| **A (default)** | `dist/` bundled into the APK | No | Yes |
| **B** | A URL you host | Yes | No |

```sh
# A: bundle the built site into the APK
corepack pnpm cap:sync

# B: point the WebView at a remote URL (path must contain /android)
$env:APP_SERVER_URL="https://your-site.pages.dev/android/"
corepack pnpm cap:sync
```

#### ⚠ Mode B requires a `/android/` path — anything else fails the build

**The app cannot share one deployment with the desktop web build or the mobile web build.**
Setting an address without `/android` in the path makes `cap sync` throw and refuse to build.
The reason is that sharing it fails *silently*, not loudly:

- Capacitor injects its native plugins only for the app's own origin. On a remote page,
  `window.Capacitor.isNativePlatform()` **still returns `true`** (it reports the device, not
  the page), so the code takes the native branch while the plugins are unavailable — download,
  share and "open HTML in browser" all break, **with no error shown**.
- Every Android fix here depends on the native side: edge-to-edge insets, FileProvider
  sharing, storage permissions, preview theming.
- The web build and the app build have different capability sets. `supportsDirectoryFollow()`
  deliberately hides the directory-follow control inside the app; a shared web build would
  render it again and it would not work.

So build a separate copy for Android and deploy it under `/android/`. The URL must also be
HTTPS (cleartext fallback is disabled on purpose).

With no `APP_SERVER_URL` set, the bundled `dist` is used — the default and the most robust path.

### Build an APK

Requires **JDK 21** — JDK 17 fails with `invalid source release: 21`, JDK 25 with `Unsupported class file major version 69`.

```sh
corepack pnpm cap:apk      # build dist -> sync -> gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

> ### ⚠️ Never distribute a prebuilt APK — rebuild and sign it yourself
>
> The APK produced above is signed with the **shared Android debug certificate**
> (`CN=Android Debug`), whose private key exists on every machine that has the Android SDK.
> Anyone who receives such an APK can re-sign a modified build with the same identity,
> and Android will treat it as a legitimate update — installing it over the original
> while keeping `localStorage` (your API key) and IndexedDB (every conversation).
>
> Two builds of this project also share the same `applicationId`. If someone else's build
> collides with yours, Android refuses with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, and users
> often "fix" that by uninstalling — which deletes all local chat history.
>
> **If you want to hand an APK to another person: generate your own keystore, change the
> `applicationId` to something you own, and sign it under your own name.** Steps are in
> [`docs/android-distribution-warning.md`](docs/android-distribution-warning.md).
>
> Distribution side effects (OS warnings, vendor security apps flagging it, forced
> uninstall, lost data) are outside this project's control and are **not the author's
> responsibility**. Building and signing it yourself is the only sound path.

### Android-specific behaviour

- **Status bar** is fully transparent and the WebView draws edge to edge. The page uses `viewport-fit=cover` plus `env(safe-area-inset-*)`, so the wallpaper reaches the screen edge. See the note in `MainActivity.java` for the padding approach that was tried and reverted.
- **Automatic wallpaper brightness sampling does not work in Android WebView** for video wallpapers: `canvas.drawImage(video)` throws a `SecurityError` because hardware-decoded frames never enter a readable canvas. The app falls back to a fixed 45% scrim, which keeps text readable but washes out dark wallpapers. This is a platform limitation, not a bug.

The Android layer has its own set of platform traps (edge-to-edge status bar, the CSS Module hash mismatch, the JDK and Gradle wrapper requirements). See [`docs/android-notes.md`](docs/android-notes.md) before changing anything there.

## Development

```sh
corepack pnpm dev     # dev server with hot reload
corepack pnpm type    # type check
corepack pnpm lint    # lint
corepack pnpm build   # production build
```

Stack: React 18 + TypeScript + Zustand + Rspack (SWC).

**Note**: after running `pnpm build`, the old `dist/` stays around. Delete it before starting the dev server again — otherwise the dev server also serves those stale files as static assets, which shows up as hot-reload 404s and CSS being served as `text/html`.

## Why there are no downloads

This repository publishes **no prebuilt artifacts** — no zipped web bundle, no APK. That is deliberate, not an oversight.

**For the web build** it would be trivial to attach a zip. It is still not done, because a prebuilt bundle inevitably drifts from the source and gives people no way to verify what they are running. Building takes one command.

**For the Android APK the stakes are higher.** A `cap:apk` build uses the Android SDK's debug certificate, whose private key is **identical on every machine that has the SDK installed**, with the password `android`. Anyone can re-sign a modified app with the same certificate and Android will treat it as a legitimate update — same package name, same signature, so it installs over the real one and **keeps your existing data**. Distributing such an APK from this repo would put that risk on everyone who installed it.

If you need an APK, build and sign it yourself with a key only you hold. See [`docs/android-distribution-warning.md`](docs/android-distribution-warning.md) for the full reasoning and the three steps.

## Known limitations

- **Choosing a wallpaper folder** works only in Chromium-based browsers (Chrome, Edge). Firefox and Safari lack the File System Access API.
- **Automatically following your desktop wallpaper is impossible**: browsers cannot read which image Wallpaper Engine (or similar) is currently displaying, so you must pick a file manually. See [`docs/desktop-wallpaper-note.md`](docs/desktop-wallpaper-note.md) for the details.
- **Prompts live in the frontend**: anyone can edit the code to change them, so they are not a security boundary.
- **No cross-device sync**: data is local, so a new device starts empty unless you export and import manually.
- **DeepSeek's exported ZIP contains no document originals**: only images are bundled. Document attachments keep their name and size after import but cannot be opened, because there is no file to open. This is a limit of the upstream export format, not of the import code — verified against a real archive (1773 entries: 751 images, 1022 JSON, 0 docx/doc/pdf). See [`src/services/chat/history/README.md`](src/services/chat/history/README.md).
- **`pages.dev` is unreliable in mainland China**: that domain is intermittently blocked there and may need a proxy. The `netlify.app` deployment exists for exactly this reason and opens directly. This is a property of those free domains, not of this project — self-host the `dist/` folder anywhere if neither works for you.

## Credits

Based on the official [DeepSeek chat-demo](https://github.com/deepseek-ai/chat-demo).

## License

MIT — see [LICENSE](LICENSE).
