'use client'

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'

export type PageChromeValue = {
  title: string
  subtitle?: string
  active: string
  headerRight?: ReactNode
}

const DEFAULT_CHROME: PageChromeValue = { title: '', active: '' }

type ChromeContextValue = {
  chrome: PageChromeValue
  setChrome: (c: PageChromeValue) => void
}

const ChromeContext = createContext<ChromeContextValue | null>(null)

// Wraps the persistent shell. Holds whichever page's chrome (title,
// subtitle, which nav item is active, the header's action button) is
// currently in effect — updated by that page's own <SetPageChrome/>.
export function ChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<PageChromeValue>(DEFAULT_CHROME)
  return <ChromeContext.Provider value={{ chrome, setChrome }}>{children}</ChromeContext.Provider>
}

export function usePageChrome(): PageChromeValue {
  const ctx = useContext(ChromeContext)
  return ctx?.chrome ?? DEFAULT_CHROME
}

// Renders nothing. Each page includes this once, near the top of its JSX,
// in place of what used to be wrapping everything in <AppShell ...>. Runs
// in useLayoutEffect (before the browser paints) rather than useEffect, so
// there's no visible flash of the previous page's title while navigating.
export function SetPageChrome(props: PageChromeValue) {
  const ctx = useContext(ChromeContext)
  useLayoutEffect(() => {
    ctx?.setChrome(props)
    // No cleanup on unmount: the next page's own SetPageChrome will set its
    // values immediately on mount, in the same commit in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })
  return null
}
