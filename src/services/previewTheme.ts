/**
 * 给代码块预览的 HTML 补一层「跟随浏览器深浅色」的样式。
 *
 * 背景：预览页在系统浏览器里打开。模型生成的 HTML 大多没有声明配色，
 * 浏览器默认是白底黑字；手机系统处于深色模式时，打开一个纯白页会很刺眼。
 *
 * 做法：不硬改用户内容，只在最外层包一个 <html>/<head> 并插入一段 <style>，
 * 这段样式放在模型自己的样式**之前**（优先度低），只在它没声明的地方生效：
 * - 用 @media (prefers-color-scheme: dark) 让浏览器/系统决定深浅
 * - color-scheme 同步声明，滚动条、表单等原生控件也跟着变
 *
 * 为什么不能简单地在原有 <head> 里插 <style>：
 * 模型的 HTML 可能没有 <head>，可能只有一段 <div>，可能带自己的 <!doctype>。
 * 用 DOMParser 解析再序列化会改动它的结构（自闭合标签、属性顺序等），
 * 所以这里只做最小的字符串处理。
 */

/** 注入的样式。用 !important 只在 :root 上兜底底色，不改具体元素的样式 */
const THEME_STYLE = `<style id="dsh-preview-theme">
  /* 让原生控件（滚动条、输入框）跟随配色 */
  :root { color-scheme: light dark; }
  /* 只兜底画布底色，模型自己声明了就用它的 */
  html { background: #ffffff; }
  body { background: #ffffff; color: #1f2328; }
  @media (prefers-color-scheme: dark) {
    html { background: #0d1117; }
    body { background: #0d1117; color: #e6edf3; }
  }
</style>`

const HAS_HTML_TAG = /<html[\s>]/i
const HAS_HEAD_TAG = /<head[\s>]/i
const HAS_DOCTYPE = /^\s*<!doctype/i

/**
 * 把预览用的 HTML 包成完整文档，并插入跟随深浅色的样式。
 *
 * 三种输入分别处理：
 * 1. 已经是完整文档（有 <html>）：插到 <head> 开头；没有 <head> 就插到 <html> 之后
 * 2. 片段（没有 <html>）：补 <!doctype> + <html><head> 包起来
 */
export const withPreviewTheme = (code: string): string => {
  if (HAS_HTML_TAG.test(code)) {
    if (HAS_HEAD_TAG.test(code)) {
      // 插到 <head> 之后，位于模型自有样式之前 —— 优先度低，不覆盖它的声明
      return code.replace(/(<head[^>]*>)/i, `$1\n${THEME_STYLE}`)
    }
    // 有 <html> 但没有 <head>：补一个
    return code.replace(/(<html[^>]*>)/i, `$1\n<head><meta charset="utf-8">${THEME_STYLE}</head>`)
  }

  // 片段：补成完整文档。保留原 doctype（如果有），避免重复
  const body = HAS_DOCTYPE.test(code) ? code.replace(/^\s*<!doctype[^>]*>/i, '') : code
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${THEME_STYLE}
</head>
${body}
</html>`
}
