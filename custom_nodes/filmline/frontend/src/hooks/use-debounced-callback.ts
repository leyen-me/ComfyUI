import { useCallback, useEffect, useRef } from 'react'

/** 合并短时间内的多次调用，只执行最后一次。 */
export function useDebouncedCallback(callback: () => void, delay = 250): () => void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  return useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      callbackRef.current()
    }, delay)
  }, [delay])
}
