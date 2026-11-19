// 极小 DOM 助手:扩展页面不引 React——三个静态页加一个注入脚本,原生 DOM 够用,
// 省掉运行时与宿主页面解耦的复杂度。属性以 on 开头即事件监听,children 嵌套数组。
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'class') node.className = value
    else if (key === 'html') node.innerHTML = value
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  append(node, children)
  return node
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
}
