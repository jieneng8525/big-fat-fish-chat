import { useTranslate } from '../../i18n/index.js'
import { IconCheckOutline16, IconDownloadOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { showToast } from '../base/toastState.js'
import {
  downloadExport,
  downloadOffice,
  EXPORT_FORMATS,
  OFFICE_FORMATS,
  type OfficeFormat,
} from '../../services/export.js'
import { useState } from 'react'

/** 导出格式 → 菜单文案 key */
const FORMAT_KEY = {
  txt: 'exportFormatTxt',
  md: 'exportFormatMd',
  html: 'exportFormatHtml',
  docx: 'exportFormatDocx',
  xlsx: 'exportFormatXlsx',
  pptx: 'exportFormatPptx',
} as const

/**
 * 整条回答的导出：纯文本三种（txt / md / html）与 Office 三种（docx / xlsx / pptx）。
 * 回答内单个代码块的下载由代码块工具栏上的按钮负责，不在这里做批量。
 */
export const ExportButton = ({ markdown }: { markdown: string }) => {
  const t = useTranslate()
  const [done, setDone] = useState(false)

  const flash = () => {
    setDone(true)
    setTimeout(() => setDone(false), 1000)
  }

  const run = (format: (typeof EXPORT_FORMATS)[number]) => {
    try {
      downloadExport(format, markdown, t('exportTitle'))
      flash()
      showToast({ key: 'exportDone' })
    } catch {
      showToast({ key: 'exportFailed', type: 'error' })
    }
  }

  const runOffice = async (format: OfficeFormat) => {
    try {
      await downloadOffice(format, markdown, t('exportTitle'))
      flash()
      showToast({ key: 'exportDone' })
    } catch {
      showToast({ key: 'exportFailed', type: 'error' })
    }
  }

  return (
    <Menu
      options={[
        ...EXPORT_FORMATS.map((format) => ({
          key: format,
          label: t(FORMAT_KEY[format]),
          icon: <IconDownloadOutline16 />,
          onSelect: () => run(format),
        })),
        ...OFFICE_FORMATS.map((format) => ({
          key: format,
          label: t(FORMAT_KEY[format]),
          icon: <IconDownloadOutline16 />,
          onSelect: () => void runOffice(format),
        })),
      ]}
    >
      {({ open, toggle }) => (
        <IconButton
          icon={done ? <IconCheckOutline16 /> : <IconDownloadOutline16 />}
          tooltip={t('export')}
          tooltipPlacement="bottom"
          aria-expanded={open}
          onClick={toggle}
        />
      )}
    </Menu>
  )
}
