import OrgRoster from '../../OrgRoster'
import Worksheet from '../../Worksheet'
import { createSupabaseServer } from '../../../lib/supabase-server'

export default async function PracticeDetail({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const supabase = await createSupabaseServer()

  // Who is viewing? Needed because the same practice_code can now exist for
  // multiple companies (each has its own copy). We must pick the RIGHT copy.
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = user
    ? await supabase.from('users').select('tenant_id, roles(key)').eq('auth_id', user.id).single()
    : { data: null as any }
  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const myTenantId = (me as any)?.tenant_id

  const SELECT = `
    id, practice_code, name, state, city, postal, specialty, phone, owner_tenant_id,
    ws_call_details, ws_additional_phone, ws_email, ws_concerned_person,
    ws_direct_line, ws_callback_at, ws_timezone, ws_disposition,
    ws_updated_at, ws_updated_by,
    practice_providers (
      providers (
        npi, name, credential, taxonomy_desc, addr1, city, state, postal, phone,
        provider_signals ( ccm, pcm, awv, tcm, bhi, rpm, rcm_fit, cms_category ),
        provider_mips ( reporting_option )
      )
    )
  `

  // Get ALL copies of this practice_code, then choose the one for this viewer.
  const { data: candidates, error } = await supabase
    .from('master_practices')
    .select(SELECT)
    .eq('practice_code', code)

  let practice: any = null
  if (candidates && candidates.length > 0) {
    if (isSuperAdmin) {
      // Prefer a copy allocated to a company; else just the first.
      practice = candidates[0]
    } else {
      // The copy my company OWNS…
      practice = candidates.find((c: any) => c.owner_tenant_id === myTenantId)
      // …or, if none owned, a copy allocated to my company.
      if (!practice && myTenantId) {
        const ids = candidates.map((c: any) => c.id)
        const { data: alloc } = await supabase
          .from('lead_allocations')
          .select('practice_id')
          .eq('tenant_id', myTenantId)
          .eq('status', 'active')
          .in('practice_id', ids)
        const allocatedIds = new Set((alloc ?? []).map((a: any) => a.practice_id))
        practice = candidates.find((c: any) => allocatedIds.has(c.id)) ?? candidates[0]
      }
      if (!practice) practice = candidates[0]
    }
  }

  if (error || !practice) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
        <a href="/" style={{ color: '#2563eb' }}>← Back to all practices</a>
        <h1 style={{ color: 'red', marginTop: 20 }}>Practice not found</h1>
        <pre>{error?.message}</pre>
      </div>
    )
  }

  // Fetch past activity for this practice (dispositions + notes)
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

  // Worksheet: prefill from saved fields; look up who last edited it.
  const pr = practice as any
  let updatedByName: string | null = null
  if (pr.ws_updated_by) {
    const { data: editor } = await supabase
      .from('users').select('full_name').eq('id', pr.ws_updated_by).single()
    updatedByName = (editor as any)?.full_name ?? null
  }
  const toLocalInput = (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const worksheetInitial = {
    callDetails: pr.ws_call_details ?? '',
    additionalPhone: pr.ws_additional_phone ?? '',
    email: pr.ws_email ?? '',
    concernedPerson: pr.ws_concerned_person ?? '',
    directLine: pr.ws_direct_line ?? '',
    callbackAt: toLocalInput(pr.ws_callback_at ?? null),
    timezone: pr.ws_timezone ?? 'Eastern',
    disposition: pr.ws_disposition ?? 'New',
    updatedByName,
    updatedAt: pr.ws_updated_at ?? null,
  }

  const box = { border: '1px solid #ddd', borderRadius: 8, padding: 20, marginBottom: 20, maxWidth: 700 }
  const label = { color: '#666', fontSize: 13 }
  const value = { fontSize: 15, marginBottom: 12 }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <a href="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to all practices</a>

      <h1 style={{ fontSize: 28, margin: '16px 0 4px' }}>{practice.name}</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>{practice.practice_code}</p>

      {/* Two-column: main content on the left, Worksheet on the right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 720px) minmax(320px, 460px)', gap: 24, alignItems: 'start' }}>
        <div>

      {/* Intelligence Signals — moved to top */}
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

      {/* MIPS — moved to top */}
      <div style={box}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>MIPS</h2>
        <div style={label}>MIPS By Year (as reported)</div>
        <div style={value}>{mips?.reporting_option || '—'}</div>
      </div>

      {/* Activity history */}
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

      {/* Organization roster — everyone sharing this provider's Org_PAC_ID */}
      {provider?.npi && (
        <div style={{ maxWidth: 1100 }}>
          <OrgRoster npi={provider.npi} />
        </div>
      )}

        </div>{/* end left column */}

        {/* Right column — shared Worksheet */}
        <div style={{ position: 'sticky', top: 24 }}>
          <Worksheet practiceCode={code} initial={worksheetInitial} />
        </div>
      </div>{/* end two-column grid */}
    </div>
  )
}