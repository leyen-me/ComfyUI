/**
 * 复制文本。
 *
 * `navigator.clipboard` 只在安全上下文（HTTPS 或 localhost）可用，
 * 通过局域网 IP 访问时会被禁用，因此必须准备 execCommand 兜底。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 权限被拒或 API 不可用，继续走兜底 */
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.left = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)

  const selection = document.getSelection()
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  area.select()
  area.setSelectionRange(0, text.length)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }

  document.body.removeChild(area)
  if (selection && previous) {
    selection.removeAllRanges()
    selection.addRange(previous)
  }
  return copied
}
