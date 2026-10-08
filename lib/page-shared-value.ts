'use client'

// A value shared by two separate parts of a page — e.g. the company list in
// the left panel and the records in the page body. Next.js may load those
// parts as separate bundles, each with its own copy of a module, so the value
// lives on `window` (one per browser tab) and changes are announced with a
// window event. That way every copy sees the same value.
import { useSyncExternalStore } from 'react'

type Store = Record<string, string>
const bag = (): Store => {
  const w = window as unknown as { __hbsSharedValues?: Store }
  return (w.__hbsSharedValues ??= {})
}
const eventName = (key: string) => `hbs-shared-value:${key}`

export function setSharedValue(key: string, next: string) {
  if (typeof window === 'undefined' || bag()[key] === next) return
  bag()[key] = next
  window.dispatchEvent(new Event(eventName(key)))
}

export function useSharedValue(key: string): [string, (next: string) => void] {
  const current = useSyncExternalStore(
    (listener) => {
      window.addEventListener(eventName(key), listener)
      return () => window.removeEventListener(eventName(key), listener)
    },
    () => bag()[key] ?? '',
    () => '',
  )
  return [current, (next: string) => setSharedValue(key, next)]
}
