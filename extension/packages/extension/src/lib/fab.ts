/**
 * 统一的悬浮同步按钮 (FAB)
 *
 * 书桌语言:墨黑胶囊 + 单 path 描边图标,无装饰动效;文案只有一份,
 * label 与 title 同文,原生 tooltip 即提示。
 */

import { onLanguageChange, t } from './i18n'

export interface FabOptions {
  onClick: () => void
  /** 按钮 bottom 偏移，默认 88px */
  bottom?: string
}

/** 单 path 同步图标:两端弧+箭头,1.6 描边,跟随 currentColor。 */
const SYNC_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/>
  </svg>
`

export function createSyncFab(options: FabOptions): HTMLElement {
  const { onClick, bottom = '88px' } = options

  const btn = document.createElement('div')
  btn.id = 'wechatsync-fab'
  btn.setAttribute('role', 'button')
  btn.style.cssText = `
    position: fixed !important;
    right: 24px !important;
    bottom: ${bottom} !important;
    height: 40px !important;
    padding: 0 16px !important;
    border-radius: 20px !important;
    background: #17181c !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18) !important;
    cursor: pointer !important;
    z-index: 2147483646 !important;
    display: flex !important;
    align-items: center !important;
    gap: 7px !important;
    transition: transform 0.15s ease-out, opacity 0.15s ease-out !important;
    user-select: none !important;
    color: #ffffff !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif !important;
    border: none !important;
  `
  btn.innerHTML = `
    ${SYNC_ICON}
    <span data-wcs-fab-label style="color:inherit;font-size:13px;font-weight:500;">${t('同步文章')}</span>
  `
  btn.title = t('同步文章')

  // 内容脚本不重载,语言切换后直接换掉已有 FAB 的文案
  const label = btn.querySelector<HTMLElement>('[data-wcs-fab-label]')
  const applyLanguage = () => {
    const text = t('同步文章')
    btn.title = text
    if (label) label.textContent = text
  }
  const unsubscribe = onLanguageChange(() => {
    if (!btn.isConnected) {
      unsubscribe()
      return
    }
    applyLanguage()
  })

  btn.addEventListener('mouseenter', () => {
    btn.style.opacity = '0.88'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.opacity = '1'
  })
  btn.addEventListener('click', onClick)

  return btn
}
