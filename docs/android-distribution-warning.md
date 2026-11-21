# Android APK 分发安全声明

**这份文档针对的是「把本项目编译成 Android App 分发给别人」这一场景。**

如果你只是自己用，或者只是把网页版挂到自己的域名下，本文大部分内容与你无关。
但只要你打算把 `.apk` 文件交给第二个人，请先读完。

---

## ⚠⚠⚠ 强烈建议：不要直接分发本项目构建出的 APK

**请自己重新编译、自己生成签名密钥、以你自己的名义注册签名，再分发。**

直接转发现成 APK 有真实的安全后果，而且后果由分发者承担——本项目作者不负责。

---

## 为什么

### 1. 当前构建产物使用的是 Android 公用调试证书

本项目的 `android/app/build.gradle` **没有配置 release 签名**，`pnpm cap:apk`
产出的 `app-debug.apk` 用的是 Android SDK 自带的调试证书：

```
Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
```

**这个证书的私钥在所有装了 Android SDK 的机器上都一样**
（`~/.android/debug.keystore`，密码固定为 `android`，别名 `androiddebugkey`）。

也就是说：**任何拿到这个 APK 的人，都能用它身边的同一把私钥重新签名**，
打出一个「和原包签名一致」的替换包。Android 系统无法区分两者。

### 2. 签名一致就意味着「能覆盖安装」

Android 判断两次安装是不是同一个应用，只看**包名 + 签名**。
签名相同 → 系统允许新包直接覆盖旧包，并**保留原有的本地数据**
（对本项目而言就是 `localStorage` 里的 API Key、IndexedDB 里的全部聊天记录）。

所以一旦被人用同一证书重签后覆盖安装，理论上可以在不触发任何提示的情况下
换掉你发的应用代码。这是调试证书分发最实际的危害，不是理论推演。

### 3. 包名冲突会导致装不上或被迫卸载

本项目的包名固定为 `chat.bigfatfish.app`。如果另一个人也按本文档编译了一份，
两份 APK 的包名相同但签名不同，Android 会拒绝安装：

```
INSTALL_FAILED_UPDATE_INCOMPATIBLE
```

用户看到的往往只是「安装失败」，然后可能去卸载原应用再装——
**卸载会连同 IndexedDB 里的全部聊天记录一起删掉**，且不可恢复。

### 4. 系统与安全软件可能不认识这个应用

没有正式签名的应用，在一些手机上会：

- 被厂商管家 / 安全中心标记为「未知来源」「风险应用」
- 被系统强制扫描、限制权限
- 在新版 Android 的「未通过验证的应用」拦截里被直接阻止安装
- 在系统设置里显示为「来自未知开发者」

这些是 Android 平台和手机厂商的策略，**与本项目代码无关，本项目无法干预**。

---

## 正确做法（三步）

### 第一步：自己生成一个签名密钥

```bash
keytool -genkeypair \
  -keystore my-release.keystore \
  -alias my-key \
  -keyalg RSA -keysize 2048 -validity 10000
```

**这个 keystore 文件和你设的密码：**

- **不要提交到任何公开仓库**（本项目的 `.gitignore` 已排除 `*.jks` / `*.keystore`）
- **备份好**。丢了它，你就再也无法给这个包名的应用发布「可覆盖更新」了——
  后续版本只能用新密钥、换包名、或者让用户卸载重装（**会丢数据**）

### 第二步：在 `android/app/build.gradle` 里配置 release 签名

```gradle
android {
    signingConfigs {
        release {
            storeFile file("../my-release.keystore")
            storePassword System.getenv("KS_PASS")
            keyAlias "my-key"
            keyPassword System.getenv("KEY_PASS")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

**密码用环境变量传，不要写死在文件里**，否则一旦仓库泄露，密钥等于公开。

### 第三步：把包名改成你自己的

`android/app/build.gradle` 的 `applicationId`、`AndroidManifest.xml`、
`MainActivity` 所在包路径、`OpenInBrowserPlugin` 的 `getPackageName()` 拼接逻辑，
都依赖 `chat.bigfatfish.app` 这个标识。

**换成你自己拥有的反域名**（例如 `com.yourname.dafatfishchat`），
这样：

- 不会和别人的构建冲突
- 你签名的应用就是你自己的应用，名正言顺

改完执行：

```bash
corepack pnpm cap sync android
cd android && ./gradlew assembleRelease
```

---

## 本项目作者的立场

本项目以 MIT 协议开源，代码可以随意使用、修改、再分发。

**但是：**

1. **不提供、也不推荐分发任何预编译 APK。** 仓库里不放构建产物（`dist/`、
   `app-debug.apk` 均在 `.gitignore` 内）。
2. **任何人分发的 APK 都不是「官方版本」。** 本项目没有官方渠道，
   任何声称官方的包都不具备可信性。
3. **因为使用非正式签名、包名冲突、被安全软件拦截、被系统强制卸载或删除数据
   所产生的任何后果，本项目作者不承担任何责任。**

请自己构建、自己签名、自己负责。

---

## 补充：如果你只是自己用

那完全不需要关心上面这些。直接 `pnpm cap:apk` 装到自己的手机上即可——
调试证书对「自己装自己用」没有任何问题。

唯一要记住的是：**升级时不要卸载旧版**（会丢聊天记录），
直接覆盖安装就行，包名和签名都没变。
