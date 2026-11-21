# Android APK 两个待修问题 — 交接说明

> 写给接手的人（手机端 DSH）：这份文档是自包含的，不需要之前的对话记录。
> 所有"已查实"的结论都附了验证命令，你可以自己重跑一遍确认，不要盲信。

---

## 项目背景（30 秒看懂）

一个用 React + Rspack 写的纯前端聊天客户端，用 Capacitor 8 套壳成 Android APK。

```
源码:  E:\Agent\project\DSH workplace\ds-chat
APK:   android\app\build\outputs\apk\debug\app-debug.apk
包名:  chat.bigfatfish.app
技术:  Capacitor 8.6.2 / AGP 8.13.0 / Gradle 8.14.3 / compileSdk 36 / minSdk 24 / targetSdk 36
```

**构建命令**（必须用 JDK 21，别的版本会失败，原因见文末"踩过的坑"）：

```powershell
cd "E:\Agent\project\DSH workplace\ds-chat"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = 'F:\jdk21\jdk-21.0.5+11'
corepack pnpm build                              # 构建网页产物到 dist/
corepack pnpm exec cap sync android              # 拷进 android 工程
cd android; .\gradlew.bat assembleDebug
```

---

## 问题 1：顶部状态栏有一条灰色横条

### 现象

App 打开后，屏幕最顶端（手机状态栏位置）有一条灰色横条压在界面上，
壁纸没有铺到屏幕最上沿。

### 已查实的事实

| 事实 | 验证方式 |
|---|---|
| `targetSdkVersion = 36` | `aapt2 dump badging app-debug.apk \| findstr targetSdk` |
| MainActivity 使用的主题是 `AppTheme.NoActionBarLaunch`（不是 `NoActionBar`） | `aapt2 dump xmltree app-debug.apk --file AndroidManifest.xml`（看 activity 的 `android:theme`，得到 `@0x7f0e0007`，再 `dump resources` 查这个 ID 对应 `style/AppTheme.NoActionBarLaunch`） |
| 该主题里 `statusBarColor` 确实已设为 transparent | `aapt2 dump resources` 查 `style/AppTheme.NoActionBarLaunch`，看到 `0x01010451=@0x0106000d`（`0x0106000d` = `@android:color/transparent`） |
| MainActivity 里已有 edge-to-edge 代码，且已编译进 dex | 解压 APK 用文本搜 `classes.dex`，能找到 `setDecorFitsSystemWindows`、`setStatusBarColor` |
| **改完之后灰条依然存在** | 用户实机截图确认 |

### 已经试过、但无效的做法

1. 改 `AppTheme` 父主题从 `Light.DarkActionBar` 到 `DayNight.NoActionBar` —— 无效
2. 在 `AppTheme.NoActionBar` 里写透明状态栏 —— 无效（**因为 MainActivity 根本不用这个主题**）
3. 在 `AppTheme.NoActionBarLaunch` 里写透明状态栏 —— 无效
4. 加 `values-v35/styles.xml` 覆盖 —— 无效
5. `MainActivity.java` 里用代码 `WindowCompat.setDecorFitsSystemWindows(window, false)` +
   `window.setStatusBarColor(Color.TRANSPARENT)` +
   `ViewCompat.setOnApplyWindowInsetsListener` 给内容加 padding —— 无效

### 我的判断（未证实，供参考）

`targetSdk 36` 意味着 Android 15（API 35）起的强制 edge-to-edge 生效。
在这个模式下，系统的 `statusBarColor` 会被忽略，**但内容是否真的铺到屏幕边缘**，
取决于 WebView 容器本身有没有被系统栏 inset 推开。

`ViewCompat.setOnApplyWindowInsetsListener` 给 `android.R.id.content` 加 padding 的做法，
可能反而把 WebView 往下推了 `bars.top` 那么多 —— **灰条的高度和状态栏高度一致**，
症状上很像"内容被 inset 推开，露出了底下的 window background"。

**建议优先排查方向**：
- 去掉 `setOnApplyWindowInsetsListener` 里的 `view.setPadding(...)`，改成只把 inset 传给 WebView；
- 或者给 `window.setBackgroundDrawable(Color.TRANSPARENT)`，让 window 本身透明；
- 或者确认 `Theme.SplashScreen` 的 `postSplashScreenTheme` 是否真的切到了 `NoActionBar`。

**没有验证过，别当成结论。**

---

## 问题 2：浅色主题下侧边栏和输入框仍然是深色

### 现象

App 内选「浅色」主题，但侧边栏、输入框、气泡仍然保持深色外观；
浅色主题本身（文字颜色）回来了。

### 已查实的事实

| 事实 | 验证方式 |
|---|---|
| APK 里的 `isDarkWallpaper` 是 `e => null !== e && e < .5` | 解压 APK，从 `assets/public/static/js/main.*.js` 里搜 `null!==e&&e<.5` |
| `computeScrim` 里 `null` 分支给 `.45` | 同上，搜 `null===e?.45` |
| 所以 `null` 时 `isDarkWallpaper` 返回 **false**，不会挂 `onDarkWallpaper` 类 | 逻辑推演 |
| CSS 里 `body.light .onDarkWallpaper{...}` 规则存在 | 解压 `assets/public/static/css/main.*.css` 搜 `onDarkWallpaper` |
| CSS 里 `body.light .onWallpaper-xxx{--dsw-alias-label-secondary:#41464b;...}` 存在 | 同上 |

### 排除了的可能

- **不是 `onDarkWallpaper` 造成的**：`brightness` 为 null 时它返回 false，类不会挂上
- **不是主题切换逻辑坏了**：APK 里 `classList.toggle("light","light"===e)` 逻辑正确

### 尚未查的方向（建议从这里开始）

1. **`themePreference` 到底是不是 `light`**
   主题偏好在 `localStorage['chat-demo:theme-preference']`。
   如果它是 `system`，系统深色时就会走深色分支——**这可能根本不是 bug**。
   在 App 里用 `chrome://inspect` 或者 WebView 调试，读一下这个值。

2. **壁纸层是否真的没生效 / 是否整个界面被压暗了**
   用户描述"侧栏和底框保持深色"。如果只是深色壁纸透过来，
   那可能是 `--dsw-specific-sidebar-fill` 在浅色主题下本身就是半透明，透出了壁纸。
   查 `theme.css` 里浅色主题下 `--dsw-specific-sidebar-fill` 的值。

3. **`App.tsx` 里 `onWallpaper` / `onDarkWallpaper` 的挂载条件**
   相关代码在 `src/app/App.tsx` 约 100-130 行，`hasWallpaper` 与 `darkWallpaper` 的组合逻辑。

---

## ⚠ 动手前必读：这个项目踩过的两个样式大坑

这两条都是**已经付出过代价**的，改样式前先看一眼，能省几个小时。

### 坑 A：CSS Module 的类名带 hash，和普通 CSS 对不上

`src/app/App.module.css` 是 **CSS Module**，`styles.onXX` 编译后是 `onXX-9fdf5`（带文件 hash）。
`src/app/theme.css` 是**普通 CSS**，里面的 `.onXX` 不带 hash。

**后果**：`theme.css` 里写的 `body.light .onDarkWallpaper{...}` 永远匹配不到
JSX 上的 `className={styles.onDarkWallpaper}`，因为实际加上的是 `onDarkWallpaper-9fdf5`。

**当前的处理**：`App.tsx` 里**故意用字符串** `'onDarkWallpaper'` 而不是 `styles.onDarkWallpaper`。
看到这行不要"顺手改成 styles."，那会让样式整体失效。

**怎么验证有没有生效**：
```powershell
# 构建后，CSS 里应该有一条不带 hash 的 body.light .onDarkWallpaper 规则
Select-String -Path "dist\static\css\main.*.css" -Pattern 'body\.light \.onDarkWallpaper'
```

### 坑 B：改了 CSS 不重新 build，浏览器/APK 里还是旧代码

这个最容易浪费轮次：改完 `.module.css` 只跑了 `pnpm type` / `pnpm lint`，
**没有重新 `pnpm build` 也没 `cap sync`**，手机上装的还是旧包，看起来像"没修好"。

**每次改完样式的完整流程**：
```powershell
corepack pnpm build                       # 1. 重建 dist
corepack pnpm exec cap sync android       # 2. 拷进 android 工程
cd android; .\gradlew.bat assembleDebug   # 3. 重新打包
# 4. 确认 APK 时间戳是新的
```

**还有一次差点误判**：用 `Select-String -Pattern 'translateX'` 查产物没搜到，
就以为"旧代码没进包"，其实是 Rspack 把 `translateX(-16px)` 压缩成了 `translate(-16px)`，
**语义完全一样**。查产物时关键字要松一点。

---

## 另一个已确认的平台限制（不用修）

**视频壁纸的亮度取样在 Android WebView 里必然失败。**
`canvas.drawImage(video) + getImageData()` 会抛 SecurityError（硬件解码画面不进可读 canvas）。

表现：`wallpaperBrightness` 恒为 `null`，于是「按壁纸明暗自动配色」这个能力
在 APK 里实际上不存在。

**目前的兜底**：`computeScrim(null)` 返回 `0.45`，即浅色主题下用 45% 白纱保证文字可读。
代价是深色壁纸会被洗白。

**不用修**，除非你想换方案（比如手动开关）。


---

## 踩过的坑（省得重踩）

### 1. JDK 版本必须 21

| JDK | 结果 |
|---|---|
| Android Studio 自带 JBR 25 | `Unsupported class file major version 69`（Gradle 8.14 只支持到 24） |
| JDK 17 | `invalid source release: 21`（Capacitor 8 的源码按 Java 21 编写） |
| **JDK 21** | ✅ 唯一能用 |

已装在 `F:\jdk21\jdk-21.0.5+11`，并写进 `android/gradle.properties` 的
`org.gradle.java.home`，同时用户环境变量 `JAVA_HOME` 也指向它。

### 2. Gradle Wrapper 下载会超时

`gradlew.bat` 自带的下载器读超时只有 10 秒，VPN 链路上必挂：

```
Downloading ...gradle-8.14.3-all.zip failed: timeout (10000ms)
```

**解决**：手动下载 214MB 的 zip 丢到
`%USERPROFILE%\.gradle\wrapper\dists\gradle-8.14.3-all\10utluxaxniiv4wxiphsi49nj\`。
已下好，不用重下。

### 3. package.json 里的 `&` 被转义成 `\u0026`

用 PowerShell 的 `ConvertTo-Json` 改写 `package.json` 时，`&&` 变成 `\u0026\u0026`，
Capacitor 的解析器读不懂，报 `Invalid package.json`。
**改那个文件用文本编辑，别用 ConvertTo-Json。**

### 4. PowerShell 把 Gradle 的 stderr 当失败

跑 `gradlew.bat ... 2>&1 | Select-Object` 时，即使 `BUILD SUCCESSFUL`，
`$LASTEXITCODE` 也是 1。**以输出里的 `BUILD SUCCESSFUL` 为准，不要看 exit code。**

---

## 验证改了没有的方法

改完重新构建后，用这几条命令确认配置真的进了 APK（别只看构建成功）：

```powershell
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$aapt = "$sdk\build-tools\35.0.0\aapt2.exe"
$apk = 'E:\Agent\project\DSH workplace\ds-chat\android\app\build\outputs\apk\debug\app-debug.apk'

# 1. MainActivity 用的是哪个主题（拿资源 ID）
& $aapt dump xmltree $apk --file AndroidManifest.xml | Select-String 'theme'

# 2. 那个主题里有哪些属性
& $aapt dump resources $apk | Select-String 'NoActionBarLaunch' -Context 0,10

# 3. Java 代码有没有编译进去
#    解压 apk，用文本方式搜 classes.dex 里有没有自己的方法名
```

**判断标准**：`0x01010451=@0x0106000d` 表示 statusBarColor=transparent
（`0x0106000d` 就是 `@android:color/transparent`）。
