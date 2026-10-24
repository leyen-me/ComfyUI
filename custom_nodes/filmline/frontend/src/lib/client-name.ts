/** 轻量浏览器昵称：没有登录体系，用 localStorage 让同事大致认出是谁。 */
const KEY = 'filmline-client-name'

function generate(): string {
  return `访客-${Math.random().toString(16).slice(2, 6).toUpperCase()}`
}

export function readClientName(): string {
  try {
    const saved = localStorage.getItem(KEY)?.trim()
    if (saved) return saved
  } catch {
    /* 隐私模式下 localStorage 不可用 */
  }
  const name = generate()
  saveClientName(name)
  return name
}

export function saveClientName(name: string): string {
  const clean = name.trim().slice(0, 40) || generate()
  try {
    localStorage.setItem(KEY, clean)
  } catch {
    /* 忽略写入失败，至少本次会话可用 */
  }
  return clean
}
