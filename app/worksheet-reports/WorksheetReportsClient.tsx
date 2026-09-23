'use client'

import { Fragment, useMemo, useState } from 'react'
import type { WorksheetReportRow } from '../worksheet-reports-actions'

const PAGE_SIZE = 10

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** One company's slice of rows — the table itself, with its own pagination
 * and row-expansion, reused for both the single-company view and each
 * group in the Super Admin's company-wise view. */
function ReportTable({
  rows, showCompanyColumn, expanded, onToggleRow,
}: {
  rows: WorksheetReportRow[]
  showCompanyColumn: boolean
  expanded: Set<string>
  onToggleRow: (id: string) => void
}) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE)
  const colSpan = showCompanyColumn ? 8 : 7

  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>Practice</th>
              {showCompanyColumn && <th>Company</th>}
              <th>State</th>
              <th>Specialty</th>
              <th>Agent</th>
              <th>Closer</th>
              <th>Disposition</th>
              <th>Callback</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const isOpen = expanded.has(r.practiceId)
              return (
                <Fragment key={r.practiceId}>
                  <tr>
                    <td style={{ width: 20 }}>
                      <button type="button" className="report-row-toggle" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${r.practiceName}`} onClick={() => onToggleRow(r.practiceId)}>
                        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                          style={{ transition: 'transform .15s ease', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>
                    </td>
                    <td>
                      <strong>{r.practiceName}</strong>
                      <div className="subtle mono" style={{ fontSize: 10.5 }}>{r.practiceCode}{r.orgName ? ` · ${r.orgName}` : ''}</div>
                    </td>
                    {showCompanyColumn && <td>{r.companyName ?? '—'}</td>}
                    <td>{r.state ?? '—'}</td>
                    <td>{r.specialty ?? '—'}</td>
                    <td>{r.assignedAgent ?? '—'}</td>
                    <td>{r.assignedCloser ?? '—'}</td>
                    <td>{r.disposition ? <span className="badge badge-blue">{r.disposition}</span> : '—'}</td>
                    <td>{fmtDate(r.callbackAt)}{r.timezone ? ` ${r.timezone}` : ''}</td>
                    <td>
                      {fmtDate(r.lastUpdatedAt)}
                      {r.lastUpdatedBy && <div className="subtle" style={{ fontSize: 10.5 }}>by {r.lastUpdatedBy}</div>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td></td>
                      <td colSpan={colSpan} style={{ background: 'var(--surface-2)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, padding: '10px 4px' }}>
                          <div>
                            <div className="subtle" style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Call Details</div>
                            <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.callDetails || '—'}</div>
                          </div>
                          <div>
                            <div className="subtle" style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Contact</div>
                            <div style={{ fontSize: 12.5 }}>
                              {r.concernedPerson && <div>{r.concernedPerson}</div>}
                              {r.additionalPhone && <div className="mono">{r.additionalPhone}</div>}
                              {r.directLine && <div className="mono">Direct: {r.directLine}</div>}
                              {r.email && <div className="mono">{r.email}</div>}
                              {!r.concernedPerson && !r.additionalPhone && !r.directLine && !r.email && '—'}
                            </div>
                          </div>
                          {r.handoffStatus && (
                            <div>
                              <div className="subtle" style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Handoff Status</div>
                              <div style={{ fontSize: 12.5 }}>{r.handoffStatus}</div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap', gap: 10 }}>
          <span>Showing {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, rows.length)} of {rows.length}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <button className="btn" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      )}
    </>
  )
}

/** One company's collapsible section in the Super Admin view. */
function CompanySection({
  companyName, rows, expanded, onToggleRow, defaultOpen,
}: {
  companyName: string
  rows: WorksheetReportRow[]
  expanded: Set<string>
  onToggleRow: (id: string) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 14, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', background: 'var(--surface-2)', border: 0, textAlign: 'left', fontSize: 13.5,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform .15s ease', transform: open ? 'rotate(90deg)' : 'none' }}>
            <path d="m9 18 6-6-6-6" />
          </svg>
          <strong>{companyName}</strong>
        </span>
        <span className="badge badge-blue">{rows.length} worksheet{rows.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div style={{ padding: 14 }}>
          <ReportTable rows={rows} showCompanyColumn={false} expanded={expanded} onToggleRow={onToggleRow} />
        </div>
      )}
    </div>
  )
}

export default function WorksheetReportsClient({
  rows, scope, companyName, truncated,
}: {
  rows: WorksheetReportRow[]
  scope: 'all' | 'company' | 'personal'
  companyName: string | null
  truncated: boolean
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [companyFilter, setCompanyFilter] = useState<string>('__all__')

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Company-wise grouping — only meaningful for the Super Admin's
  // platform-wide view. Sorted alphabetically by company, with each
  // company's own rows already in latest-updated-first order (inherited
  // from the server's sort).
  const groups = useMemo(() => {
    if (scope !== 'all') return []
    const byCompany = new Map<string, WorksheetReportRow[]>()
    for (const r of rows) {
      const key = r.companyName ?? 'Unknown company'
      if (!byCompany.has(key)) byCompany.set(key, [])
      byCompany.get(key)!.push(r)
    }
    return Array.from(byCompany.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, scope])

  const companyNames = useMemo(() => groups.map(([name]) => name), [groups])
  const visibleGroups = companyFilter === '__all__' ? groups : groups.filter(([name]) => name === companyFilter)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <h2 className="h-section" style={{ margin: 0 }}>Worksheet Reports ({rows.length}{truncated ? '+' : ''})</h2>
        {scope === 'all' && companyNames.length > 1 && (
          <select className="input" style={{ width: 'auto', fontSize: 12 }} value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
            <option value="__all__">All companies ({companyNames.length})</option>
            {companyNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        {scope === 'company' && <span className="subtle" style={{ fontSize: 12 }}>Scoped to {companyName ?? 'your company'}</span>}
        {scope === 'personal' && <span className="subtle" style={{ fontSize: 12 }}>Your saved worksheets</span>}
      </div>
      <p className="subtle" style={{ marginTop: -2, marginBottom: 14 }}>
        The latest saved worksheet per lead — not a log of every edit. Click a row to see the full call details.
        {scope === 'all' && ' Grouped by company — click a company to expand or collapse it.'}
        {scope === 'personal' && ' Only worksheets most recently saved by you are shown.'}
      </p>

      {truncated && (
        <p className="subtle" style={{ fontSize: 11.5, marginTop: -6, marginBottom: 14 }}>
          Showing the {rows.length} most recently updated worksheets. Older ones aren&apos;t shown here.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="subtle">No worksheet reports yet — leads will show up here once a call worksheet has been saved.</p>
      ) : scope === 'all' ? (
        visibleGroups.map(([company, companyRows], i) => (
          <CompanySection
            key={company}
            companyName={company}
            rows={companyRows}
            expanded={expanded}
            onToggleRow={toggleRow}
            defaultOpen={companyFilter !== '__all__' || i === 0}
          />
        ))
      ) : (
        <ReportTable rows={rows} showCompanyColumn={false} expanded={expanded} onToggleRow={toggleRow} />
      )}
    </div>
  )
}
