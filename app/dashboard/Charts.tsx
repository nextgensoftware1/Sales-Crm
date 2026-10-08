'use client'

import { useState } from 'react'

type FunnelRow = { label: string; value: number; pct: number; colorVar: string }

/** Equal-height stages preserve the existing funnel counts and percentage definitions. */
export function SalesFunnel({ rows }: { rows: FunnelRow[] }) {
  // Hovering a stage (or its legend row) highlights that one and softly
  // dims the rest — purely visual, no change to the underlying counts.
  const [hovered, setHovered] = useState<number | null>(null)

  return <div className="chart-layout">
    <svg className="chart-graphic" viewBox="0 0 200 210" role="img" aria-label="Sales funnel; stage counts are listed alongside">
      {rows.map((row, index) => {
        const y = 14 + index * 59
        const inset = 10 + index * 25
        const dimmed = hovered !== null && hovered !== index
        return <path
          key={row.label}
          d={`M${inset} ${y} H${200 - inset} L${175 - inset} ${y + 55} H${inset + 25} Z`}
          fill={row.colorVar}
          opacity={dimmed ? 0.45 : 1}
          style={{ transition: 'opacity .15s ease, filter .15s ease', cursor: 'default', filter: hovered === index ? 'brightness(1.08)' : 'none' }}
          onMouseEnter={() => setHovered(index)}
          onMouseLeave={() => setHovered(null)}
        />
      })}
    </svg>
    <div className="chart-legend">{rows.map((row, index) => {
      const dimmed = hovered !== null && hovered !== index
      return <div
        className="chart-legend-row"
        key={row.label}
        onMouseEnter={() => setHovered(index)}
        onMouseLeave={() => setHovered(null)}
        style={{ opacity: dimmed ? 0.55 : 1, transition: 'opacity .15s ease', cursor: 'default' }}
      >
        <i style={{ background: row.colorVar }} /><span>{row.label}</span><strong>{row.value} ({row.pct}%)</strong>
      </div>
    })}</div>
  </div>
}

const COLORS = ['#00c8a0', '#329cff', '#a651e7', '#ff795f', '#eeb55b', '#5fd5e7', '#6581ba']

export function DispositionDonut({ rows }: { rows: [string, number][] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const total = rows.reduce((sum, [, count]) => sum + count, 0)
  const circumference = 2 * Math.PI * 70
  const segments = rows.map(([label, count], index) => ({
    label, count, color: COLORS[index % COLORS.length],
    offset: rows.slice(0, index).reduce((sum, [, n]) => sum + n, 0),
  }))
  return <div className="chart-layout">
    <svg className="chart-graphic" viewBox="0 0 200 200" role="img" aria-label={`Disposition breakdown: ${total} total outcomes`}>
      <circle cx="100" cy="100" r="70" fill="none" stroke="var(--surface-2)" strokeWidth="26" />
      {total > 0 && segments.map((segment, index) => {
        const dimmed = hovered !== null && hovered !== index
        return <circle key={segment.label} cx="100" cy="100" r="70" fill="none" stroke={segment.color} strokeWidth="26"
          strokeDasharray={`${segment.count / total * circumference} ${circumference}`}
          strokeDashoffset={-segment.offset / total * circumference} transform="rotate(-90 100 100)"
          opacity={dimmed ? 0.45 : 1}
          style={{ transition: 'opacity .15s ease, filter .15s ease', cursor: 'default', filter: hovered === index ? 'brightness(1.1)' : 'none' }}
          onMouseEnter={() => setHovered(index)}
          onMouseLeave={() => setHovered(null)}
        />
      })}
      <text x="100" y="98" textAnchor="middle" fill="var(--ink-strong)" fontSize="28" fontFamily="var(--font-display), Georgia, serif" fontWeight="600">{total}</text>
      <text x="100" y="121" textAnchor="middle" fill="var(--muted)" fontSize="12">Total</text>
    </svg>
    <div className="chart-legend">{segments.length ? segments.map((segment, index) => {
      const dimmed = hovered !== null && hovered !== index
      return <div
        className="chart-legend-row"
        key={segment.label}
        onMouseEnter={() => setHovered(index)}
        onMouseLeave={() => setHovered(null)}
        style={{ opacity: dimmed ? 0.55 : 1, transition: 'opacity .15s ease', cursor: 'default' }}
      >
        <i style={{ background: segment.color }} /><span>{segment.label}</span><strong>{segment.count} · {Math.round(segment.count / total * 100)}%</strong>
      </div>
    }) : <p className="subtle">No activity logged yet.</p>}</div>
  </div>
}
