'use client'

import Link from 'next/link'
import { useEffect, useState, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { getTransfers, type Transfer } from '../transfers-actions'
import { verifyTransfer } from '../kpi-actions'
import { BadgeCheck, Eye, X, XCircle } from 'lucide-react'
import { lockPageScroll, unlockPageScroll } from '../../lib/scroll-lock'

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

// Transfer KPI cell: the decision badge (Verified · PKR 500 / Rejected) with
// the reviewer's note, Verify + Reject buttons for whoever may review, or
// "Pending" while waiting for the receiver / a manager.
type KpiDecision = NonNullable<Transfer['kpi']>

/** Provider name if known, else "NPI 1234567890", else the lead's own name. */
const leadTitle = (t: Transfer) => t.providerName ?? (t.npi ? `NPI ${t.npi}` : t.practiceName)

function ReviewDialog({ t, decision, onClose, onDone }: {
  t: Transfer
  decision: 'verified' | 'rejected'
  onClose: () => void
  onDone: (kpi: KpiDecision) => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const verifying = decision === 'verified'
  const valid = note.trim().length >= 3
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      const res = await verifyTransfer(t.id, decision, note)
      if (res.ok && res.kpi) onDone(res.kpi)
      else setError(res.message)
    } catch {
      setError('Could not save your decision. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  // Rendered at the top level of the page so table styles can't clip it.
  return createPortal(
    <div className="wsm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }} onClick={(e) => e.stopPropagation()}>
      <div className="wsm-dialog kpi-review-dialog" role="dialog" aria-modal="true" aria-labelledby="kpi-review-title">
        <header className="wsm-head">
          <div className="wsm-head-text">
            <span className="wsm-kicker">{verifying ? 'Verify transfer' : 'Reject transfer'}</span>
            {/* Provider name when known; otherwise the NPI — never a "Practice (PR-…)" placeholder. */}
            <h2 id="kpi-review-title">{leadTitle(t)}</h2>
            <div className="wsm-chips">
              {t.providerName
                ? (t.npi ? <span className="wsm-chip mono">NPI {t.npi}</span> : t.practiceCode && <span className="wsm-chip mono">{t.practiceCode}</span>)
                : <span className="wsm-chip">Provider name not on file</span>}
              <span className="wsm-chip">From {t.fromUserName ?? '—'}</span>
              <span className="wsm-chip">To {t.toUserName ?? '—'}</span>
            </div>
          </div>
          <button type="button" className="wsm-icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="wsm-body">
          <p className={verifying ? 'kpi-review-effect is-verify' : 'kpi-review-effect is-reject'}>
            {verifying
              ? <><BadgeCheck size={16} aria-hidden="true" /><span>{t.fromUserName ?? 'The agent'} will earn <strong>PKR 500</strong> in their KPI.</span></>
              : <><XCircle size={16} aria-hidden="true" /><span>No KPI will be added for {t.fromUserName ?? 'the agent'}.</span></>}
          </p>
          <label className="wsm-field wsm-wide">
            <span>{verifying ? 'Verification note *' : 'Reason for rejecting *'}</span>
            <textarea className="input" rows={4} autoFocus value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}
              placeholder={verifying ? 'e.g. Spoke with the office manager — interested in RCM, meeting booked for Monday.' : 'e.g. Wrong contact details / practice not interested.'} />
            <small className="subtle">Required — explain what your decision is based on. Saved with the record; it can&apos;t be changed later.</small>
          </label>
          {error && <p role="alert" className="wsm-error-box" style={{ marginTop: 12 }}>{error}</p>}
        </div>
        <footer className="wsm-foot">
          <span className="wsm-foot-meta">One decision per lead.</span>
          <div className="wsm-foot-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={verifying ? 'btn btn-primary' : 'btn kpi-reject-confirm'} disabled={!valid || busy} onClick={submit}>
              {busy ? 'Saving…' : verifying ? 'Verify · PKR 500' : 'Reject'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function KpiCell({ t, onVerified }: { t: Transfer; onVerified: (id: string, kpi: KpiDecision) => void }) {
  const [reviewing, setReviewing] = useState<'verified' | 'rejected' | null>(null)
  if (t.kpi) {
    const tip = `${t.kpi.status === 'rejected' ? 'Rejected' : 'Verified'}${t.kpi.verifiedByName ? ` by ${t.kpi.verifiedByName}` : ''} on ${fmt(t.kpi.verifiedAt)}${t.kpi.note ? `\nNote: ${t.kpi.note}` : ''}`
    return (
      <span className="kpi-decision" title={tip}>
        {t.kpi.status === 'rejected'
          ? <span className="kpi-rejected"><XCircle size={14} aria-hidden="true" /> Rejected</span>
          : <span className="kpi-verified"><BadgeCheck size={14} aria-hidden="true" /> Verified · {t.kpi.currency} {t.kpi.amount.toLocaleString()}</span>}
        {t.kpi.note && <small className="kpi-decision-note">“{t.kpi.note}”</small>}
      </span>
    )
  }
  if (!t.kpiAvailable || t.practiceDeleted) return <span className="subtle">—</span>
  if (!t.canVerify) return <span className="kpi-pending">Pending</span>
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button type="button" className="btn btn-primary kpi-verify-btn" onClick={(e) => { e.stopPropagation(); setReviewing('verified') }}>Verify</button>
      <button type="button" className="btn kpi-verify-btn kpi-reject-btn" onClick={(e) => { e.stopPropagation(); setReviewing('rejected') }}>Reject</button>
      {reviewing && <ReviewDialog t={t} decision={reviewing} onClose={() => setReviewing(null)}
        onDone={(kpi) => { setReviewing(null); onVerified(t.id, kpi) }} />}
    </span>
  )
}

// Eye-button popup: the full transfer record, with Verify / Reject inside it
// (same required-note step as the table buttons).
function TransferDetailModal({ t, onClose, onVerified }: {
  t: Transfer
  onClose: () => void
  onVerified: (id: string, kpi: KpiDecision) => void
}) {
  const [reviewing, setReviewing] = useState<'verified' | 'rejected' | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    lockPageScroll()
    const id = window.setTimeout(() => setMounted(true), 0)
    return () => { window.clearTimeout(id); unlockPageScroll(); opener?.focus?.() }
  }, [])
  useEffect(() => {
    // Escape closes this popup — unless the Verify/Reject step is open on top.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !reviewing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewing, onClose])
  if (!mounted) return null

  const field = (label: string, value: React.ReactNode, wide = false) => (
    <div className={'wsm-field' + (wide ? ' wsm-wide' : '')}><span>{label}</span><div>{value || '—'}</div></div>
  )
  const placeholder = /^Practice\s*\(/i.test(t.practiceName)
  return createPortal(
    <div className="wsm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !reviewing) onClose() }} onClick={(e) => e.stopPropagation()}>
      <div className="wsm-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-detail-title">
        <header className="wsm-head">
          <div className="wsm-head-text">
            <span className="wsm-kicker">Transfer record</span>
            <h2 id="transfer-detail-title">{leadTitle(t)}</h2>
            <div className="wsm-chips">
              {t.providerName && t.npi && <span className="wsm-chip mono">NPI {t.npi}</span>}
              {!t.providerName && <span className="wsm-chip">Provider name not on file</span>}
              {t.companyName && <span className="wsm-chip">{t.companyName}</span>}
              {t.handoffStatus && <span className="badge badge-amber">{t.handoffStatus}</span>}
            </div>
          </div>
          <button type="button" className="wsm-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="wsm-body">
          <section className="wsm-section">
            <h3>Transfer</h3>
            <div className="wsm-grid">
              {field('From (agent)', t.fromUserName)}
              {field('To', t.toUserName)}
              {field('Handoff status', t.handoffStatus)}
              {field('Transferred on', fmt(t.createdAt))}
            </div>
          </section>
          <section className="wsm-section">
            <h3>Lead</h3>
            <div className="wsm-grid">
              {field('Provider', t.providerName)}
              {field('NPI', t.npi ?? t.practiceCode)}
              {field('Practice', placeholder ? null : t.practiceName)}
              {field('Organization', t.orgName)}
              {field('State', t.state)}
              {field('Specialty', t.specialty)}
            </div>
          </section>
          <section className="wsm-section">
            <h3>Worksheet</h3>
            <div className="wsm-grid">
              {field('Disposition', t.wsDisposition ? <span className="badge badge-blue">{t.wsDisposition}</span> : null)}
              {field('Time zone', t.wsTimezone)}
              {field('Concerned person', t.wsConcernedPerson)}
              {field('Direct line', t.wsDirectLine)}
              {field('Additional phone', t.wsAdditionalPhone)}
              {field('Email', t.wsEmail)}
              {field('Last updated', t.wsUpdatedAt ? fmt(t.wsUpdatedAt) : null)}
              {field('Call details', t.wsCallDetails ? <p className="wsm-notes">{t.wsCallDetails}</p> : null, true)}
            </div>
          </section>
          <section className="wsm-section">
            <h3>KPI</h3>
            {t.kpi ? (
              <div className="wsm-grid">
                {field('Decision', t.kpi.status === 'rejected'
                  ? <span className="kpi-rejected"><XCircle size={14} aria-hidden="true" /> Rejected · no KPI</span>
                  : <span className="kpi-verified"><BadgeCheck size={14} aria-hidden="true" /> Verified · {t.kpi.currency} {t.kpi.amount.toLocaleString()}</span>)}
                {field('Reviewed', `${fmt(t.kpi.verifiedAt)}${t.kpi.verifiedByName ? ` · by ${t.kpi.verifiedByName}` : ''}`)}
                {field(t.kpi.status === 'rejected' ? 'Reason' : 'Verification note', t.kpi.note ? <p className="wsm-notes">{t.kpi.note}</p> : null, true)}
              </div>
            ) : (
              <p className="subtle" style={{ margin: 0 }}>
                {!t.kpiAvailable ? 'Transfer KPI is not set up yet.'
                  : t.canVerify ? 'Not reviewed yet — verify it to add PKR 500 to the agent\'s KPI, or reject it.'
                  : 'Pending — waiting for the receiver, a manager or a company admin to review it.'}
              </p>
            )}
          </section>
        </div>
        <footer className="wsm-foot">
          <span className="wsm-foot-meta">Transferred {fmt(t.createdAt)}</span>
          <div className="wsm-foot-actions">
            <button type="button" className="btn" onClick={onClose}>Close</button>
            {!t.kpi && t.canVerify && !t.practiceDeleted && (
              <>
                <button type="button" className="btn kpi-reject-btn" onClick={() => setReviewing('rejected')}>Reject</button>
                <button type="button" className="btn btn-primary" onClick={() => setReviewing('verified')}>
                  <BadgeCheck size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} aria-hidden="true" />Verify
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
      {reviewing && <ReviewDialog t={t} decision={reviewing} onClose={() => setReviewing(null)}
        onDone={(kpi) => { setReviewing(null); onVerified(t.id, kpi) }} />}
    </div>,
    document.body,
  )
}

function TransfersTable({ rows, expanded, setExpanded, onVerified }: {
  rows: Transfer[]
  expanded: string | null
  setExpanded: (id: string | null) => void
  onVerified: (id: string, kpi: NonNullable<Transfer['kpi']>) => void
}) {
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = viewingId ? rows.find((r) => r.id === viewingId) ?? null : null
  if (rows.length === 0) return <p className="subtle">No transfers here yet.</p>
  return (
    <div className="tbl-wrap">
      {viewing && <TransferDetailModal t={viewing} onClose={() => setViewingId(null)} onVerified={onVerified} />}
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
            <th>KPI</th>
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
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', padding: '2px 8px', color: 'var(--muted)' }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <button type="button" className="report-row-view" title="View transfer record"
                      aria-label={`View transfer record for ${leadTitle(t)}`}
                      onClick={(e) => { e.stopPropagation(); setViewingId(t.id) }}>
                      <Eye size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </td>
                  <td>
                    {t.practiceDeleted ? (
                      <span className="subtle" title="This lead was permanently deleted">{t.practiceName}</span>
                    ) : (
                      <>
                        <Link prefetch={false} href={`/practice/${t.practiceCode}?from=transfers`} onClick={(e) => e.stopPropagation()}>{leadTitle(t)}</Link>
                        {t.providerName && t.npi && <div className="subtle mono" style={{ fontSize: 10.5 }}>NPI {t.npi}</div>}
                      </>
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
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap', cursor: 'default' }}><KpiCell t={t} onVerified={onVerified} /></td>
                </tr>
                {isOpen && (
                  <tr key={`${t.id}-details`}>
                    <td></td>
                    <td colSpan={10} style={{ background: 'var(--surface-2)', padding: 16 }}>
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
  // After a successful Verify, show the KPI badge right away.
  const onVerified = (id: string, kpi: NonNullable<Transfer['kpi']>) =>
    setTransfers((rows) => rows.map((row) => (row.id === id ? { ...row, kpi, canVerify: false } : row)))

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
          <TransfersTable rows={currentRows} expanded={expanded} setExpanded={setExpanded} onVerified={onVerified} />
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
      <TransfersTable rows={transfers} expanded={expanded} setExpanded={setExpanded} onVerified={onVerified} />
    </div>
  )
}
