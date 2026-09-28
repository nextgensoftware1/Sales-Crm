'use client'

import Link from 'next/link'
import { Fragment, useMemo, useState } from 'react'
import type { WorksheetUpdateRow } from '../worksheet-updates-actions'

export default function WorksheetUpdatesClient({ rows, showCompany, truncated }: {
  rows: WorksheetUpdateRow[]
  showCompany: boolean
  truncated: boolean
}) {
  const [query, setQuery] = useState('')
  const [company, setCompany] = useState('__all__')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const companies = useMemo(() => [...new Set(rows.map(row => row.companyName))].sort(), [rows])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter(row => (company === '__all__' || row.companyName === company) && (!needle || [
      row.practiceName, row.practiceCode, row.companyName, row.editedBy, ...Object.keys(row.changedFields),
    ].some(value => String(value ?? '').toLowerCase().includes(needle))))
  }, [rows, company, query])

  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return <div className="worksheet-updates-card">
    <div className="worksheet-updates-toolbar">
      <div><strong>Saved worksheet changes</strong><span>{visible.length}{truncated ? '+' : ''} updates shown</span></div>
      <div>
        <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search lead, editor, or field…" />
        {showCompany && companies.length > 1 && <select className="input" value={company} onChange={event => setCompany(event.target.value)}>
          <option value="__all__">All companies</option>
          {companies.map(name => <option key={name} value={name}>{name}</option>)}
        </select>}
      </div>
    </div>
    {visible.length === 0 ? <div className="sheet-empty">No worksheet updates match this view.</div> : <div className="tbl-wrap">
      <table className="tbl worksheet-updates-table">
        <thead><tr><th></th><th>Lead</th>{showCompany && <th>Company</th>}<th>Updated By</th><th>Changed Fields</th><th>Saved At</th></tr></thead>
        <tbody>{visible.map(row => {
          const open = expanded.has(row.id)
          const fieldNames = Object.keys(row.changedFields)
          return <Fragment key={row.id}>
            <tr>
              <td><button type="button" className="report-row-toggle" onClick={() => toggle(row.id)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} changed values`}>›</button></td>
              <td>{row.practiceId && row.tenantId
                ? <Link prefetch={false} href={`/worksheet-reports/${row.tenantId}/${row.practiceId}`}><strong>{row.practiceName}</strong><span className="subtle mono">{row.practiceCode ?? '—'}</span></Link>
                : <strong>{row.practiceName}</strong>}</td>
              {showCompany && <td>{row.companyName}</td>}
              <td>{row.editedBy}</td>
              <td><span className="badge badge-blue">{fieldNames.length}</span> {fieldNames.slice(0, 3).join(', ')}{fieldNames.length > 3 ? ` +${fieldNames.length - 3}` : ''}</td>
              <td>{new Date(row.createdAt).toLocaleString()}</td>
            </tr>
            {open && <tr className="worksheet-update-details-row"><td></td><td colSpan={showCompany ? 5 : 4}>
              <div className="worksheet-change-grid">{Object.entries(row.changedFields).map(([field, change]) => <div key={field} className="worksheet-change-item">
                <strong>{field}</strong><div><span>Updated value</span><p>{change.after || '—'}</p></div>
              </div>)}</div>
            </td></tr>}
          </Fragment>
        })}</tbody>
      </table>
    </div>}
  </div>
}
