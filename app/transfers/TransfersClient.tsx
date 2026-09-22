'use client'

import Link from 'next/link'
import { useEffect, useState, Fragment } from 'react'
import { getTransfers, type Transfer } from '../transfers-actions'

const fmt = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function statusPill(status: string | null) {
  if (!status) return <span className="subtle">—</span>
  const key = status.toLowerCase()
  const cls = key === 'signed' ? 'badge-green' : key === 'sent' ? 'badge-blue' : 'badge-amber'
  return <span className={`badge ${cls}`}>{status}</span>
}

// Source pill — Roster member vs Uploaded (anchor) NPI.
function sourcePill(isRoster: boolean | null | undefined) {
  if (isRoster) return <span className="badge badge-violet">Roster</span>
  return <span className="badge badge-blue">Uploaded</span>
}

const SCOPE_LABEL: Record<string, string> = {
  all: 'across all companies',
  company: 'for your company',
  mine: "you've made or received",
}

function TransfersTable({ rows, expanded, setExpanded }: {
  rows: Transfer[]
  expanded: string | null
  setExpanded: (id: string | null) => void
}) {
  if (rows.length === 0) return <p className="subtle">No transfers here yet.</p>
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ fontSize: 10 }}>Details</th>
            <th>Practice</th>
            <th>Source</th>
            <th>Organization</th>
            <th>State</th>
            <th>Specialty</th>
            <th>From</th>
            <th>To (Closer)</th>
            <th>Handoff Status</th>
            <th>Transferred On</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const isOpen = expanded === t.id
            const hasDetails = !!(t.wsCallDetails || t.wsAdditionalPhone || t.wsEmail || t.wsConcernedPerson || t.wsDirectLine)
            return (
              <Fragment key={t.id}>
                <tr
                  className="leads-row"
                  onClick={() => setExpanded(isOpen ? null : t.id)}
                  style={{ cursor: 'pointer' }}
                  title={isOpen ? 'Click to hide worksheet details' : 'Click to view worksheet details'}
                >
                  <td>
                    <span style={{ display: 'inline-flex', padding: '2px 8px', color: 'var(--muted)' }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                  </td>
                  <td>
                    {t.practiceDeleted ? (
                      <span className="subtle" title="This lead was permanently deleted">{t.practiceName}</span>
                    ) : (
                      <Link prefetch={false} href={`/practice/${t.practiceCode}?from=transfers`} onClick={(e) => e.stopPropagation()}>{t.practiceName}</Link>
                    )}
                  </td>
                  <td>{sourcePill((t as any).isRoster)}</td>
                  <td style={{ fontSize: 12 }}>{(t as any).orgName ?? '—'}</td>
                  <td>{t.state ?? '—'}</td>
                  <td>{t.specialty ?? '—'}</td>
                  <td>{t.fromUserName ?? '—'}</td>
                  <td>{t.toUserName ?? '—'}</td>
                  <td>{statusPill(t.handoffStatus)}</td>
                  <td style={{ fontSize: 12 }}>{fmt(t.createdAt)}</td>
                </tr>
                {isOpen && (
                  <tr key={`${t.id}-details`}>
                    <td></td>
                    <td colSpan={9} style={{ background: 'var(--surface-2)', padding: 16 }}>
                      {t.practiceDeleted ? (
                        <p className="subtle" style={{ margin: 0 }}>This lead was permanently deleted — no worksheet is available.</p>
                      ) : !hasDetails ? (
                        <p className="subtle" style={{ margin: 0 }}>No worksheet has been filled in for this lead yet.</p>
                      ) : (
                        <div className="grid-fields-2" style={{ maxWidth: 900 }}>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <label className="lead-field-label">Call Details</label>
                            <div className="lead-field-value" style={{ whiteSpace: 'pre-wrap', height: 'auto', minHeight: 28 }}>
                              {t.wsCallDetails || '—'}
                            </div>
                          </div>
                          <div>
                            <label className="lead-field-label">Additional Phone</label>
                            <div className="lead-field-value">{t.wsAdditionalPhone || '—'}</div>
                          </div>
                          <div>
                            <label className="lead-field-label">Email</label>
                            <div className="lead-field-value">{t.wsEmail || '—'}</div>
                          </div>
                          <div>
                            <label className="lead-field-label">Concerned Person</label>
                            <div className="lead-field-value">{t.wsConcernedPerson || '—'}</div>
                          </div>
                          <div>
                            <label className="lead-field-label">Direct Line</label>
                            <div className="lead-field-value">{t.wsDirectLine || '—'}</div>
                          </div>
                          <div>
                            <label className="lead-field-label">Timezone</label>
                            <div className="lead-field-value">{t.wsTimezone || '—'}</div>
                          </div>
                          <div>
                            <label className="lead-field-label">Disposition</label>
                            <div className="lead-field-value">{t.wsDisposition || '—'}</div>
                          </div>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span className="subtle" style={{ fontSize: 11 }}>Worksheet last updated {fmt(t.wsUpdatedAt)}</span>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function TransfersClient({ initialData, initialMessage }: {
  initialData?: {
    transfers: Transfer[]
    scope: 'all' | 'company' | 'mine'
    allCompanies: { id: string; name: string }[]
  }
  initialMessage?: string
}) {
  const [transfers, setTransfers] = useState<Transfer[]>(initialData?.transfers ?? [])
  const [scope, setScope] = useState<'all' | 'company' | 'mine'>(initialData?.scope ?? 'company')
  const [allCompanies, setAllCompanies] = useState<{ id: string; name: string }[]>(initialData?.allCompanies ?? [])
  const [loading, setLoading] = useState(!initialData && !initialMessage)
  const [msg, setMsg] = useState(initialMessage ?? '')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<string>(initialData?.allCompanies[0]?.name ?? '')

  useEffect(() => {
    if (initialData || initialMessage) return
    (async () => {
      setLoading(true)
      const res = await getTransfers()
      if (res.ok) {
        const rows = res.transfers ?? []
        setTransfers(rows)
        setScope(res.scope ?? 'company')
        if (res.scope === 'all') {
          const companies = res.allCompanies ?? []
          setAllCompanies(companies)
          if (companies.length > 0) setSelectedCompany(companies[0].name)
        }
      } else {
        setMsg(res.message ?? 'Could not load transfers.')
      }
      setLoading(false)
    })()
  }, [initialData, initialMessage])

  if (loading) return <p className="subtle">Loading…</p>
  if (msg) return <p className="subtle">{msg}</p>

  if (scope === 'all') {
    if (allCompanies.length === 0) {
      return (
        <div className="card">
          <p className="subtle">No companies are registered yet.</p>
        </div>
      )
    }
    const byCompany = new Map<string, Transfer[]>()
    for (const t of transfers) {
      const key = t.companyName ?? 'Unknown Company'
      if (!byCompany.has(key)) byCompany.set(key, [])
      byCompany.get(key)!.push(t)
    }
    const currentRows = byCompany.get(selectedCompany) ?? []

    return (
      <div className="grid-2-sidebar-sm">
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>
            Companies
          </div>
          {allCompanies.map(({ id, name }) => {
            const count = byCompany.get(name)?.length ?? 0
            const isSelected = selectedCompany === name
            return (
              <button
                key={id}
                onClick={() => { setSelectedCompany(name); setExpanded(null) }}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: isSelected ? 'var(--surface-2)' : 'transparent',
                  border: `1px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                  color: 'var(--ink)', borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
                <span className={count > 0 ? 'badge badge-blue' : 'badge badge-grey'}>{count}</span>
              </button>
            )
          })}
        </div>
        <div className="card">
          <div className="subtle" style={{ marginBottom: 10 }}>
            {currentRows.length} transfer{currentRows.length === 1 ? '' : 's'} for {selectedCompany}
          </div>
          <TransfersTable rows={currentRows} expanded={expanded} setExpanded={setExpanded} />
        </div>
      </div>
    )
  }

  if (transfers.length === 0) {
    return (
      <div className="card">
        <p className="subtle">No leads have been transferred yet.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="subtle" style={{ marginBottom: 10 }}>
        {transfers.length} transfer{transfers.length === 1 ? '' : 's'} {SCOPE_LABEL[scope]}
      </div>
      <TransfersTable rows={transfers} expanded={expanded} setExpanded={setExpanded} />
    </div>
  )
}
