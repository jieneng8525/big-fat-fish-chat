# 跟随桌面壁纸：技术说明与可用性声明

## 这个功能做什么

打开「跟随桌面壁纸」后，可以在网页里把**你自己电脑上的壁纸目录**关联进来，
之后网页会从该目录读取壁纸文件（图片或视频）作为聊天背景。

**它不是实时同步 Wallpaper Engine 的动态画面**，只是读取你指定的目录里的文件。

## 为什么不是"实时读取桌面壁纸"

浏览器运行在沙箱里，**没有任何浏览器能读取操作系统注册表或桌面合成层**。
这跟浏览器是否"高级"无关——Chrome、Firefox、Edge、Safari 都一样没有这个权限。

Wallpaper Engine 这类软件把动态壁纸渲染在**桌面合成层**上，不在任何窗口里，
网页无法截取，也无法获取其渲染结果。能拿到的只有**磁盘上的源文件**。

因此本功能的实际语义是：**读取你授权目录中的壁纸源文件**。

## 支持的浏览器（重要）

| 浏览器 | 能力 | 说明 |
| --- | --- | --- |
| **Chrome / Edge** | ✅ **可跨重启保持授权** | 支持 File System Access API，授权目录后可勾选「每次访问都允许」，之后无需重复选择 |
| Firefox | ❌ 不支持 | 没有 File System Access API |
| Safari | ❌ 不支持 | 没有 File System Access API |
| **Android App（Capacitor）** | ❌ 不支持 | `showDirectoryPicker` 这个函数存在，但系统层没有实现，调用必然失败（详见下节） |
| **DSH 侧栏（Electron）** | ⚠️ 每次都要点一次 | Electron 未实现持久权限，「用户手势要求」导致每次启动都需重新点击授权 |

### Android App 为什么不行（这条特别容易误判）

**不能只靠「`showDirectoryPicker` 存不存在」来判断能力。**

安卓 WebView（Capacitor 8 / Android 17 实测）里：

```js
typeof window.showDirectoryPicker === 'function'   // → true
```

函数**存在**，所以只看这一条会把入口渲染出来；但**调用必然失败**，
因为 Android WebView 没有实现底层的目录选择器。用户看到按钮、点了没反应。

正确判断：先排除原生壳。

```ts
// src/services/wallpaperFollow.ts
const capacitor = window.Capacitor
if (capacitor?.isNativePlatform?.() === true) return false
return typeof window.showDirectoryPicker === 'function'
```

**在 App 里选壁纸只能用「手动导入」**：点选择后走 `<input type="file">`，
系统会拉起相册／文件管理器，图片和视频都能选。
代价是没有「下拉快速切换」——想换一张就得重新选一次文件。

### Firefox / Safari 为什么不行

File System Access API（`window.showDirectoryPicker`）目前只有 Chromium 系浏览器实现。
Firefox 明确表示不打算实现（出于安全考虑），Safari 也未提供。

这两个浏览器能做的只有：**每次通过 `<input type="file">` 手动选一个文件**，
无法记住目录，更无法自动跟随壁纸变化。

### 为什么 Electron / DSH 侧栏每次都要授权

Chrome 在文件选择框上提供「Allow on every visit」复选项，勾选后权限可跨会话保留。
Electron **没有实现这套持久权限**，重启后调用 `requestPermission()` 会报：

```
SecurityError: Failed to requestPermission on FileSystemHandle:
User activation is required to request permissions.
```

即必须有用户点击才能重新授权，无法自动完成。

## 已知限制

1. **只能读文件，不能读"当前正在显示的是哪一张"**
   Wallpaper Engine 的播放状态不写在可读的配置里。程序只能按文件修改时间猜测，
   猜错时会显示目录里的另一张。**用户可以在设置里手动指定用哪个文件。**

2. **视频壁纸受文件大小限制**
   创意工坊里的壁纸视频常见 50–400MB。网页背景播放过大的文件会明显卡顿，
   本功能默认只接受 100MB 以内的视频，超出会提示并跳过。

3. **场景类壁纸（Scene）拿不到画面**
   Wallpaper Engine 的部分壁纸是 `.pkg` 场景包，由 WE 用 GPU 实时渲染，
   **磁盘上没有可直接播放的视频/图片文件**。这类壁纸无法被本功能读取。

4. **文件离开该目录后失效**
   如果壁纸文件被移动或删除，网页下次打开时会读不到，自动回落到手动导入的壁纸。

## 隐私

- 本功能**不读取**授权目录之外的任何文件
- 读取到的壁纸**仅在本机浏览器内使用**，不上传、不发送给任何服务
- 授权仅限用户主动选择的那个目录，可随时在设置中断开

## 声明

以上限制源于**浏览器平台的能力边界**，不是本项目的实现缺陷。
在不支持 File System Access API 的浏览器上，本功能的入口会被**自动隐藏**，
不会出现可以点击但无效的按钮。
