'use client'

// Shared Worksheet Reports search text. The search box lives in the left
// Worksheets panel while the report table lives in the page body — two
// separate parts of the page — so both read and write this one value.
import { useSyncExternalStore } from 'react'

let value = ''
const listeners = new Set<() => void>()

export function setWorksheetSearch(next: string) {
  if (next === value) return
  value = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** [current search text, setter] — shared by the panel box and the report. */
export function useWorksheetSearch(): [string, (next: string) => void] {
  const current = useSyncExternalStore(subscribe, () => value, () => '')
  return [current, setWorksheetSearch]
}
