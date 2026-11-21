# 会话菜单偶发跳到左上角

## 现象

侧边栏会话条目点「⋯」打开的重命名/删除菜单，**偶尔**会先出现在屏幕左上角，再跳到正确位置。

用户描述：「删除会话的框会鬼跳移位」，截图显示菜单停在侧边栏顶部、覆盖住标题行。
事后**未做任何代码改动就自行恢复**，说明是偶发，不是必现的状态错误。

## 相关代码

- `src/components/base/Menu.tsx`：用 `createPortal` 把菜单挂到 `document.body`
- `src/components/base/Menu.module.css`：`.menu { position: fixed; z-index: 900 }`
- `src/components/base/anchored.ts`：`useAnchoredPosition` 负责算坐标

坐标计算流程：

1. `position` 初始为 `null`，菜单渲染时**不带任何 left/top**
2. `useLayoutEffect` 里调 `update()` 测量并 `setPosition`
3. 同时用 `ResizeObserver` 观察浮层与触发元素，尺寸变化时重算
4. 窗口 resize / 任意滚动容器滚动时也重算

## 最可能的原因（未验证）

**首帧测量拿到的尺寸不是最终尺寸。**

`position === null` 时菜单已经挂在 body 末尾，此时它的坐标是浏览器默认位置
（通常在文档流末尾或视口左上角）。`useLayoutEffect` 会测量并立即修正，
但如果这一刻**字体未加载完、或 CSS 尚未生效**，`getBoundingClientRect()`
返回的宽高偏小，算出来的 `left` 就偏，随后 `ResizeObserver` 观测到真实尺寸再修一次
——表现就是「先跳到一个位置，再跳到正确位置」。

`Menu.module.css` 里 `.menu` 没有设置 `visibility: hidden` 之类的首帧隐藏，
所以错误位置是**可见的**。

## 如果再次出现，按这个顺序查

1. **确认是否首次加载时出现**：硬刷新后第一次点「⋯」是否必现。
   是 → 首帧测量问题，按下面的改法修。
2. **确认是否滚动后出现**：列表滚到底部再点是否必现。
   是 → `scroll` 监听（capture）在滚动中被 `useDismiss` 的逻辑干扰，要单独查。
3. **确认是否只有特定会话出现**（比如标题特别长的）。
   是 → 尺寸计算对特殊内容敏感。

## 若确认是首帧问题，改法

给 `.menu` 加一个「未定位前不可见」的状态：`position` 为 `null` 时不渲染坐标，
同时用 `visibility: hidden`，等 `position` 有值后再显示，避免用户看到中间态。
或在 `position === null` 时先渲染成 `opacity: 0`。

**注意**：这会引入一帧的隐藏，如果测量耗时明显会有闪烁感，
改之前要先确认问题就是首帧，别用一个新问题换旧问题。

## 为什么现在不改

现象已自行消失，无法复现。在没有复现路径的情况下改定位逻辑，
风险是引入新的错位——而这个组件的坐标计算同时服务菜单、提示框等多个浮层，
影响面比看起来大。先记录，等真正能复现再动。
