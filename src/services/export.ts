/**
 * 回答导出：把一条回答转成可下载的文件。
 *
 * 三种纯文本格式的取舍：
 * - txt：纯文本，直接取 Markdown 原文，不做任何渲染，保真但不可读排版
 * - md：原文本身，保留 Markdown 语法，方便二次编辑
 * - html：包一层完整文档，带内联样式，双击即可在浏览器打开；不引外部 CSS/字体，
 *         离线可用。公式与代码高亮不在此处理，保持「所见内容忠实」优先于「排版好看」。
 * 另提供 docx / xlsx / pptx，由 exportOffice.ts 直接用 fflate 拼 OOXML 包。
 */

export type ExportFormat = 'txt' | 'md' | 'html'
export type OfficeFormat = 'docx' | 'xlsx' | 'pptx'
/** 菜单里展示的全部导出格式 */
export type AnyExportFormat = ExportFormat | OfficeFormat

export const EXPORT_FORMATS: ExportFormat[] = ['txt', 'md', 'html']
export const OFFICE_FORMATS: OfficeFormat[] = ['docx', 'xlsx', 'pptx']

const MIME: Record<ExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 文件名里不能出现的字符统一替换掉，保留中文与常见标点 */
const sanitizeFileName = (name: string, fallback: string): string => {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned || fallback
}

/** 用回答首行做文件名，过长截断；没有可用文字时用时间戳 */
export const suggestFileName = (markdown: string, fallback: string): string => {
  const firstLine =
    markdown
      .split('\n')
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find((line) => line.length > 0) ?? ''
  return sanitizeFileName(firstLine, fallback)
}

/** HTML 导出：一个自包含页面，内联最小样式，保证离线可读 */
const toHtml = (markdown: string, title: string): string => {
  // 原样放进 <pre> 而不是解释 Markdown：避免引入解析器，也避免把不可信内容当 HTML 执行
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  /*
   * 跟随系统深浅色。
   * 关键：html 也要给底色。只给 body 的话，浏览器画布（html 之外）在深色模式下
   * 会先刷成白色再被覆盖，打开瞬间会闪一下白。
   * color-scheme 同步声明，让滚动条、表单等原生控件也用对应配色。
   */
  :root { color-scheme: light; --bd: #ffffff; --fg: #1f2328; --muted: #6b7280; }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; --bd: #0d1117; --fg: #e6edf3; --muted: #8b949e; }
  }
  html { background: var(--bd); }
  body {
    max-width: 820px;
    margin: 0 auto;
    padding: 32px 20px 64px;
    font: 16px/1.75 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--fg);
    background: var(--bd);
    word-break: break-word;
  }
  h1 { font-size: 22px; line-height: 1.4; margin: 0 0 8px; }
  .meta { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
    font: inherit;
  }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(new Date().toLocaleString())}</p>
<pre>${escapeHtml(markdown)}</pre>
</body>
</html>
`
}

/** 生成导出的文件内容 */
export const buildExport = (
  format: ExportFormat,
  markdown: string,
  title: string
): { blob: Blob; extension: string } => {
  const body = format === 'html' ? toHtml(markdown, title) : markdown
  return {
    blob: new Blob([body], { type: MIME[format] }),
    extension: format,
  }
}

/** 触发浏览器下载；返回文件全名便于提示 */
export const downloadExport = (
  format: ExportFormat,
  markdown: string,
  title: string
): string => {
  const { blob, extension } = buildExport(format, markdown, title)
  const name = `${suggestFileName(markdown, 'deepseek-reply')}.${extension}`
  triggerDownload(blob, name)
  return name
}

/** 通用下载：创建临时链接点一下就回收 */
const triggerDownload = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const OFFICE_MIME: Record<OfficeFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * 下载 Office 文件。buildDocx 等在 exportOffice.ts，动态引入避免把三个构建器打进主包。
 * 返回文件名，便于提示。
 */
export const downloadOffice = async (
  format: OfficeFormat,
  markdown: string,
  title: string
): Promise<string> => {
  const { buildDocx, buildXlsx, buildPptx } = await import('./exportOffice.js')
  const build =
    format === 'docx' ? buildDocx : format === 'xlsx' ? buildXlsx : buildPptx
  const bytes = build(markdown, title)
  const name = `${suggestFileName(markdown, 'deepseek-reply')}.${format}`
  // 复制到独立的 ArrayBuffer，避免把整个底层 buffer 交给 Blob
  triggerDownload(new Blob([bytes.slice().buffer as ArrayBuffer], { type: OFFICE_MIME[format] }), name)
  return name
}

/**
 * 语言标记 → 扩展名；标记为空时靠内容特征兜底。
 * 供代码块工具栏决定「是否显示下载、下载成什么后缀」使用。
 */
export const extensionOf = (lang: string, content: string): string | null => {
  const byLang: Record<string, string> = {
    markdown: 'md',
    md: 'md',
    text: 'txt',
    txt: 'txt',
    plaintext: 'txt',
    html: 'html',
    htm: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    csv: 'csv',
    sql: 'sql',
    css: 'css',
    python: 'py',
    py: 'py',
    javascript: 'js',
    js: 'js',
    typescript: 'ts',
    ts: 'ts',
    jsx: 'jsx',
    tsx: 'tsx',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    csharp: 'cs',
    go: 'go',
    rust: 'rs',
    shell: 'sh',
    bash: 'sh',
    sh: 'sh',
    powershell: 'ps1',
    ps1: 'ps1',
    ini: 'ini',
    toml: 'toml',
    diff: 'diff',
  }
  if (lang && byLang[lang]) {
    return byLang[lang]
  }
  // 语言标记为空或未知：内容带有明确的文件特征才给扩展名。
  // 先判 HTML，再区分「纯文本版文档」与「Markdown 文档」——两者都用分隔线分节，
  // 关键差别是 Markdown 依赖 # 标题与 | 表格，纯文本版用 ==== 横线和空格对齐。
  if (looksLikeHtml(content)) {
    return 'html'
  }
  const hasHashHeading = content.split('\n').some((line) => /^#{1,6}\s+\S/.test(line))
  const hasPipeTable = content.split('\n').some((line) => /^\s*\|.*\|\s*$/.test(line))
  if (hasHashHeading || hasPipeTable) {
    return 'md'
  }
  return looksLikePlainDoc(content) ? 'txt' : null
}

const looksLikeHtml = (content: string): boolean =>
  /<(!doctype html|html|head|body|div|p|h[1-6]|table)\b/i.test(content)

/**
 * 纯文本版文档特征：没有 Markdown 的 # 标题和 | 表格，但用 ==== / ---- 横线分节，
 * 或带「一、」「1.」这类中文分节标题。
 */
const looksLikePlainDoc = (content: string): boolean => {
  const lines = content.split('\n')
  const hasEqualsRule = lines.some((line) => /^\s*={3,}\s*$/.test(line))
  const hasDashRule = lines.some((line) => /^\s*-{3,}\s*$/.test(line))
  const sectionCount = lines.filter((line) =>
    /^\s*(?:[一二三四五六七八九十]+[、.．]|\d+[、.．]\s*\S)/.test(line)
  ).length
  return (hasEqualsRule || hasDashRule) && sectionCount >= 1
}

const mimeOf = (extension: string): string => {
  if (extension === 'html') {
    return 'text/html;charset=utf-8'
  }
  if (extension === 'md') {
    return 'text/markdown;charset=utf-8'
  }
  if (extension === 'txt') {
    return 'text/plain;charset=utf-8'
  }
  return 'application/octet-stream'
}

/**
 * 下载单个代码块：代码块工具栏上的「下载」用这个。
 * 返回实际文件名；扩展名无法判定时返回 null，调用方据此不显示下载入口。
 */
export const downloadCodeBlock = (
  code: string,
  lang: string,
  baseName: string
): { name: string; extension: string } | null => {
  const extension = extensionOf(lang.toLowerCase(), code)
  if (extension === null) {
    return null
  }
  const name = `${baseName}.${extension}`
  triggerDownload(new Blob([code], { type: mimeOf(extension) }), name)
  return { name, extension }
}

/**
 * 在浏览器新标签页里直接打开代码块的渲染结果，不落盘。
 *
 * 用 Blob URL 而不是 data: URL —— Chrome 已禁止顶层导航到 data:text/html，
 * window.open('data:...') 会被静默拦截。blob: 同源、可直接在新标签页渲染。
 * 内容是模型生成的 HTML，放在新标签页里等同于用户打开任意网页，
 * 它拿不到本应用的 localStorage / IndexedDB（不同源）。
 *
 * 只对 HTML 代码块开放；其他格式没有「浏览器直接打开」的意义。
 */
export const openCodeBlockInBrowser = (code: string, lang: string): boolean => {
  if (extensionOf(lang.toLowerCase(), code) !== 'html') {
    return false
  }
  const url = URL.createObjectURL(new Blob([code], { type: 'text/html;charset=utf-8' }))
  const opened = window.open(url, '_blank', 'noopener')
  // 新标签页若被拦截，及时回收；未拦截时延迟回收给加载留时间
  if (!opened) {
    URL.revokeObjectURL(url)
    return false
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}
