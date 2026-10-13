'use client'

import Link from 'next/link'
import { createContext, Fragment, useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react' // ← CHANGED: + useCallback, useSyncExternalStore
import { Eye } from 'lucide-react'
import { useWorksheetSearch } from '../../lib/worksheet-search-store'
import type { WorksheetReportRow } from '../worksheet-reports-actions'
import WorksheetDetailModal from './WorksheetDetailModal'
import { toCsv, toXlsx, downloadFile, type ExportTable } from '../../lib/export-file' // ← ADDED: download selected leads

// Opens the worksheet details popup; provided by WorksheetReportsClient so
// every table (including each company group) can use it.
const ViewWorksheetContext = createContext<((row: WorksheetReportRow) => void) | null>(null)

const PAGE_SIZES = [8, 15, 20, 100] as const

// ← ADDED: row selection for downloads. Shared through context so every
// table (including each company group) uses the same selection.
const rowKey = (r: WorksheetReportRow) => `${r.tenantId}:${r.practiceId}`
type Selection = { selected: Set<string>; toggle: (key: string) => void; setMany: (keys: string[], on: boolean) => void }
const SelectionContext = createContext<Selection | null>(null)

// ← ADDED: the NPI is the practice code without its "PR-" prefix.
const npiOf = (r: WorksheetReportRow) => r.practiceCode.replace(/^PR-/, '')

// ← ADDED: every phone number known for the lead, without repeats
// (practice phone, then the worksheet's direct line and additional phone).
function phonesOf(r: WorksheetReportRow): { label: string; value: string }[] {
  const seen = new Set<string>()
  const out: { label: string; value: string }[] = []
  for (const [label, value] of [['Practice', r.practicePhone], ['Direct', r.directLine], ['Additional', r.additionalPhone]] as const) {
    const v = (value ?? '').trim()
    const digits = v.replace(/\D/g, '')
    if (!v || seen.has(digits || v)) continue
    seen.add(digits || v)
    out.push({ label, value: v })
  }
  return out
}

// ← ADDED: the downloaded file's columns.
function exportTable(rows: WorksheetReportRow[]): ExportTable {
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '')
  return {
    headers: ['NPI', 'Practice', 'Provider / Contact Name', 'Company', 'State', 'Specialty', 'Practice Phone', 'Direct Line',
      'Additional Phone', 'Email', 'Concerned Person', 'Filled By', 'Closer', 'Disposition', 'Callback', 'Callback Timezone',
      'Call Details', 'Handoff Status', 'Last Updated', 'Last Updated By'],
    rows: rows.map((r) => [
      npiOf(r), r.practiceName, r.providerName, r.companyName, r.state, r.specialty, r.practicePhone, r.directLine,
      r.additionalPhone, r.email, r.concernedPerson, r.filledBy, r.assignedCloser, r.disposition, when(r.callbackAt), r.timezone,
      r.callDetails, r.handoffStatus, when(r.lastUpdatedAt), r.lastUpdatedBy,
    ]),
  }
}

// "Last Updated" range filter: From (date + time) → To (date + time).
// The pickers give local date-times ("2026-10-05T20:00"), which the browser
// reads in the viewer's own time zone — the same time the table shows — so a
// range can span days (e.g. Oct 5, 8:00 PM → Oct 6, 2:00 AM).
function localPickerTime(value: string): number | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

function withinRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!value) return false
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return false
  const start = localPickerTime(from)
  const end = localPickerTime(to)
  if (start !== null && at < start) return false
  // "To" includes that whole minute (e.g. 2:00 AM includes 2:00:59 AM).
  if (end !== null && at > end + 59_999) return false
  return true
}

// Search box: matches anything on the worksheet — name, NPI / code, phone
// numbers in any format, email, contact person, call details, state,
// specialty, company, agent, closer, disposition and imported values.
// Runs in the browser on rows already loaded, so it's instant.
function worksheetMatchesSearch(r: WorksheetReportRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  const fields = [
    r.providerName, r.practiceName, r.practiceCode, r.state, r.specialty, r.companyName, r.filledBy,
    r.assignedCloser, r.disposition, r.timezone, r.email, r.concernedPerson, r.callDetails,
    r.additionalPhone, r.directLine, r.lastUpdatedBy, ...Object.values(r.importData ?? {}),
  ]
  if (fields.some((value) => value != null && String(value).toLowerCase().includes(needle))) return true
  // Phone numbers: compare digits only, so "(555) 123-4567", "555.123.4567"
  // and "5551234567" all match each other.
  const digits = needle.replace(/\D/g, '')
  if (digits.length >= 4 && !/[a-z@]/.test(needle)) {
    return fields.some((value) => value != null && String(value).replace(/\D/g, '').includes(digits))
  }
  return false
}

// Spreadsheet view: EVERY worksheet that matches the filters above (the same
// rows the Report view shows). Each row has the standard worksheet columns;
// worksheets that came from an uploaded spreadsheet also show their original
// uploaded columns and open the imported-worksheet editor when clicked.
// (Previously only imported worksheets were listed, so a filter that matched
// only app-saved worksheets made this view look empty.)
function WorksheetSheet({ rows }: { rows: WorksheetReportRow[] }) {
  const importedCount = useMemo(() => rows.filter(row => row.importData).length, [rows])
  const columns = useMemo(() => Array.from(new Set(rows.flatMap(row => Object.keys(row.importData ?? {})))), [rows])
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState<number>(15)
  const [page, setPage] = useState(1)
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(row => [row.companyName, row.filledBy, row.providerName, row.practiceName, row.practiceCode,
      row.state, row.specialty, row.disposition, ...Object.values(row.importData ?? {})]
      .some(value => String(value ?? '').toLowerCase().includes(needle)))
  }, [rows, query])
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageRows = visible.slice(pageStart, pageStart + pageSize)

  if (!rows.length) return <div className="sheet-empty">No worksheets match these filters.</div>
  // Imported rows open their editor; app-saved rows are shown as plain text,
  // exactly as in the Report view.
  const cell = (row: WorksheetReportRow, content: React.ReactNode) => row.importData
    ? <Link prefetch={false} className="sheet-cell-link" href={`/worksheet-reports/${row.tenantId}/${row.practiceId}`}>{content}</Link>
    : <span className="sheet-cell-link">{content}</span>
  return <div className="worksheet-sheet">
    <div className="sheet-toolbar">
      <div><strong>Worksheet data</strong><span>{visible.length} of {rows.length} rows · {importedCount} imported · {columns.length} source columns</span></div>
      <div className="sheet-toolbar-controls">
        <label className="sheet-page-size"><span>Rows</span><select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <label className="sheet-search"><span aria-hidden="true">⌕</span><input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="Search every column…" /></label>
      </div>
    </div>
    {importedCount > 0 && <div className="sheet-open-hint">Select any cell of an imported row to open the complete worksheet and edit its uploaded fields.</div>}
    <div className="sheet-grid-wrap">
      <table className="sheet-grid">
        <thead><tr>
          <th className="sheet-row-number">#</th><th>Company</th><th>Worksheet agent</th>
          <th>Practice</th><th>State</th><th>Specialty</th><th>Disposition</th><th>Callback</th><th>Last Updated</th>
          {columns.map(column => <th key={column}>{column}</th>)}
        </tr></thead>
        <tbody>{pageRows.map((row, index) => <tr key={`${row.companyName}:${row.practiceId}`}>
          <th className="sheet-row-number">{pageStart + index + 1}</th>
          <td className="sheet-frozen">{cell(row, <strong>{row.companyName ?? '—'}</strong>)}</td>
          <td>{cell(row, row.filledBy ?? '—')}</td>
          <td>{cell(row, <>
            {row.importData ? (row.providerName ?? row.practiceName) : row.practiceName}
            {row.importData && <span className="badge badge-blue" style={{ marginLeft: 6, fontSize: 9.5 }}>Imported</span>}
          </>)}</td>
          <td>{cell(row, row.state ?? '—')}</td>
          <td>{cell(row, row.specialty ?? '—')}</td>
          <td>{cell(row, row.disposition ?? '—')}</td>
          <td>{cell(row, row.callbackAt ? <><ClientDate iso={row.callbackAt} />{row.timezone ? ` ${row.timezone}` : ''}</> : '—')}</td>{/* ← CHANGED */}
          <td>{cell(row, <ClientDate iso={row.lastUpdatedAt} />)}</td>{/* ← CHANGED */}
          {columns.map(column => {
            const value = row.importData?.[column]
            return <td key={column}>{cell(row, value || '—')}</td>
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="sheet-pagination">
      <span>{visible.length ? `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, visible.length)} of ${visible.length}` : 'No matching rows'}</span>
      <div><button type="button" className="btn" disabled={safePage <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</button><span>Page {safePage} of {totalPages}</span><button type="button" className="btn" disabled={safePage >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>Next</button></div>
    </div>
  </div>
}

// ← ADDED: dates are written in the viewer's own format and time zone, which
// the server can't know — so they are filled in by the browser only. This
// stops the "Hydration failed … text didn't match" warning
// (server "Oct 13, 2026, 11:10 AM" vs browser "13 Oct 2026, 11:10").
const noopSubscribe = () => () => {}
function ClientDate({ iso }: { iso: string | null }) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false)
  if (!iso) return <>—</>
  return <>{isClient ? fmtDate(iso) : ''}</>
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
  rows, showCompanyColumn, expanded, onToggleRow,
}: {
  rows: WorksheetReportRow[]
  showCompanyColumn: boolean
  expanded: Set<string>
  onToggleRow: (id: string) => void
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(8)
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageRows = rows.slice(pageStart, pageStart + pageSize)
  const colSpan = showCompanyColumn ? 9 : 8 // ← CHANGED: + Phone column
  const viewWorksheet = useContext(ViewWorksheetContext)
  const selection = useContext(SelectionContext) // ← ADDED
  const pageKeys = pageRows.map(rowKey)
  const pageAllSelected = !!selection && pageKeys.length > 0 && pageKeys.every((k) => selection.selected.has(k))

  return (
    <>
      <div className="report-table-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <label className="report-page-size"><span>Rows per page</span><select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {/* ← ADDED: select every lead on this page */}
              <th style={{ width: 28 }}>
                {selection && <input type="checkbox" aria-label="Select all leads on this page" checked={pageAllSelected}
                  onChange={(e) => selection.setMany(pageKeys, e.target.checked)} />}
              </th>
              <th></th>
              <th>Practice</th>
              {showCompanyColumn && <th>Company</th>}
              <th>State</th>
              <th>Specialty</th>
              <th>Phone</th>{/* ← ADDED */}
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
                    {/* ← ADDED */}
                    <td style={{ width: 28 }}>
                      {selection && <input type="checkbox" aria-label={`Select ${r.providerName ?? r.practiceName}`}
                        checked={selection.selected.has(rowKey(r))} onChange={() => selection.toggle(rowKey(r))} />}
                    </td>
                    <td style={{ width: 20, whiteSpace: 'nowrap' }}>
                      <button type="button" className="report-row-toggle" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${r.practiceName}`} onClick={() => onToggleRow(r.practiceId)}>
                        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                          style={{ transition: 'transform .15s ease', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>
                      {viewWorksheet && (
                        <button type="button" className="report-row-view" title="View details" aria-label={`View details for ${r.providerName ?? r.practiceName}`} onClick={() => viewWorksheet(r)}>
                          <Eye size={15} strokeWidth={2} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                    <td>
                      <strong>{r.importData
                        ? <Link prefetch={false} className="report-practice-link" href={`/worksheet-reports/${r.tenantId}/${r.practiceId}`}>{r.providerName ?? r.practiceName}</Link>
                        : r.practiceName}</strong>
                      <div className="subtle mono" style={{ fontSize: 10.5 }}>NPI {npiOf(r)}</div>{/* ← CHANGED: NPI for every role */}
                    </td>
                    {showCompanyColumn && <td>{r.companyName ?? '—'}</td>}
                    <td>{r.state ?? '—'}</td>
                    <td>{r.specialty ?? '—'}</td>
                    {/* ← ADDED: all phone numbers for the lead */}
                    <td className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {phonesOf(r).length === 0 ? '—' : phonesOf(r).map((ph) => (
                        <div key={ph.label} title={`${ph.label} phone`}>{ph.value}</div>
                      ))}
                    </td>
                    <td>{r.filledBy ?? '—'}</td>
                    <td>{r.assignedCloser ?? '—'}</td>
                    <td>{r.disposition ? <span className="badge badge-blue">{r.disposition}</span> : '—'}</td>
                    <td><ClientDate iso={r.callbackAt} />{r.timezone ? ` ${r.timezone}` : ''}</td>{/* ← CHANGED */}
                    <td>
                      <ClientDate iso={r.lastUpdatedAt} />{/* ← CHANGED */}
                      {r.lastUpdatedBy && <div className="subtle" style={{ fontSize: 10.5 }}>by {r.lastUpdatedBy}</div>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={2}></td>{/* ← CHANGED: + checkbox column */}
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
  rows, scope, companyName, truncated, viewerTenantId = null,
}: {
  rows: WorksheetReportRow[]
  scope: 'all' | 'company' | 'personal'
  companyName: string | null
  truncated: boolean
  /** The signed-in user's company: only its worksheets can be edited here. */
  viewerTenantId?: string | null
}) {
  const [viewing, setViewing] = useState<WorksheetReportRow | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'reports' | 'sheet'>('reports')

  // ← ADDED: selected leads (kept across pages and filters) + download.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelect = useCallback((key: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  }), [])
  const setManySelected = useCallback((keys: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const k of keys) { if (on) next.add(k); else next.delete(k) }
    return next
  }), [])
  const selection = useMemo<Selection>(() => ({ selected, toggle: toggleSelect, setMany: setManySelected }), [selected, toggleSelect, setManySelected])
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(rowKey(r))), [rows, selected])
  const download = (format: 'csv' | 'xlsx') => {
    if (!selectedRows.length) return
    const table = exportTable(selectedRows)
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') downloadFile(`active-call-${stamp}.csv`, toCsv(table), 'text/csv;charset=utf-8')
    else downloadFile(`active-call-${stamp}.xlsx`, toXlsx(table, 'Active Call'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }

  // Filled By only makes sense where a report can show more than one
  // person's work (company/platform scope) — for an agent's own personal
  // view every row is already theirs, so the filter is hidden there
  // rather than shown with one meaningless option.
  const showFilledBy = scope !== 'personal'
  // The search box is in the left Worksheets panel (WorksheetSearchBox).
  const [searchText, setSearchText] = useWorksheetSearch()
  const [dispositionFilter, setDispositionFilter] = useState('')
  const [filledByFilter, setFilledByFilter] = useState('')
  const [updatedFrom, setUpdatedFrom] = useState('') // YYYY-MM-DDTHH:MM (local)
  const [updatedTo, setUpdatedTo] = useState('')     // YYYY-MM-DDTHH:MM (local)
  const rangeReversed = !!updatedFrom && !!updatedTo && updatedFrom > updatedTo

  const dispositions = useMemo(() => Array.from(new Set(rows.map((r) => r.disposition).filter((v): v is string => !!v))).sort(), [rows])
  const filledByOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.filledBy).filter((v): v is string => !!v))).sort(), [rows])

  const filteredRows = useMemo(() => rows.filter((r) => {
    if (searchText && !worksheetMatchesSearch(r, searchText)) return false
    if (dispositionFilter && r.disposition !== dispositionFilter) return false
    if (showFilledBy && filledByFilter && r.filledBy !== filledByFilter) return false
    if (!withinRange(r.lastUpdatedAt, updatedFrom, updatedTo)) return false
    return true
  }), [rows, searchText, dispositionFilter, filledByFilter, showFilledBy, updatedFrom, updatedTo])

  const resetFilters = () => { setSearchText(''); setDispositionFilter(''); setFilledByFilter(''); setUpdatedFrom(''); setUpdatedTo('') }
  const activeFilterCount = [searchText.trim(), dispositionFilter, showFilledBy ? filledByFilter : '', updatedFrom || updatedTo].filter(Boolean).length

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
    <ViewWorksheetContext.Provider value={setViewing}>
    <SelectionContext.Provider value={selection}>{/* ← ADDED */}
    <div>
      <div className="report-commandbar">
        <div><h2 className="h-section" style={{ margin: 0 }}>Active Call</h2><span>{rows.length}{truncated ? '+' : ''} saved worksheets</span></div>{/* ← CHANGED: renamed */}
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
          <label className="filter-control"><span>Call Disposition</span>
            <select className="input" value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)}>
              <option value="">All Dispositions</option>
              {dispositions.map((d) => <option key={d} value={d}>{d}</option>)}
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
          <div className="filter-control"><span>Last Updated (from – to)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <input type="datetime-local" className="input" aria-label="Last updated from date and time" value={updatedFrom} max={updatedTo || undefined} onChange={(e) => setUpdatedFrom(e.target.value)} />
              <span className="subtle">to</span>
              <input type="datetime-local" className="input" aria-label="Last updated to date and time" value={updatedTo} min={updatedFrom || undefined} onChange={(e) => setUpdatedTo(e.target.value)} />
            </div>
            {rangeReversed && <small role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>“From” is after “To” — no worksheets can match.</small>}
          </div>
          {activeFilterCount > 0 && <button type="button" className="btn" onClick={resetFilters}>Clear filters ({activeFilterCount})</button>}
          <span className="subtle" style={{ fontSize: 12, marginLeft: 'auto' }}>{filteredRows.length} of {rows.length} worksheets match</span>
        </div>
      )}

      {/* ← ADDED: download bar (Report view) */}
      {view === 'reports' && filteredRows.length > 0 && (
        <div role="region" aria-label="Download selected leads"
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: selected.size ? 'var(--surface-2)' : undefined }}>
          <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
          {selected.size < filteredRows.length && (
            <button type="button" className="btn" onClick={() => setManySelected(filteredRows.map(rowKey), true)}>Select all {filteredRows.length} matching</button>
          )}
          {selected.size > 0 && <button type="button" className="btn" onClick={() => setSelected(new Set())}>Clear selection</button>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" className="btn" disabled={!selected.size} onClick={() => download('csv')}>Download CSV</button>
            <button type="button" className="btn btn-primary" disabled={!selected.size} onClick={() => download('xlsx')}>Download Excel</button>
          </span>
        </div>
      )}

      {view === 'sheet' ? <WorksheetSheet key={`${searchText}|${dispositionFilter}|${filledByFilter}|${updatedFrom}|${updatedTo}`} rows={filteredRows} /> : rows.length === 0 ? (
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
          />
        ))
      ) : (
        <ReportTable rows={filteredRows} showCompanyColumn={false} expanded={expanded} onToggleRow={toggleRow} />
      )}
    </div>
    </SelectionContext.Provider>
      {viewing && (
        <WorksheetDetailModal
          key={viewing.practiceId + viewing.tenantId}
          row={viewing}
          canEdit={!!viewerTenantId && viewing.tenantId === viewerTenantId}
          readOnlyReason={`View only — this worksheet belongs to ${viewing.companyName ?? 'another company'}. Worksheets can only be edited by their own company.`}
          onClose={() => setViewing(null)}
        />
      )}
    </ViewWorksheetContext.Provider>
  )
}