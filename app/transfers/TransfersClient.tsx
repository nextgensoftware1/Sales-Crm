'use client'

import { useEffect, useState, Fragment } from 'react'
import { getTransfers, type Transfer } from '../transfers-actions'

const fmt = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Handoff status pill — reuses the same three values the Worksheet's
// "Handoff status" dropdown writes (Pending / Sent / Signed).
function statusPill(status: string | null) {
  if (!status) return <span className="subtle">—</span>
  const key = status.toLowerCase()
  const cls = key === 'signed' ? 'badge-green' : key === 'sent' ? 'badge-blue' : 'badge-amber'
  return <span className={`badge ${cls}`}>{status}</span>
}

const SCOPE_LABEL: Record<string, string> = {
  all: 'across all companies',
  company: 'for your company',
  mine: "you've made or received",
}

export default function TransfersClient() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [scope, setScope] = useState<'all' | 'company' | 'mine'>('company')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const res = await getTransfers()
      if (res.ok) {
        setTransfers(res.transfers ?? [])
        setScope(res.scope ?? 'company')
      } else {
        setMsg(res.message ?? 'Could not load transfers.')
      }
      setLoading(false)
    })()
  }, [])

  if (loading) return <p className="subtle">Loading…</p>
  if (msg) return <p className="subtle">{msg}</p>
  if (transfers.length === 0) {
    return (
      <div className="card">
        <p className="subtle">No leads have been transferred yet.</p>
      </div>
    )
  }

  const showCompanyCol = scope !== 'company'

  return (
    <div className="card">
      <div className="subtle" style={{ marginBottom: 10 }}>
        {transfers.length} transfer{transfers.length === 1 ? '' : 's'} {SCOPE_LABEL[scope]}
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>Practice</th>
              <th>State</th>
              <th>Specialty</th>
              {showCompanyCol && <th>Company</th>}
              <th>From</th>
              <th>To (Closer)</th>
              <th>Handoff Status</th>
              <th>Transferred On</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => {
              const isOpen = expanded === t.id
              const hasDetails = !!(t.wsCallDetails || t.wsAdditionalPhone || t.wsEmail || t.wsConcernedPerson || t.wsDirectLine)
              return (
                <Fragment key={t.id}>
                  <tr>
                    <td>
                      <button
                        onClick={() => setExpanded(isOpen ? null : t.id)}
                        className="lead-quickbtn"
                        title={isOpen ? 'Hide worksheet details' : 'View worksheet details'}
                        style={{ padding: '2px 8px' }}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                    </td>
                    <td>
                      {t.practiceDeleted ? (
                        <span className="subtle" title="This lead was permanently deleted">{t.practiceName}</span>
                      ) : (
                        <a href={`/practice/${t.practiceCode}`}>{t.practiceName}</a>
                      )}
                    </td>
                    <td>{t.state ?? '—'}</td>
                    <td>{t.specialty ?? '—'}</td>
                    {showCompanyCol && <td>{t.companyName ?? '—'}</td>}
                    <td>{t.fromUserName ?? '—'}</td>
                    <td>{t.toUserName ?? '—'}</td>
                    <td>{statusPill(t.handoffStatus)}</td>
                    <td style={{ fontSize: 12 }}>{fmt(t.createdAt)}</td>
                  </tr>
                  {isOpen && (
                    <tr key={`${t.id}-details`}>
                      <td></td>
                      <td colSpan={showCompanyCol ? 8 : 7} style={{ background: 'var(--surface-2)', padding: 16 }}>
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
    </div>
  )
}
