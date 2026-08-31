import WorkPanel from './WorkPanel'
import { supabase } from '../../../lib/supabase'

export default async function PracticeDetail({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  const { data: practice, error } = await supabase
    .from('master_practices')
    .select(`
      id, practice_code, name, state, city, postal, specialty, phone,
      practice_providers (
        providers (
          npi, name, credential, taxonomy_desc, addr1, city, state, postal, phone,
          provider_signals ( ccm, pcm, awv, tcm, bhi, rpm, rcm_fit, cms_category ),
          provider_mips ( reporting_option )
        )
      )
    `)
    .eq('practice_code', code)
    .single()
    // ← CHANGED above: added `id,` at the start of the select (needed to fetch activity)

  if (error || !practice) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
        <a href="/" style={{ color: '#2563eb' }}>← Back to all practices</a>
        <h1 style={{ color: 'red', marginTop: 20 }}>Practice not found</h1>
        <pre>{error?.message}</pre>
      </div>
    )
  }

  // ← ADDED: fetch past activity for this practice (dispositions + notes)
  const { data: activity } = await supabase
    .from('lead_activity')
    .select('disposition, note, created_at, users(full_name)')
    .eq('practice_id', (practice as any).id)
    .order('created_at', { ascending: false })
    .limit(20)

  const provider = practice.practice_providers?.[0]?.providers as any
  const signals = provider?.provider_signals
  const mips = Array.isArray(provider?.provider_mips)
    ? provider.provider_mips[0]
    : provider?.provider_mips

  const box = { border: '1px solid #ddd', borderRadius: 8, padding: 20, marginBottom: 20, maxWidth: 700 }
  const label = { color: '#666', fontSize: 13 }
  const value = { fontSize: 15, marginBottom: 12 }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <a href="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to all practices</a>

      <h1 style={{ fontSize: 28, margin: '16px 0 4px' }}>{practice.name}</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>{practice.practice_code}</p>

      {/* ← ADDED: the "Work this lead" panel (disposition buttons + note box) */}
      <WorkPanel practiceCode={code} />

      {/* ← ADDED: activity history (past dispositions + notes) */}
      <div style={box}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Activity History ({activity?.length ?? 0})</h2>
        {(!activity || activity.length === 0) && <p style={{ color: '#888' }}>No activity yet.</p>}
        {activity?.map((a: any, i) => (
          <div key={i} style={{ borderTop: i ? '1px solid #eee' : 'none', padding: '10px 0' }}>
            <div style={{ fontSize: 13 }}>
              {a.disposition && <strong style={{ color: '#2563eb' }}>{a.disposition}</strong>}
              {a.note && <span> — {a.note}</span>}
            </div>
            <div style={{ fontSize: 12, color: '#888' }}>
              {a.users?.full_name ?? 'Someone'} · {new Date(a.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <div style={box}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Practice</h2>
        <div style={label}>Specialty</div>
        <div style={value}>{practice.specialty || '—'}</div>
        <div style={label}>Location</div>
        <div style={value}>{[practice.city, practice.state, practice.postal].filter(Boolean).join(', ') || '—'}</div>
        <div style={label}>Phone</div>
        <div style={value}>{practice.phone || '—'}</div>
      </div>

      {provider && (
        <div style={box}>
          <h2 style={{ fontSize: 18, marginBottom: 16 }}>Provider</h2>
          <div style={label}>Name</div>
          <div style={value}>{provider.name || '—'} {provider.credential ? `(${provider.credential})` : ''}</div>
          <div style={label}>NPI</div>
          <div style={value}>{provider.npi}</div>
          <div style={label}>Taxonomy</div>
          <div style={value}>{provider.taxonomy_desc || '—'}</div>
          <div style={label}>Address</div>
          <div style={value}>{[provider.addr1, provider.city, provider.state, provider.postal].filter(Boolean).join(', ') || '—'}</div>
        </div>
      )}

      <div style={box}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Intelligence Signals</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            ['CCM', signals?.ccm], ['PCM', signals?.pcm], ['AWV', signals?.awv],
            ['TCM', signals?.tcm], ['BHI', signals?.bhi], ['RPM', signals?.rpm],
            ['RCM Fit', signals?.rcm_fit],
          ].map(([name, on]) => (
            <span key={name as string} style={{
              padding: '6px 12px', borderRadius: 20, fontSize: 13,
              background: on ? '#dcfce7' : '#f2f2f2',
              color: on ? '#166534' : '#999',
              border: `1px solid ${on ? '#86efac' : '#ddd'}`,
            }}>
              {name as string}: {on ? 'Yes' : 'No'}
            </span>
          ))}
        </div>
      </div>

      <div style={box}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>MIPS</h2>
        <div style={label}>MIPS By Year (as reported)</div>
        <div style={value}>{mips?.reporting_option || '—'}</div>
      </div>
    </div>
  )
}