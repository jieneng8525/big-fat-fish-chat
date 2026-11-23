# Android app notes

Notes on the Android (Capacitor) build: what the platform forces, and what was tried and rejected. Written for whoever touches the Android layer next — including future me.

Source: `E:\Agent\project\DSH workplace\ds-chat`
APK: `android/app/build/outputs/apk/debug/app-debug.apk`
Package: `chat.bigfatfish.app`
Stack: Capacitor 8.6.2 / AGP 8.13.0 / Gradle 8.14.3 / compileSdk 36 / minSdk 24 / targetSdk 36

## Build

```powershell
cd "E:\Agent\project\DSH workplace\ds-chat"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = 'F:\jdk21\jdk-21.0.5+11'
corepack pnpm cap:apk     # build dist -> cap sync -> gradlew assembleDebug
```

or step by step:

```powershell
corepack pnpm build                       # 1. rebuild dist
corepack pnpm exec cap sync android       # 2. copy into the android project
cd android; .\gradlew.bat assembleDebug   # 3. rebuild the APK
# 4. confirm the APK timestamp is new
```

---

## Resolved: grey bar in the status bar area

**Symptom**: a grey strip sat over the UI at the very top, and the wallpaper did not reach the top edge.

**Root cause**: `ViewCompat.setOnApplyWindowInsetsListener` was adding `padding(bars.top)` to `android.R.id.content`. That pushed the whole WebView down by the status bar height (~63px on the test device), and the strip showing through was the window background — not a status bar colour problem at all.

Evidence: `adb shell dumpsys window windows` showed the window frame at `[0,0][1080,2400]` with `EDGE_TO_EDGE_ENFORCED`, i.e. the window was fine and the content had been pushed away.

**Fix**: do not add padding. Let the WebView fill the screen; the safe area is handled by the page itself (`viewport-fit=cover` + `env(safe-area-inset-*)`). `MainActivity` also makes the window background transparent so nothing grey can show through while the WebView is drawing.

Things tried that did **not** work, because the activity was not using the theme being edited:

1. Changing the `AppTheme` parent from `Light.DarkActionBar` to `DayNight.NoActionBar`
2. Transparent status bar in `AppTheme.NoActionBar` — the activity does not use this theme
3. Transparent status bar in `AppTheme.NoActionBarLaunch`
4. `values-v35/styles.xml` override

Verify which theme an activity actually uses:

```powershell
$aapt = "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\aapt2.exe"
$apk = 'android\app\build\outputs\apk\debug\app-debug.apk'
& $aapt dump xmltree $apk --file AndroidManifest.xml | Select-String 'theme'
& $aapt dump resources $apk | Select-String 'NoActionBarLaunch' -Context 0,10
```

`0x01010451=@0x0106000d` means `statusBarColor = @android:color/transparent`.

---

## Resolved: HTML code block preview opened as a new window and quit the app

**Symptom**: tapping "open in browser" on an HTML code block opened it, but pressing Back or swiping right closed the whole app instead of returning to the chat.

**Four Web-layer approaches were tried and all failed** (all measured on Android 17 / API 37 emulator):

| Approach | Result |
|---|---|
| `window.open(blobUrl, '_blank')` | System took over as an in-place window; Back exits the app |
| `Browser.open('data:text/html;base64,...')` | `Unable to display URL` — Chrome Custom Tabs refuse `data:` |
| `location.href = blobUrl` | No history entry created, so Back still exits (measured `history.length === 1`) |
| `Share.share({ url })` | Works, but it is a share sheet, not a browser |

**What works**: a custom Capacitor plugin that writes the HTML into the app cache, converts it through `FileProvider` to a `content://` URI, and fires `Intent.ACTION_VIEW`. That launches a **separate browser process**, so Back returns to the app.

Files: `android/app/src/main/java/chat/bigfatfish/app/OpenInBrowserPlugin.java`,
`android/app/src/main/res/xml/file_paths.xml` (needs `cache-path`, already present by default),
`src/services/nativeShell.ts` (`openHtmlNatively`).

### ⚠ Registration order matters

```java
registerPlugin(OpenInBrowserPlugin.class);   // MUST come first
super.onCreate(savedInstanceState);
```

`BridgeActivity.onCreate` calls `this.load()` internally, which runs `bridgeBuilder.create()`. After that the plugin list is frozen. Registering **after** `super.onCreate` compiles fine and lands in the APK, but `window.Capacitor.Plugins.OpenInBrowser` is `undefined` at runtime. This cost a debugging round — check with:

```
adb shell ...  # then via CDP:
Object.keys(window.Capacitor.Plugins)
```

---

## Downloads in the app

`<a download>` does nothing useful inside a WebView — there is no `DownloadListener`, so it looks like the browser jumps to a download page and never downloads.

`saveToDownloads` in `nativeShell.ts` writes through `Filesystem` into `Directory.Documents` (public, survives uninstall) and then raises the system share sheet so the user decides where it goes.

**Re-entrancy guard**: `Share.share()` stays pending until the user picks something. Calling it again while the sheet is open throws `Can't share while sharing is in progress`, which the caller would surface as a bogus "save failed". The `shareInFlight` flag prevents that; the file is already on disk by then, so a suppressed sheet is not an error.

---

## Preview HTML follows the browser colour scheme

`src/services/previewTheme.ts` wraps the model-generated HTML and injects a `<style>` with `color-scheme: light dark` plus a `@media (prefers-color-scheme: dark)` block.

Two constraints drove the implementation:

1. **Do not parse and re-serialise** the HTML with `DOMParser` — that rewrites self-closing tags and attribute order, changing content the model produced. Only minimal string surgery is done.
2. **Insert before the model's own styles** so the injected rules have lower priority and only fill in what the model left undefined. A model that writes `body { background: #fff }` keeps its own colour.

Handled shapes: full document with `<head>`, full document without `<head>`, bare fragment, and a fragment that already carries `<!doctype>`.

Note `prefers-color-scheme` follows the **system** setting (mobile Chrome has no independent theme switch), so "follows the browser" means "follows the OS".

---

## Not a bug: light theme keeps dark sidebar when a video wallpaper is set

**Symptom**: with the light theme selected and a *video* wallpaper, the sidebar and input box stay dark-coloured.

**This is a deliberate trade-off, not a defect.** The chain:

1. On Android WebView, sampling the brightness of a hardware-decoded video frame throws `SecurityError` (`canvas.getImageData()` gets no pixels), so `wallpaperBrightness` is always `null`.
2. `isDarkWallpaper(null)` returns `false` on purpose (see `WallpaperLayer.tsx`), so the `onDarkWallpaper` class is never applied.
3. Therefore the dark variable block in `theme.css` (`body[data-ds-dark-theme], body.light .onDarkWallpaper`) does not activate, and semi-transparent surfaces let the dark wallpaper show through.

**Why not just treat "unknown brightness" as dark** — that was tried and reverted: it applied the entire dark variable set in the light theme, turning the sidebar and input box dark and replacing "text is hard to read" with "the whole UI is dark". Swapping one problem for another is not a fix.

**Current mitigation**: `computeScrim(null)` returns a 45% white scrim. Text stays readable; the cost is that dark video wallpapers get washed out.

**Practical advice**: in the light theme, use an image wallpaper rather than a video one, or switch to the dark theme.

---

## Two CSS traps in this project

### A. CSS Module class names carry a hash

`src/app/App.module.css` is a CSS Module — `styles.onXX` compiles to `onXX-9fdf5`. `src/app/theme.css` is plain CSS and has no hash.

**Consequence**: rules like `body.light .onDarkWallpaper{...}` in `theme.css` can never match `className={styles.onDarkWallpaper}` in JSX, because the real class is `onDarkWallpaper-9fdf5`.

**Current handling**: `App.tsx` deliberately uses the string `'onDarkWallpaper'` (pinned with `:global()` in `App.module.css`) instead of `styles.onDarkWallpaper`. Do not "tidy" that into `styles.` — it silently disables the whole block.

Verify it survived a build:

```powershell
Select-String -Path "dist\static\css\main.*.css" -Pattern 'body\.light \.onDarkWallpaper'
```

### B. Editing CSS without rebuilding shows stale output

Running only `pnpm type` / `pnpm lint` after a style change leaves `dist/` stale, so the phone installs the old bundle and it looks like the fix did nothing. Always rebuild and `cap sync` (see Build above).

One near-miss: searching the bundle for `translateX(-16px)` found nothing, which looked like "old code did not make it into the package" — but Rspack had minified it to `translate(-16px)`. Semantically identical. Keep search patterns loose when checking build output.

---

## Toolchain gotchas

### 1. JDK must be 21

| JDK | Result |
|---|---|
| Android Studio bundled JBR 25 | `Unsupported class file major version 69` (Gradle 8.14 supports up to 24) |
| JDK 17 | `invalid source release: 21` (Capacitor 8 sources target Java 21) |
| **JDK 21** | works |

Installed at `F:\jdk21\jdk-21.0.5+11`, referenced from `android/gradle.properties` via `org.gradle.java.home`.

### 2. The Gradle wrapper download times out

`gradlew.bat` uses a 10-second read timeout, which fails on a slow/VPN link:

```
Downloading ...gradle-8.14.3-all.zip failed: timeout (10000ms)
```

Fix: place the 214MB zip manually under
`%USERPROFILE%\.gradle\wrapper\dists\gradle-8.14.3-all\10utluxaxniiv4wxiphsi49nj\`.

### 3. `&` in `package.json` becomes `\u0026`

PowerShell's `ConvertTo-Json` escapes `&&` as `\u0026\u0026`, which the Capacitor parser rejects with `Invalid package.json`. **Edit that file as text; do not rewrite it with `ConvertTo-Json`.**

### 4. PowerShell treats Gradle's stderr as failure

With `gradlew.bat ... 2>&1 | Select-Object`, `$LASTEXITCODE` is `1` even on success. **Judge by the `BUILD SUCCESSFUL` string in the output, not the exit code.**

---

## Resolved: voice input and camera did nothing — no permissions declared

**Symptom**: the mic button entered "recording" but transcription always failed, and picking a photo could never reach the camera. On the phone the app appeared to "not have asked for microphone or camera permission at all".

**Root cause**: `AndroidManifest.xml` declared only `INTERNET`. That is the whole story — **Capacitor 8.6.2 already implements the runtime side correctly**; it just has nothing to ask for.

The chain, from `node_modules/@capacitor/android/.../BridgeWebChromeClient.java`:

| Call | What it does | What happens when the permission is not in the manifest |
|---|---|---|
| `onPermissionRequest` | maps `RESOURCE_AUDIO_CAPTURE` → `MODIFY_AUDIO_SETTINGS` + `RECORD_AUDIO`, then `permissionLauncher.launch(...)` | launching an **undeclared** permission is silently refused by the system → listener gets `false` → `request.deny()` → the page's `getUserMedia` throws `NotAllowedError` |
| `isMediaCaptureSupported` | returns `hasPermissions(CAMERA) \|\| !hasDefinedPermission(CAMERA)` | `hasDefinedPermission` reads the **manifest**, so an undeclared `CAMERA` makes this return `true` — it looks allowed, the camera activity launches, but the app itself holds no `CAMERA` grant |

`PermissionHelper.hasDefinedPermission()` compares against `getManifestPermissions()`, i.e. the manifest, **not** the runtime grant state. That is the detail that makes an undeclared permission look like "the plugin is broken".

**Fix** — three lines in the manifest, no Java:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

Plus `uses-feature ... required="false"` for `microphone`, `camera.any`, **and `camera`**. Declaring `CAMERA` makes Gradle implicitly require `android.hardware.camera` (rear camera), which would hide the app from devices without one. Check both lists:

```powershell
$aapt = (Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" -Directory | Sort-Object Name -Descending)[0]
& (Join-Path $aapt.FullName 'aapt2.exe') dump permissions android\app\build\outputs\apk\debug\app-debug.apk
& (Join-Path $aapt.FullName 'aapt2.exe') dump badging    android\app\build\outputs\apk\debug\app-debug.apk | Select-String 'uses-feature'
```

Expected: all three `uses-permission` lines present, and every `uses-feature` line prefixed `uses-feature-not-required:`.

### Do not write your own onPermissionRequest handler

The first attempt here was a `WebPermissionBridge.java` implementing `ActivityCompat.requestPermissions` plus an `OnRequestPermissionsResult` callback. **It was unnecessary and was deleted.** Capacitor's `BridgeWebChromeClient` already grants/denies correctly through `registerForActivityResult`; re-implementing it risks double-requesting and loses the `MODIFY_AUDIO_SETTINGS` pairing.

### Verified end to end on the real device (RMX3800, Android 16, WebView 156)

Camera:

1. Tap **拍照** → `dumpsys activity activities` shows `topResumedActivity=com.android.permissioncontroller/.permission.ui.GrantPermissionsActivity`
2. Allow → `dumpsys package chat.bigfatfish.app` shows `CAMERA: granted=true`, and the top activity becomes `com.oplus.camera/.component.CapturePhotoActivity`
3. Shutter → confirm → back in the app, and the photo appears as an attachment (`JPEG_20261123_103026_….jpg` in the input area)

Microphone:

1. Tap mic → logcat `OplusAudioRecordInfoUploadHelper: broadcastVoipRecordState() PackageName:chat.bigfatfish.app, isVoipNow:true`
2. The input area swaps the textarea for a live spectrum — proof the audio graph is actually running
3. Stop → the page issues `POST https://api.deepseek.com/v1/tools/asr` and gets `200` with `duration_ms: 65536`

Note the empty transcript (`"text":""`, toast `未识别到语音内容`) is **not** a failure: audio really was captured and uploaded, there just was nobody speaking into the phone. Judge voice input by the ASR round trip, not by whether text appears.

### Two gotchas while testing permissions over adb

- `adb shell pm grant` fails on this ROM: `SecurityException: grantRuntimePermission: Neither user 2000 nor current process has GRANT_RUNTIME_PERMISSIONS`. Grant through the UI instead.
- `adb shell input tap x y` uses **physical** pixels. The screenshot preview shown in a viewer is often downscaled, so coordinates read off the preview miss. Get exact bounds from `adb shell uiautomator dump` → `bounds="[l,t][r,b]"`, then tap the centre.

---

## Attachment sheet (拍照 / 相册 / 文件)

Tapping the paperclip used to open `<input type="file">` with no `accept`, so Android dropped straight into the file manager — finding a photo meant browsing a directory tree. It now raises a sheet under the input box, matching the official app.

Three separate `<input type="file">` elements do the work; the differences are entirely in `accept` / `capture`:

| Entry | Attributes | Android result |
|---|---|---|
| 拍照 | `accept="image/*" capture="environment"` | camera opens directly |
| 相册 | `accept="image/*" multiple` | photo picker |
| 文件 | `accept={ACCEPT} multiple` | file manager |

**`capture` must not be set on the gallery input** — any `capture` makes Android skip the picker and go straight to the camera, which is the problem being fixed.

**All three inputs stay mounted.** Chromium only honours `input.click()` inside the user-gesture task; mounting the input after a close animation detaches the click from the gesture and the picker never opens. The sheet animates `grid-template-rows: 0fr → 1fr` and the inputs live outside that.

`capture` is only applied when `isNative()` — on the web a `capture` hint does nothing useful on desktop and can confuse mobile Safari.
