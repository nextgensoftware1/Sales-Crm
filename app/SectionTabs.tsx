'use client'

import { useId, useState, type ReactNode } from 'react'

/** Presentation-only tabs: panels stay mounted so form state is preserved. */
export default function SectionTabs({ sections, label }: {
  label: string
  sections: { label: string; content: ReactNode; lazy?: boolean }[]
}) {
  const [active, setActive] = useState(0)
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]))
  const activate = (index: number) => {
    setActive(index)
    setVisited(previous => new Set(previous).add(index))
  }
  const id = useId()
  return <div className="section-tabs">
    <div className="section-tab-list" role="tablist" aria-label={label}>
      {sections.map((section, index) => <button key={section.label} type="button" role="tab"
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={active === index}
        tabIndex={active === index ? 0 : -1} onClick={() => activate(index)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % sections.length
            : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null
          if (next !== null) { event.preventDefault(); activate(next); document.getElementById(`${id}-tab-${next}`)?.focus() }
        }}>{section.label}</button>)}
    </div>
    {sections.map((section, index) => <div key={section.label} role="tabpanel"
      id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={active !== index} tabIndex={0}>
      {(!section.lazy || visited.has(index)) && section.content}
    </div>)}
  </div>
}
