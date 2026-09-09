'use client'

import { useState } from 'react'
import { getOrgRoster, type RosterMember } from './roster-actions'

// Drop-in: <OrgRoster npi={provider.npi} /> on the practice detail page.
// Shows a button; on click loads and lists everyone sharing the same Org_PAC_ID.
export default function OrgRoster({ npi }: { npi: string }) {
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [members, setMembers] = useState<RosterMember[]>([])
  const [orgName, setOrgName] = useState<string | null>(null)
  const [hasOrg, setHasOrg] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    setLoading(true); setMsg('')
    const res = await getOrgRoster(npi)
    if (res.ok) {
      setMembers(res.members)
      setOrgName(res.orgName)
      setHasOrg(res.hasOrg)
      setLoaded(true)
      if (!res.hasOrg) setMsg('This clinician is solo — no organization roster.')
    } else {
      setMsg(res.message ?? 'Could not load roster.')
    }
    setLoading(false)
  }

  if (!loaded) {
    return (
      <button onClick={load} disabled={loading} className="lead-quickbtn"
        style={{ background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent)', padding: '9px 16px', fontSize: 13, fontWeight: 700 }}>
        {loading ? 'Loading roster…' : 'View organization roster'}
      </button>
    )
  }

  return (
    <div className="lead-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h4 style={{ margin: 0, border: 'none', padding: 0, textTransform: 'none', letterSpacing: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink-strong)' }}>
            Organization roster{orgName ? ` — ${orgName}` : ''}
          </h4>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            {hasOrg ? `${members.length} clinician(s) share this organization` : 'Solo clinician'}
          </div>
        </div>
      </div>

      {msg && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{msg}</p>}

      {members.length > 0 && (
        <div className="tbl-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={th}>NPI</th>
                <th style={thL}>Name</th>
                <th style={thL}>Specialty</th>
                <th style={thL}>City</th>
                <th style={th}>State</th>
                <th style={thL}>MIPS</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.npi}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: m.is_clicked ? 'rgba(245,158,11,0.08)' : 'transparent',
                  }}>
                  <td style={td}>
                    {m.is_clicked && <span title="Selected clinician" style={{ color: 'var(--warn)', marginRight: 6 }}>★</span>}
                    {m.npi}
                  </td>
                  <td style={tdL}>{m.name}</td>
                  <td style={{ ...tdL, color: 'var(--muted)' }}>{m.specialty ?? '—'}</td>
                  <td style={{ ...tdL, color: 'var(--muted)' }}>{m.city ?? '—'}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{m.state ?? '—'}</td>
                  <td style={{ ...tdL, color: 'var(--muted)', fontSize: 12 }}>{m.mips ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }
const thL: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '8px 10px', textAlign: 'center', color: 'var(--ink-strong)' }
const tdL: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', color: 'var(--ink-strong)' }
