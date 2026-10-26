import { cn } from '@/lib/utils'

/*
 * 分段控件的统一样式。外框圆角 8px、内边距 3px，选中块圆角 5px，
 * 保持同心圆角；选中色单独用 --segment，深色下与轨道拉开明度差。
 */
export const segmentGroupClass = 'flex rounded-lg bg-muted p-[3px] ring-1 ring-border ring-inset'

export function segmentItemClass(active: boolean, className?: string): string {
  return cn(
    'flex h-6 cursor-pointer items-center justify-center gap-1 rounded-[5px] px-2.5 text-xs transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
    active
      ? 'bg-segment font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.25),inset_0_1px_0_rgb(255_255_255/0.06)]'
      : 'text-muted-foreground hover:text-foreground',
    className,
  )
}
