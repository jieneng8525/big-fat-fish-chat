import { zipSync, strToU8 } from 'fflate'

/**
 * docx / xlsx / pptx 都是 OOXML 包：本质是 ZIP 里放一组约定路径的 XML。
 * 不引第三方库，直接用项目已有的 fflate 拼出最小合法包。
 *
 * 取舍：只生成「基础结构」——标题、段落、列表、表格、代码块按纯文本段落。
 * 复杂排版（嵌套列表、合并单元格、主题色）不做，那需要完整 OOXML 实现。
 */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/**
 * XML 文本转义；控制字符会让 Office 拒绝打开，一并清掉。
 * 用字符码判断而不是正则里的控制字符段，避免把不可见字符写进源码。
 */
const esc = (value: string): string => {
  let cleaned = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    // XML 1.0 允许：9(制表) 10(换行) 13(回车) 及 0x20 以上
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue
    }
    cleaned += ch
  }
  return cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把 Markdown 粗略拆成行，保留空行作为段落分隔 */
const lines = (markdown: string): string[] => markdown.replace(/\r\n/g, '\n').split('\n')

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[][] }

/**
 * 极简 Markdown 块解析：标题 / 代码块 / 表格 / 段落。
 * 刻意不处理行内样式（粗体、链接），导出目标是「内容完整」，不是「排版精美」。
 */
const parseBlocks = (markdown: string): Block[] => {
  const src = lines(markdown)
  const blocks: Block[] = []
  let i = 0
  while (i < src.length) {
    const line = src[i]
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      i += 1
      continue
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i += 1
      while (i < src.length && !/^\s*```\s*$/.test(src[i])) {
        body.push(src[i])
        i += 1
      }
      i += 1
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = []
      while (i < src.length && /^\s*\|.*\|\s*$/.test(src[i])) {
        const cells = src[i]
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim())
        // 跳过 |---|---| 这种分隔行
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
          rows.push(cells)
        }
        i += 1
      }
      if (rows.length > 0) {
        blocks.push({ kind: 'table', rows })
      }
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    const para: string[] = []
    while (i < src.length && src[i].trim() !== '' && !/^(#{1,6}\s|\s*```|\s*\|)/.test(src[i])) {
      para.push(src[i])
      i += 1
    }
    blocks.push({ kind: 'paragraph', text: para.join('\n') })
  }
  return blocks
}

// ---------------------------------------------------------------- docx

/**
 * 行内 Markdown 解析：把一段文字切成带格式的片段。
 *
 * 支持 **粗体**、*斜体*、`代码`、[链接](url)。
 * 刻意不做嵌套（粗体里再套斜体），那种情况按最外层处理，宁可少格式也不错乱文字。
 * 代码块内容必须绕过这个函数——那里的 ** 是代码本身，不是粗体。
 */
type InlineRun = { text: string; bold?: boolean; italic?: boolean; code?: boolean; link?: string }

const parseInline = (text: string): InlineRun[] => {
  const runs: InlineRun[] = []
  // 依次匹配：行内代码 > 链接 > 粗体 > 斜体 > 普通文字
  const pattern =
    /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) {
      runs.push({ text: text.slice(last, m.index) })
    }
    if (m[1] !== undefined) {
      runs.push({ text: m[1], code: true })
    } else if (m[2] !== undefined) {
      // 链接只保留文字，地址放进超链接
      runs.push({ text: m[2], link: m[3] })
    } else if (m[4] !== undefined || m[5] !== undefined) {
      runs.push({ text: m[4] ?? m[5], bold: true })
    } else {
      runs.push({ text: m[6] ?? m[7], italic: true })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last) })
  }
  return runs.length > 0 ? runs : [{ text }]
}

/** 单个 run 的 <w:r>；link 由外层包 <w:hyperlink>，这里只管格式 */
const docxRun = (run: InlineRun): string => {
  const props: string[] = []
  if (run.code) {
    props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')
  }
  if (run.bold) {
    props.push('<w:b/>')
  }
  if (run.italic) {
    props.push('<w:i/>')
  }
  const rPr = props.length > 0 ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`
}

/**
 * 一个段落。
 * - plain=true 时不解析行内标记（代码块内容用它），避免把代码里的 ** 当粗体
 * - 段内 \n 用 <w:br/> 保留原始断行
 */
const docxParagraph = (text: string, styleId?: string, plain = false): string => {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : ''
  const pieces = text.split('\n')
  const runs = pieces
    .map((piece, index) => {
      const br = index > 0 ? '<w:r><w:br/></w:r>' : ''
      if (plain) {
        return `${br}<w:r><w:t xml:space="preserve">${esc(piece)}</w:t></w:r>`
      }
      const inner = parseInline(piece)
        .map((run) => {
          const rendered = docxRun(run)
          // 有链接的 run 需要包一层 hyperlink，并在 rels 里登记
          return run.link && nextLinkId
            ? linkWrap(run.link, rendered)
            : rendered
        })
        .join('')
      return br + inner
    })
    .join('')
  return `<w:p>${pPr}${runs}</w:p>`
}

/**
 * 超链接：Word 要求目标写在 document.xml.rels 里，正文只用 r:id 引用。
 * 用模块级收集器而非全局状态：每次 buildDocx 前重置，构建时读取。
 */
let nextLinkId: ((url: string) => string) | null = null

const linkWrap = (url: string, inner: string): string => {
  if (!nextLinkId) {
    // 未初始化说明不在 buildDocx 流程里，退回纯文字，不产生悬空引用
    return inner
  }
  const id = nextLinkId(url)
  return `<w:hyperlink r:id="${id}" w:history="1">${inner}</w:hyperlink>`
}

const docxTable = (rows: string[][]): string => {
  const cols = Math.max(...rows.map((row) => row.length))
  const cell = (text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${docxParagraph(text)}</w:tc>`
  const body = rows
    .map(
      (row) =>
        `<w:tr>${Array.from({ length: cols }, (_, index) => cell(row[index] ?? '')).join('')}</w:tr>`
    )
    .join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="100%" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
    .join('')}</w:tblBorders></w:tblPr>${body}</w:tbl>`
}

export const buildDocx = (markdown: string, title: string): Uint8Array => {
  // 每次构建重置链接收集器：同一文档内相同地址复用同一个 rId
  const links = new Map<string, string>()
  nextLinkId = (url: string) => {
    const existing = links.get(url)
    if (existing) {
      return existing
    }
    const id = `rIdLink${links.size + 1}`
    links.set(url, id)
    return id
  }

  const body = parseBlocks(markdown)
    .map((block) => {
      if (block.kind === 'heading') {
        return docxParagraph(block.text, `Heading${Math.min(block.level, 4)}`)
      }
      if (block.kind === 'table') {
        return docxTable(block.rows) + docxParagraph('')
      }
      if (block.kind === 'code') {
        // 代码块不解析行内标记，** 与 _ 都属于代码本身
        return docxParagraph(block.text, 'Code', true)
      }
      return docxParagraph(block.text)
    })
    .join('')

  // 文档标题作为首段，避免和首个标题重复时显得突兀，这里只在正文没有一级标题时补
  const hasH1 = body.includes('w:val="Heading1"')
  const head = hasH1 ? '' : docxParagraph(title, 'Title')

  // 正文里的 <w:hyperlink r:id> 依赖 xmlns:r 声明，缺了 Word 会拒绝打开
  const document = `${XML_DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${head}${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`

  const styles = `${XML_DECL}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:fill="F2F2F2"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`

  return zipSync({
    '[Content_Types].xml': strToU8(
      `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${[
        ...links.entries(),
      ]
        .map(
          ([url, id]) =>
            `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`
        )
        .join('')}</Relationships>`
    ),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
  })
}

// ---------------------------------------------------------------- xlsx

/** 列号转字母：1 -> A，27 -> AA */
const colName = (index: number): string => {
  let name = ''
  let n = index
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/**
 * 回答转 Excel：
 * - 每个 Markdown 表格各占一个工作表（sheet），表名取该表格前最近的标题
 * - 没有表格时退化成一张「类型 / 层级 / 正文」的表，避免产出空工作簿
 * - 用 inlineStr 写入，避免引入共享字符串表
 */
export const buildXlsx = (markdown: string, title: string): Uint8Array => {
  const blocks = parseBlocks(markdown)

  /** 一张工作表：表名 + 行数据 */
  type SheetData = { name: string; rows: string[][]; headerRow: number }

  const sheets: SheetData[] = []
  {
    // 逐个扫描：记住最近的标题，给紧随其后的表格当表名
    let pendingTitle = ''
    let tableIndex = 0
    for (const block of blocks) {
      if (block.kind === 'heading') {
        pendingTitle = block.text
        continue
      }
      if (block.kind === 'table') {
        tableIndex += 1
        sheets.push({
          name: pendingTitle || `表格${tableIndex}`,
          rows: block.rows,
          // 每个表格的首行都是表头
          headerRow: 0,
        })
        // 一个标题只用于紧随其后的第一个表格
        pendingTitle = ''
      }
    }
  }

  if (sheets.length === 0) {
    // 没有表格：按结构拆成三列，阅读和筛选都比堆成一列有用
    const body: string[][] = [['类型', '层级/语言', '内容']]
    for (const block of blocks) {
      if (block.kind === 'heading') {
        body.push(['标题', `H${block.level}`, block.text])
      } else if (block.kind === 'code') {
        body.push(['代码', '', block.text])
      } else if (block.kind === 'paragraph') {
        body.push(['正文', '', block.text])
      }
      // table 分支不会走到这里：sheets 为空即没有表格
    }
    sheets.push({ name: title.slice(0, 31) || 'Sheet1', rows: body, headerRow: 0 })
  }

  // 工作表名规则：非空、去非法字符、最长 31 字符、不能重名
  const usedNames = new Set<string>()
  const uniqueName = (raw: string, fallback: string): string => {
    // []:*?/\ 在 Excel 里不允许
    let base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || fallback
    let name = base
    let n = 2
    while (usedNames.has(name.toLowerCase())) {
      const suffix = `(${n})`
      name = base.slice(0, 31 - suffix.length) + suffix
      n += 1
    }
    usedNames.add(name.toLowerCase())
    return name
  }

  const files: Record<string, Uint8Array> = {}
  const sheetOverrides: string[] = []
  const sheetRels: string[] = []
  const sheetEntries: string[] = []

  sheets.forEach((sheet, index) => {
    const n = index + 1
    const name = uniqueName(sheet.name, `Sheet${n}`)
    const sheetRows = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, colIndex) => {
            const ref = `${colName(colIndex + 1)}${rowIndex + 1}`
            return cellXml(ref, value, rowIndex === sheet.headerRow)
          })
          .join('')
        return `<row r="${rowIndex + 1}">${cells}</row>`
      })
      .join('')
    files[`xl/worksheets/sheet${n}.xml`] = strToU8(
      `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    )
    sheetOverrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    sheetRels.push(
      `<Relationship Id="rIdS${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`
    )
    sheetEntries.push(`<sheet name="${esc(name)}" sheetId="${n}" r:id="rIdS${n}"/>`)
  })

  // styles 的关系编号避开 sheet 占用的 rIdS 前缀，防止冲突
  sheetRels.push(
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
  )

  // 收拢成 zipSync 需要的「路径 → 字节」映射
  const archive: Record<string, Uint8Array> = { ...files }
  archive['[Content_Types].xml'] = strToU8(
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides.join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  )
  archive['_rels/.rels'] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  )
  archive['xl/_rels/workbook.xml.rels'] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels.join('')}</Relationships>`
  )
  archive['xl/workbook.xml'] = strToU8(
    `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.join('')}</sheets></workbook>`
  )
  archive['xl/styles.xml'] = strToU8(XLSX_STYLES)
  return zipSync(archive)
}

/**
 * xlsx 的样式表。
 *
 * cellXfs 每一项对应一个「单元格样式索引」：
 *   0 = 默认，1 = 粗体，2 = 斜体，3 = 粗体+斜体
 * fonts 的下标与 cellXfs 的 fontId 必须对齐，写错会导致整张表样式错乱。
 */
const XLSX_STYLES = `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><name val="Calibri"/></font><font><b/><i/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

/**
 * 一个单元格。
 *
 * 有行内格式（粗体/斜体）时用 rich text：<is><r><rPr><b/></rPr><t>..</t></r>。
 * 没有格式时退回单个 <t>，更省体积。
 * 表头强制加粗通过 s 属性引用样式索引，与富文本里的 rPr 互不冲突。
 */
const cellXml = (ref: string, value: string, forceBold: boolean): string => {
  const runs = parseInline(value)
  const hasFormat = runs.some((run) => run.bold || run.italic)
  const styleAttr = forceBold ? ' s="1"' : ''
  if (!hasFormat) {
    return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`
  }
  const rich = runs
    .map((run) => {
      const props: string[] = []
      if (run.bold) {
        props.push('<b/>')
      }
      if (run.italic) {
        props.push('<i/>')
      }
      const rPr = props.length > 0 ? `<rPr>${props.join('')}</rPr>` : ''
      return `<r>${rPr}<t xml:space="preserve">${esc(run.text)}</t></r>`
    })
    .join('')
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is>${rich}</is></c>`
}

// ---------------------------------------------------------------- pptx

/** 幻灯片正文的一行：标记它是否来自代码块，决定是否解析行内标记 */
type SlideLine = { text: string; code: boolean }
type Slide = { title: string; body: SlideLine[] }

/**
 * 按一级/二级标题切分成幻灯片，其余内容进入对应页的正文。
 * 没有标题的文档退化成单页，避免产出一个空演示文稿。
 */
const splitSlides = (markdown: string, fallbackTitle: string): Slide[] => {
  const blocks = parseBlocks(markdown)
  const slides: Slide[] = []
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level <= 2) {
      slides.push({ title: block.text, body: [] })
      continue
    }
    if (slides.length === 0) {
      slides.push({ title: fallbackTitle, body: [] })
    }
    const current = slides[slides.length - 1]
    if (block.kind === 'table') {
      // 表格逐行压成文本，避免在幻灯片里再造表格结构
      current.body.push(...block.rows.map((row) => ({ text: row.join(' | '), code: false })))
    } else if (block.kind === 'code') {
      current.body.push({ text: block.text, code: true })
    } else {
      current.body.push({ text: block.text, code: false })
    }
  }
  return slides.length > 0 ? slides : [{ title: fallbackTitle, body: [] }]
}

/**
 * PowerPoint 的一个文本 run。
 *
 * 支持粗体、斜体、行内代码（等宽字体）。
 * 超链接在 PPTX 里需要 <a:hlinkClick> 引用关系文件里的 r:id，
 * 会牵出新的一层 .rels 依赖；为了让「能打开」这条底线更稳，这里把链接退成纯文字
 * （去掉 []() 只留显示文字），不做可点击链接。
 */
const slideRun = (run: InlineRun, sizePt: number, forceBold: boolean): string => {
  const attrs = [
    'lang="zh-CN"',
    `sz="${sizePt * 100}"`,
    run.bold || forceBold ? 'b="1"' : null,
    run.italic ? 'i="1"' : null,
    'dirty="0"',
  ]
    .filter(Boolean)
    .join(' ')
  const font = run.code ? '<a:latin typeface="Consolas"/><a:cs typeface="Consolas"/>' : ''
  const rPr = font ? `<a:rPr ${attrs}>${font}</a:rPr>` : `<a:rPr ${attrs}/>`
  return `<a:r>${rPr}<a:t>${esc(run.text)}</a:t></a:r>`
}

const slideParagraph = (text: string, sizePt = 18, bold = false): string => {
  const runs = parseInline(text).map((run) => slideRun(run, sizePt, bold)).join('')
  return `<a:p>${runs}</a:p>`
}

/** 代码块用：等宽字体，不解析行内标记（`**` 属于代码本身）。
 *  按 \n 拆成多个 run，避免整段塞进一个 <a:t> 时换行丢失 */
const slideCodeParagraph = (text: string, sizePt = 14): string => {
  const runs = text
    .split('\n')
    .map(
      (line, index) =>
        `${index > 0 ? '<a:br/>' : ''}<a:r><a:rPr lang="zh-CN" sz="${sizePt * 100}" dirty="0"><a:latin typeface="Consolas"/><a:cs typeface="Consolas"/></a:rPr><a:t>${esc(line)}</a:t></a:r>`
    )
    .join('')
  return `<a:p>${runs}</a:p>`
}

const buildSlide = (slide: Slide): string => {
  // 正文最多取 12 行，超出截断并注明，避免文字溢出页面
  const limit = 12
  const bodyText = slide.body.slice(0, limit)
  const truncated = slide.body.length > limit
  // 代码行走纯文本 run（不解析 **），正文行走行内解析
  const bodyParas = bodyText
    .map((line) => (line.code ? slideCodeParagraph(line.text, 14) : slideParagraph(line.text, 16)))
    .join('')
  const more = truncated
    ? slideParagraph(`……（还有 ${slide.body.length - limit} 行未显示）`, 14)
    : ''

  return `${XML_DECL}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${''}</p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${slideParagraph(slide.title, 32, true)}</p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>${bodyParas}${more}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

export const buildPptx = (markdown: string, title: string): Uint8Array => {
  const slides = splitSlides(markdown, title)
  const files: Record<string, Uint8Array> = {}
  const overrides: string[] = []

  // 母版必须带 txStyles，否则演示文稿打不开（规范要求，WPS/Office 都严格校验）
  const lvlStyle = (size: number) =>
    `<a:lvl1pPr><a:defRPr sz="${size}" b="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr>`
  const txStyles =
    `<p:txStyles>` +
    `<p:titleStyle>${lvlStyle(3200)}</p:titleStyle>` +
    `<p:bodyStyle>${lvlStyle(1800)}</p:bodyStyle>` +
    `<p:otherStyle>${lvlStyle(1800)}</p:otherStyle>` +
    `</p:txStyles>`

  slides.forEach((slide, index) => {
    const n = index + 1
    files[`ppt/slides/slide${n}.xml`] = strToU8(buildSlide(slide))
    // 每页必须通过自己的 .rels 声明所属版式，否则演示文稿打不开（WPS 报 E_FAIL）
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(
      `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
    )
    overrides.push(
      `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
  })

  files['[Content_Types].xml'] = strToU8(
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${overrides.join('')}</Types>`
  )
  files['_rels/.rels'] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  )
  files['ppt/presentation.xml'] = strToU8(
    `${XML_DECL}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
      .join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  )
  files['ppt/_rels/presentation.xml.rels'] = strToU8(
    // presentation 必须自己声明到 theme 的关系；只写在母版 .rels 里不够，
    // 缺这一条会导致整个包的主题引用断裂，WPS/Office 都打不开。
    // theme 的 Id 用语义化字符串，避开 slide 占用的 rIdN 序号。
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
      )
      .join('')}</Relationships>`
  )
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`
  )
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
  )
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(
    `${XML_DECL}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>${txStyles}</p:sldMaster>`
  )
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(
    `${XML_DECL}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="titleAndBody"><p:cSld name="Title and Body"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
  )
  files['ppt/theme/theme1.xml'] = strToU8(
    `${XML_DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  )
  return zipSync(files)
}
