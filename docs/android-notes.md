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
