'use client'

import Link from 'next/link'
import { Fragment, useMemo, useState } from 'react'
import { Eye } from 'lucide-react'
import type { WorksheetReportRow } from '../worksheet-reports-actions'
import WorksheetPreviewModal from '../WorksheetPreviewModal'

const PAGE_SIZES = [8, 15, 20, 100] as const

// Same date-matching approach used elsewhere in this project (see
// PracticesTable.tsx's Credentialing date filters) — a direct string
// comparison on the date portion, not a Date-object parse. These fields
// come back as plain date/timestamp strings, and parsing them through
// `new Date()` then reading local getFullYear/getMonth/getDate back out
// applies the browser's timezone to a value that may have none, which can
// silently shift the matched day by one. Comparing the strings directly
// avoids that entirely.
function sameCalendarDate(value: string | null | undefined, ymd: string): boolean {
  if (!value) return false
  return value.trim().slice(0, 10) === ymd
}

function WorksheetSheet({ rows }: { rows: WorksheetReportRow[] }) {
  const columns = useMemo(() => Array.from(new Set(rows.flatMap(row => Object.keys(row.importData ?? {})))), [rows])
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState<number>(15)
  const [page, setPage] = useState(1)
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(row => [row.companyName, row.filledBy, row.practiceName, row.practiceCode,
      row.state, row.specialty, row.callDetails, row.concernedPerson, row.additionalPhone,
      row.directLine, row.email, row.disposition, ...Object.values(row.importData ?? {})]
      .some(value => String(value ?? '').toLowerCase().includes(needle)))
  }, [rows, query])
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageRows = visible.slice(pageStart, pageStart + pageSize)

  if (!rows.length) return <div className="sheet-empty">No saved worksheet rows are available.</div>
  return <div className="worksheet-sheet">
    <div className="sheet-toolbar">
      <div><strong>Saved worksheet data</strong><span>{visible.length} of {rows.length} rows · {columns.length} imported columns</span></div>
      <div className="sheet-toolbar-controls">
        <label className="sheet-page-size"><span>Rows</span><select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <label className="sheet-search"><span aria-hidden="true">⌕</span><input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="Search saved worksheets…" /></label>
      </div>
    </div>
    <div className="sheet-open-hint">Select a row to open its worksheet. Uploaded rows open the imported worksheet editor.</div>
    <div className="sheet-grid-wrap">
      <table className="sheet-grid">
        <thead><tr>
          <th className="sheet-row-number">#</th><th>Company</th><th>Practice</th><th>State</th><th>Specialty</th>
          <th>Worksheet agent</th><th>Call details</th><th>Contact</th><th>Callback</th><th>Disposition</th><th>Last updated</th>
          {columns.map(column => <th key={column}>{column}</th>)}
        </tr></thead>
        <tbody>{pageRows.map((row, index) => {
          const companyQuery = `company=${encodeURIComponent(row.tenantId)}&view=sheet`
          const href = row.importData
            ? `/worksheet-reports/${row.tenantId}/${row.practiceId}?view=sheet`
            : `/practice/${row.practiceCode}?from=worksheet-reports&${companyQuery}`
          const contact = [row.concernedPerson, row.additionalPhone, row.directLine, row.email].filter(Boolean).join(' · ')
          const cellLink = (content: React.ReactNode) => <Link prefetch={false} className="sheet-cell-link" href={href}>{content}</Link>
          return <tr key={`${row.companyName}:${row.practiceId}`}>
            <th className="sheet-row-number">{pageStart + index + 1}</th>
            <td className="sheet-frozen">{cellLink(<strong>{row.companyName ?? '—'}</strong>)}</td>
            <td>{cellLink(<>{row.providerName ?? row.practiceName}<div className="subtle mono" style={{ fontSize: 10 }}>{row.practiceCode}</div></>)}</td>
            <td>{cellLink(row.state ?? '—')}</td>
            <td>{cellLink(row.specialty ?? '—')}</td>
            <td>{cellLink(row.filledBy ?? '—')}</td>
            <td>{cellLink(row.callDetails || '—')}</td>
            <td>{cellLink(contact || '—')}</td>
            <td>{cellLink(<>{fmtDate(row.callbackAt)}{row.timezone ? ` ${row.timezone}` : ''}</>)}</td>
            <td>{cellLink(row.disposition ?? '—')}</td>
            <td>{cellLink(fmtDate(row.lastUpdatedAt))}</td>
            {columns.map(column => <td key={column}>{cellLink(row.importData?.[column] || '—')}</td>)}
          </tr>
        })}</tbody>
      </table>
    </div>
    <div className="sheet-pagination">
      <span>{visible.length ? `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, visible.length)} of ${visible.length}` : 'No matching rows'}</span>
      <div><button type="button" className="btn" disabled={safePage <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</button><span>Page {safePage} of {totalPages}</span><button type="button" className="btn" disabled={safePage >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>Next</button></div>
    </div>
  </div>
}

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
  rows, showCompanyColumn, expanded, onToggleRow, enableAssignment,
}: {
  rows: WorksheetReportRow[]
  showCompanyColumn: boolean
  expanded: Set<string>
  onToggleRow: (id: string) => void
  enableAssignment: boolean
}) {
  const [previewRow, setPreviewRow] = useState<WorksheetReportRow | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(8)
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageRows = rows.slice(pageStart, pageStart + pageSize)
  const colSpan = showCompanyColumn ? 8 : 7

  return (
    <>
      <div className="report-table-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <label className="report-page-size"><span>Rows per page</span><select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>Practice</th>
              {showCompanyColumn && <th>Company</th>}
              <th>State</th>
              <th>Specialty</th>
              <th>Filled By</th>
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
                      <div className="report-practice-cell">
                        <strong>{r.importData
                          ? <Link prefetch={false} className="report-practice-link" href={`/worksheet-reports/${r.tenantId}/${r.practiceId}`}>{r.providerName ?? r.practiceName}</Link>
                          : r.practiceName}</strong>
                        <button
                          type="button"
                          className="worksheet-preview-trigger"
                          title="View saved worksheet"
                          aria-label={`View saved worksheet for ${r.practiceName}`}
                          onClick={() => setPreviewRow(r)}
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                      <div className="subtle mono" style={{ fontSize: 10.5 }}>{r.importData ? `NPI ${r.practiceCode.replace(/^PR-/, '')}` : r.practiceCode}</div>
                    </td>
                    {showCompanyColumn && <td>{r.companyName ?? '—'}</td>}
                    <td>{r.state ?? '—'}</td>
                    <td>{r.specialty ?? '—'}</td>
                    <td>{r.filledBy ?? '—'}</td>
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
                          {r.importData && (
                            <div style={{ gridColumn: '1 / -1' }}>
                              <div className="subtle" style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Imported CSV fields</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '6px 14px' }}>
                                {Object.entries(r.importData).map(([label, value]) => <div key={label} style={{ fontSize: 12 }}><strong>{label}:</strong> {value || '—'}</div>)}
                              </div>
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

      <div className="report-pagination">
          <span>Showing {rows.length ? pageStart + 1 : 0}-{Math.min(pageStart + pageSize, rows.length)} of {rows.length}</span>
          <div>
            <button className="btn" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span>Page {safePage} of {totalPages}</span>
            <button className="btn" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </div>
      </div>
      {previewRow && (
        <WorksheetPreviewModal
          practiceCode={previewRow.practiceCode}
          practiceName={previewRow.providerName ?? previewRow.practiceName}
          tenantId={previewRow.tenantId}
          practiceId={previewRow.practiceId}
          initialPreview={{
            worksheet: {
              callDetails: previewRow.callDetails,
              additionalPhone: previewRow.additionalPhone,
              email: previewRow.email,
              concernedPerson: previewRow.concernedPerson,
              directLine: previewRow.directLine,
              callbackAt: previewRow.callbackAt,
              timezone: previewRow.timezone,
              disposition: previewRow.disposition,
              updatedAt: previewRow.lastUpdatedAt,
              updatedByName: previewRow.lastUpdatedBy,
              companyName: previewRow.companyName,
            },
            activities: [],
          }}
          enableAssignment={enableAssignment}
          fullLeadHref={previewRow.importData ? `/worksheet-reports/${previewRow.tenantId}/${previewRow.practiceId}?company=${encodeURIComponent(previewRow.tenantId)}&view=reports` : null}
          fullLeadLabel="Open imported worksheet"
          onClose={() => setPreviewRow(null)}
        />
      )}
    </>
  )
}

/** One company's collapsible section in the Super Admin view. */
function CompanySection({
  companyName, rows, expanded, onToggleRow, defaultOpen, enableAssignment,
}: {
  companyName: string
  rows: WorksheetReportRow[]
  expanded: Set<string>
  onToggleRow: (id: string) => void
  defaultOpen: boolean
  enableAssignment: boolean
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
          <ReportTable rows={rows} showCompanyColumn={false} expanded={expanded} onToggleRow={onToggleRow} enableAssignment={enableAssignment} />
        </div>
      )}
    </div>
  )
}

export default function WorksheetReportsClient({
  rows, scope, companyName, truncated, initialView = 'reports',
}: {
  rows: WorksheetReportRow[]
  scope: 'all' | 'company' | 'personal'
  companyName: string | null
  truncated: boolean
  initialView?: 'reports' | 'sheet'
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'reports' | 'sheet'>(initialView)

  // Filled By only makes sense where a report can show more than one
  // person's work (company/platform scope) — for an agent's own personal
  // view every row is already theirs, so the filter is hidden there
  // rather than shown with one meaningless option.
  const showFilledBy = scope !== 'personal'
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [dispositionFilter, setDispositionFilter] = useState('')
  const [filledByFilter, setFilledByFilter] = useState('')
  const [callbackFilter, setCallbackFilter] = useState('') // YYYY-MM-DD
  const [lastUpdateFilter, setLastUpdateFilter] = useState('') // YYYY-MM-DD

  const specialties = useMemo(() => Array.from(new Set(rows.map((r) => r.specialty).filter((v): v is string => !!v))).sort(), [rows])
  const dispositions = useMemo(() => Array.from(new Set(rows.map((r) => r.disposition).filter((v): v is string => !!v))).sort(), [rows])
  const filledByOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.filledBy).filter((v): v is string => !!v))).sort(), [rows])

  const filteredRows = useMemo(() => rows.filter((r) => {
    if (specialtyFilter && r.specialty !== specialtyFilter) return false
    if (dispositionFilter && r.disposition !== dispositionFilter) return false
    if (showFilledBy && filledByFilter && r.filledBy !== filledByFilter) return false
    if (callbackFilter && !sameCalendarDate(r.callbackAt, callbackFilter)) return false
    if (lastUpdateFilter && !sameCalendarDate(r.lastUpdatedAt, lastUpdateFilter)) return false
    return true
  }), [rows, specialtyFilter, dispositionFilter, filledByFilter, showFilledBy, callbackFilter, lastUpdateFilter])

  const resetFilters = () => { setSpecialtyFilter(''); setDispositionFilter(''); setFilledByFilter(''); setCallbackFilter(''); setLastUpdateFilter('') }
  const activeFilterCount = [specialtyFilter, dispositionFilter, showFilledBy ? filledByFilter : '', callbackFilter, lastUpdateFilter].filter(Boolean).length

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
    for (const r of filteredRows) {
      const key = r.companyName ?? 'Unknown company'
      if (!byCompany.has(key)) byCompany.set(key, [])
      byCompany.get(key)!.push(r)
    }
    return Array.from(byCompany.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredRows, scope])

  return (
    <div>
      <div className="report-commandbar">
        <div><h2 className="h-section" style={{ margin: 0 }}>Worksheet Reports</h2><span>{rows.length}{truncated ? '+' : ''} saved worksheets</span></div>
        <div className="view-switch" role="group" aria-label="Worksheet report view">
          <button className={view === 'reports' ? 'active' : ''} onClick={() => setView('reports')}>Report view</button>
          <button className={view === 'sheet' ? 'active' : ''} onClick={() => setView('sheet')}>Spreadsheet view</button>
        </div>
        {scope === 'company' && <span className="subtle" style={{ fontSize: 12 }}>Scoped to {companyName ?? 'your company'}</span>}
        {scope === 'personal' && <span className="subtle" style={{ fontSize: 12 }}>Your saved worksheets</span>}
      </div>
      <p className="subtle" style={{ marginTop: -2, marginBottom: 14 }}>
        The latest saved worksheet per lead — not a log of every edit. Expand a row for call details, or select an imported practice to open and edit its full uploaded worksheet.
        {scope === 'all' && ' Grouped by company — click a company to expand or collapse it.'}
        {scope === 'personal' && ' Only worksheets most recently saved by you are shown.'}
      </p>

      {truncated && (
        <p className="subtle" style={{ fontSize: 11.5, marginTop: -6, marginBottom: 14 }}>
          Showing the {rows.length} most recently updated worksheets. Older ones aren&apos;t shown here.
        </p>
      )}

      {rows.length > 0 && (
        <div className="report-filters" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16, padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <label className="filter-control"><span>Specialty</span>
            <select className="input" value={specialtyFilter} onChange={(e) => setSpecialtyFilter(e.target.value)}>
              <option value="">All Specialties</option>
              {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="filter-control"><span>Call Disposition</span>
            <select className="input" value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)}>
              <option value="">All Call Dispositions</option>
              {dispositions.map((disposition) => <option key={disposition} value={disposition}>{disposition}</option>)}
            </select>
          </label>
          {showFilledBy && (
            <label className="filter-control"><span>Filled By</span>
              <select className="input" value={filledByFilter} onChange={(e) => setFilledByFilter(e.target.value)}>
                <option value="">All Filled By</option>
                {filledByOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          )}
          <label className="filter-control"><span>Callback</span>
            <input type="date" className="input" value={callbackFilter} onChange={(e) => setCallbackFilter(e.target.value)} />
          </label>
          <label className="filter-control"><span>Last Updated</span>
            <input type="date" className="input" value={lastUpdateFilter} onChange={(e) => setLastUpdateFilter(e.target.value)} />
          </label>
          {activeFilterCount > 0 && <button type="button" className="btn" onClick={resetFilters}>Clear filters ({activeFilterCount})</button>}
          <span className="subtle" style={{ fontSize: 12, marginLeft: 'auto' }}>{filteredRows.length} of {rows.length} worksheets match</span>
        </div>
      )}

      {view === 'sheet' ? <WorksheetSheet rows={filteredRows} /> : rows.length === 0 ? (
        <p className="subtle">No worksheet reports yet — leads will show up here once a call worksheet has been saved.</p>
      ) : filteredRows.length === 0 ? (
        <p className="subtle">No worksheets match these filters. <button type="button" className="report-practice-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={resetFilters}>Clear filters</button> to see all {rows.length}.</p>
      ) : scope === 'all' ? (
        groups.map(([company, companyRows], i) => (
          <CompanySection
            key={company}
            companyName={company}
            rows={companyRows}
            expanded={expanded}
            onToggleRow={toggleRow}
            defaultOpen={groups.length === 1 || i === 0}
            enableAssignment
          />
        ))
      ) : (
        <ReportTable rows={filteredRows} showCompanyColumn={false} expanded={expanded} onToggleRow={toggleRow} enableAssignment={scope !== 'personal'} />
      )}
    </div>
  )
}
