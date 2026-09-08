'use client'

import { useState } from 'react'
import { getOrgRoster, type RosterMember } from './roster-actions'

// Drop-in: <OrgRoster npi={provider.npi} /> on the practice detail page.
// Shows a button; on click loads and lists everyone sharing the same Org_PAC_ID.
const C = {
  panel: '#0f1620', panelAlt: '#0b1119', line: '#1c2836',
  text: '#e6edf3', dim: '#8a99a8', faint: '#566472', cyan: '#22d3ee', amber: '#f59e0b',
}

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

  return (
    <div style={{ marginTop: 20 }}>
      {!loaded ? (
        <button onClick={load} disabled={loading}
          style={{
            background: C.cyan, color: '#04121a', border: 'none', borderRadius: 8,
            padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
          }}>
          {loading ? 'Loading roster…' : 'View organization roster'}
        </button>
      ) : (
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
                Organization roster{orgName ? ` — ${orgName}` : ''}
              </h3>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>
                {hasOrg ? `${members.length} clinician(s) share this organization` : 'Solo clinician'}
              </div>
            </div>
          </div>

          {msg && <p style={{ fontSize: 13, color: C.faint }}>{msg}</p>}

          {members.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.line}` }}>
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
                      borderBottom: `1px solid ${C.line}`,
                      background: m.is_clicked ? 'rgba(245,158,11,0.10)' : 'transparent',
                    }}>
                    <td style={td}>
                      {m.is_clicked && <span title="Selected clinician" style={{ color: C.amber, marginRight: 6 }}>★</span>}
                      {m.npi}
                    </td>
                    <td style={tdL}>{m.name}</td>
                    <td style={{ ...tdL, color: C.dim }}>{m.specialty ?? '—'}</td>
                    <td style={{ ...tdL, color: C.dim }}>{m.city ?? '—'}</td>
                    <td style={{ ...td, color: C.dim }}>{m.state ?? '—'}</td>
                    <td style={{ ...tdL, color: C.dim, fontSize: 12 }}>{m.mips ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'center', fontSize: 11, color: '#8a99a8', textTransform: 'uppercase', letterSpacing: 0.4 }
const thL: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '8px 10px', textAlign: 'center' }
const tdL: React.CSSProperties = { padding: '8px 10px', textAlign: 'left' }