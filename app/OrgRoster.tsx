'use client'

import Link from 'next/link'
import { useState } from 'react'
import { getOrgRoster, type RosterMember } from './roster-actions'

export default function OrgRoster({ npi }: { npi: string }) {
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [members, setMembers] = useState<RosterMember[]>([])
  const [orgName, setOrgName] = useState<string | null>(null)
  const [hasOrg, setHasOrg] = useState(false)
  const [msg, setMsg] = useState('')
  const [showRoster, setShowRoster] = useState(true)

  const load = async () => {
    setLoading(true); setMsg('')
    try {
      const res = await getOrgRoster(npi)
      if (res.ok) {
        setMembers(res.members)
        setOrgName(res.orgName)
        setHasOrg(res.hasOrg)
        setLoaded(true)
        if (!res.hasOrg) setMsg('This clinician is solo — no organization roster.')
      } else {
        setMsg(res.message ?? 'Could not load roster. Please try again.')
      }
    } catch {
      setMsg('Could not load roster. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="org-roster">
      {!loaded ? (
        <div aria-busy={loading}>
        <button onClick={load} disabled={loading}
          className="org-roster-load-btn">
          {loading ? 'Loading roster…' : 'View organization roster'}
        </button>
        {loading && <p className="org-roster-message" role="status">Finding clinicians and their latest worksheet updates…</p>}
        {msg && <p className="org-roster-message" role="alert">{msg}</p>}
        </div>
      ) : (
        <div className="org-roster-panel">
          <div className="org-roster-header">
            <div>
              <h3 className="org-roster-title">
                Organization roster{orgName ? ` — ${orgName}` : ''}
              </h3>
              <div className="org-roster-subtitle">
                {hasOrg ? `${members.length} clinician(s) share this organization` : 'Solo clinician'}
              </div>
            </div>
            <button
              onClick={() => setShowRoster((v) => !v)}
              className="org-roster-toggle">
              {showRoster ? 'Hide roster ▲' : 'Show roster ▼'}
            </button>
          </div>

          {msg && <p className="org-roster-message">{msg}</p>}

          {showRoster && members.length > 0 && (
            <div className="org-roster-table-wrap">
              <table className="org-roster-table">
                <thead>
                  <tr>
                  <th style={th}>NPI</th>
                  <th style={thL}>Name</th>
                  <th style={thL}>Specialty</th>
                  <th style={thL}>City</th>
                  <th style={th}>State</th>
                  <th style={thL}>MIPS</th>
                  <th style={thL}>Worked By</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.npi} className={m.is_clicked ? 'org-roster-selected' : undefined}>
                      <td style={td}>
                        {m.is_clicked && <span title="Selected clinician" className="org-roster-star">★</span>}
                        {m.npi}
                      </td>
                      <td style={tdL}>
                        <Link prefetch={false} href={`/practice/PR-${m.npi}`} className="org-roster-link">{m.name}</Link>
                      </td>
                      <td style={tdL}>{m.specialty ?? '—'}</td>
                      <td style={tdL}>{m.city ?? '—'}</td>
                      <td style={td}>{m.state ?? '—'}</td>
                      <td style={tdL}>{m.mips ?? '—'}</td>
                      <td style={tdL} className={m.workedBy ? 'org-roster-worked' : undefined}>{m.workedBy ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'center' }
const thL: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '8px 10px', textAlign: 'center' }
const tdL: React.CSSProperties = { padding: '8px 10px', textAlign: 'left' }
