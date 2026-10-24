export type PageItem = number | 'ellipsis'

const MAX_PLAIN_PAGES = 7

/**
 * 计算分页条要显示的页码。
 * 页数不多时全列；过多时收敛为「首页 … 当前 ±1 … 末页」。
 */
export function pageItems(current: number, pageCount: number): PageItem[] {
  if (pageCount <= 0) return []
  if (pageCount <= MAX_PLAIN_PAGES) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }

  const wanted = new Set([1, pageCount, current - 1, current, current + 1])
  const pages = [...wanted].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b)

  const items: PageItem[] = []
  let previous = 0
  for (const page of pages) {
    if (previous && page - previous > 1) items.push('ellipsis')
    items.push(page)
    previous = page
  }
  return items
}
