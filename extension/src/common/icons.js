// 自绘图标(ADR 0009):单 path、24 viewBox、1.6 stroke、round cap/join、currentColor,
// 与 DESIGN.md 的 Icon 规格一致;禁止位图与第三方图标库。
const PATHS = {
  desk: 'M4 8h16M4 8v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8M9 4h6M12 4v4', // 书桌:桌面 + 屏
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  image: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM4 15l4.5-4.5 4 4L16 11l4 4M14.5 8.5a1 1 0 1 0 .001 0',
  pen: 'M4 20l4-1L19.5 7.5a2.1 2.1 0 0 0-3-3L5 16l-1 4zM13.5 6.5l3 3',
  alert: 'M12 5l9 16H3l9-16zM12 11v4M12 18v.01',
  send: 'M4 12l16-8-4 16-4.5-6.5L4 12z',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19 12a7 7 0 0 0-.14-1.4l2.1-1.6-2-3.5-2.5 1a7 7 0 0 0-2.42-1.4L13.6 2h-4l-.44 2.1a7 7 0 0 0-2.42 1.4l-2.5-1-2 3.5 2.1 1.6A7 7 0 0 0 5 12',
}

/** 图标节点;size 是渲染像素(12–22),描边宽度按规格固定 1.6。 */
export function icon(name, size = 16) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', size)
  svg.setAttribute('height', size)
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.6')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', PATHS[name] ?? PATHS.desk)
  svg.append(path)
  return svg
}
