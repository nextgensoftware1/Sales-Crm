import OrgRoster from '../../OrgRoster'
import Worksheet from '../../Worksheet'
import { createSupabaseServer } from '../../../lib/supabase-server'
import AppShell from '../../AppShell'

// Simple, deterministic state -> US timezone-zone mapping, used only to label
// the practice's zone badge from data we already have (its state). Purely a
// computed display label — no data is invented.
const ZONE_BY_STATE: Record<string, string> = {
  CT: 'EST', DE: 'EST', FL: 'EST', GA: 'EST', ME: 'EST', MD: 'EST', MA: 'EST', NH: 'EST',
  NJ: 'EST', NY: 'EST', NC: 'EST', OH: 'EST', PA: 'EST', RI: 'EST', SC: 'EST', VT: 'EST',
  VA: 'EST', WV: 'EST', DC: 'EST', MI: 'EST', IN: 'EST', KY: 'EST',
  AL: 'CST', AR: 'CST', IL: 'CST', IA: 'CST', KS: 'CST', LA: 'CST', MN: 'CST', MS: 'CST',
  MO: 'CST', NE: 'CST', ND: 'CST', OK: 'CST', SD: 'CST', TN: 'CST', TX: 'CST', WI: 'CST',
  AZ: 'MST', CO: 'MST', ID: 'MST', MT: 'MST', NM: 'MST', UT: 'MST', WY: 'MST',
  CA: 'PST', NV: 'PST', OR: 'PST', WA: 'PST',
  AK: 'Other', HI: 'Other',
}

// Same "does this MIPS text mean real participation" rule used on the bulk
// Leads Engine table, applied per-provider here.
function hasRealMips(reportingOption?: string | null): boolean {
  const v = (reportingOption ?? '').toString().trim().toLowerCase()
  if (!v) return false
  if (v.includes('individual')) return true
  if (v.includes('group')) return true
  if (v.includes('apm')) return true
  return false
}
function mipsBucket(reportingOption?: string | null): 'individual' | 'group' | 'non' {
  const v = (reportingOption ?? '').toString().trim().toLowerCase()
  if (v.includes('individual')) return 'individual'
  if (v.includes('group') || v.includes('apm')) return 'group'
  return 'non'
}

export default async function PracticeDetail({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  // One Supabase client — handles auth AND data (matches the pattern in app/page.tsx).
  const supabase = await createSupabaseServer()

  // Current user, for the shared app chrome (sidebar / topbar) AND for
  // picking the right copy of a practice when the same practice_code
  // exists for multiple tenants.
  let currentUser: { full_name: string; role: string; company: string } | null = null
  let isSuperAdmin = false
  let myTenantId: string | null = null
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser) {
      const { data: me } = await supabase
        .from('users')
        .select('full_name, tenant_id, roles(key, label), tenants(name)')
        .eq('auth_id', authUser.id)
        .single()
      if (me) {
        currentUser = {
          full_name: (me as any).full_name,
          role: (me as any).roles?.label ?? 'Unknown',
          company: (me as any).tenants?.name ?? '',
        }
        isSuperAdmin = (me as any).roles?.key === 'super_admin'
        myTenantId = (me as any).tenant_id ?? null
      }
    }
  } catch {
    // Chrome is cosmetic here — if this lookup fails, the page still renders.
  }

  // Fetch ALL rows matching this practice_code — same code may exist in multiple
  // tenants (Platform copy + each company's copy). We pick ONE row based on who's
  // viewing. Using .single() here would crash with "Cannot coerce" when >1 exists.
  let query = supabase
    .from('master_practices')
    .select(`
      id, practice_code, name, state, city, postal, specialty, phone,
      owner_tenant_id, deleted_at,
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
    `)
    .eq('practice_code', code)

  // Super Admin: hide soft-deleted from the detail page too (they belong in
  // /deleted-leads). Company users still see soft-deleted leads if they had
  // them allocated — matches the visibility rule in the Lead Pool.
  if (isSuperAdmin) {
    query = query.is('deleted_at', null)
  }

  const { data: candidates, error } = await query
  const rows = (candidates ?? []) as any[]

  // Pick the best row for this viewer:
  //   1. Company users → their own tenant's copy first
  //   2. Otherwise    → the Platform copy (owner_tenant_id typically NULL)
  //   3. Fallback     → first row available
  let practice: any = null
  if (rows.length > 0) {
    if (myTenantId && !isSuperAdmin) {
      practice = rows.find((r) => r.owner_tenant_id === myTenantId) ?? rows[0]
    } else {
      practice = rows.find((r) => !r.owner_tenant_id) ?? rows[0]
    }
  }

  if (error || !practice) {
    return (
      <AppShell title="Practice not found" currentUser={currentUser} active="/" showAdmin={isSuperAdmin}>
        <div className="card" style={{ maxWidth: 600 }}>
          <a href="/">← Back to all practices</a>
          <h1 style={{ color: 'var(--danger)', marginTop: 20, fontSize: 20 }}>Practice not found</h1>
          <p style={{ marginTop: 12, color: 'var(--muted)' }}>
            {rows.length === 0
              ? `No practice with code "${code}" is visible to you.`
              : `Found ${rows.length} matches but could not choose one.`}
          </p>
          {error?.message && <pre className="subtle" style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>}
        </div>
      </AppShell>
    )
  }

  // Prev/Next pagination — ordered by name, deduped by practice_code so we
  // don't count the same code multiple times when it exists per-tenant.
  const { data: allCodesRows } = await supabase
    .from('master_practices')
    .select('practice_code')
    .order('name', { ascending: true })
  const seenCodes = new Set<string>()
  const codesList: string[] = []
  for (const r of (allCodesRows ?? []) as any[]) {
    if (r.practice_code && !seenCodes.has(r.practice_code)) {
      seenCodes.add(r.practice_code)
      codesList.push(r.practice_code)
    }
  }
  const currentIndex = codesList.indexOf(code)
  const totalCount = codesList.length
  const prevCode = currentIndex > 0 ? codesList[currentIndex - 1] : null
  const nextCode = currentIndex >= 0 && currentIndex < codesList.length - 1 ? codesList[currentIndex + 1] : null

  // Fetch past activity for this practice (dispositions + notes)
  const { data: activity } = await supabase
    .from('lead_activity')
    .select('disposition, note, created_at, users(full_name)')
    .eq('practice_id', practice.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const pr = practice as any
  const providerLinks = (pr.practice_providers ?? []) as any[]
  const providersList = providerLinks.map((pl) => pl.providers).filter(Boolean)
  const primaryProvider = providersList[0]

  // Aggregate MIPS eligibility + CCM qualification across ALL providers at this practice.
  let mipsIndividual = 0, mipsGroup = 0, mipsNonEligible = 0
  let anyCcm = false
  for (const prov of providersList) {
    const mipsRows: any[] = Array.isArray(prov.provider_mips) ? prov.provider_mips : (prov.provider_mips ? [prov.provider_mips] : [])
    const reportingOption = mipsRows[0]?.reporting_option
    const bucket = mipsBucket(reportingOption)
    if (bucket === 'individual') mipsIndividual++
    else if (bucket === 'group') mipsGroup++
    else mipsNonEligible++
    if (prov.provider_signals?.ccm) anyCcm = true
  }

  const zone = practice.state ? (ZONE_BY_STATE[practice.state] ?? 'Other') : null
  const statusLabel = pr.ws_disposition || 'New'

  // Worksheet: prefill from saved fields; look up who last edited it.
  let updatedByName: string | null = null
  if (pr.ws_updated_by) {
    const { data: editor } = await supabase
      .from('users').select('full_name').eq('id', pr.ws_updated_by).maybeSingle()
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

  return (
    <AppShell
      title="Leads Management Engine"
      subtitle="Import, deduplicate, and assign practice-first leads to employees"
      currentUser={currentUser}
      active="/"
      showAdmin={isSuperAdmin}
    >
      <div className="lead-page">
        {/* ---- Header: back / pager / title+badges / address+phone ---- */}
        <div className="lead-card">
          <div className="lead-header-row">
            <div className="lead-header-left">
              <a href="/" className="lead-back-btn" title="Back to list">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </a>
              <div className="lead-pager">
                {prevCode ? (
                  <a href={`/practice/${prevCode}`} title="Previous Lead">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                  </a>
                ) : <span className="lead-pager-disabled"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg></span>}
                <span className="lead-pager-count">{currentIndex >= 0 ? currentIndex + 1 : '?'} / {totalCount}</span>
                {nextCode ? (
                  <a href={`/practice/${nextCode}`} title="Next Lead">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                  </a>
                ) : <span className="lead-pager-disabled"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>}
              </div>
              <div>
                <div className="lead-title-row">
                  <h2 className="lead-title">{practice.name}</h2>
                  <span className="lead-code">{practice.practice_code}</span>
                  <span className="lead-badge"><span className="lead-badge-dot" />{statusLabel}</span>
                  {practice.specialty && <span className="lead-badge">{practice.specialty}</span>}
                  {zone && <span className="lead-badge">{zone}</span>}
                  <span className="lead-badge">{providersList.length} Providers</span>
                </div>
                <div className="lead-meta">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></svg>
                  <span>{[practice.city, practice.state, practice.postal].filter(Boolean).join(', ') || practice.city || '—'}</span>
                  {practice.phone && (
                    <>
                      <span className="lead-meta-sep">|</span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" /></svg>
                      <span>{practice.phone}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ---- Contact fields (worksheet-adjacent, read-only summary) ---- */}
          <div className="lead-fields-panel" style={{ marginTop: 16 }}>
            <div className="lead-fields-grid">
              <div><span className="lead-field-label">Additional Phone</span><div className="lead-field-value">{worksheetInitial.additionalPhone || '—'}</div></div>
              <div><span className="lead-field-label">Additional Email</span><div className="lead-field-value">{worksheetInitial.email || '—'}</div></div>
              <div><span className="lead-field-label">Contact Person</span><div className="lead-field-value">{worksheetInitial.concernedPerson || '—'}</div></div>
              <div><span className="lead-field-label">Contact Phone</span><div className="lead-field-value">—</div></div>
              <div><span className="lead-field-label">Direct Line</span><div className="lead-field-value">{worksheetInitial.directLine || '—'}</div></div>
              <div><span className="lead-field-label">Contact Email</span><div className="lead-field-value">—</div></div>
            </div>
          </div>
        </div>

        {/* ---- Stat row ---- */}
        <div className="lead-stats-grid">
          <div className="lead-stat"><span className="lead-stat-value">—</span><span className="lead-stat-label">MIPS</span></div>
          <div className="lead-stat"><span className="lead-stat-value">—</span><span className="lead-stat-label">Penalty</span></div>
          <div className="lead-stat"><span className="lead-stat-value">—</span><span className="lead-stat-label">Patients</span></div>
          <div className="lead-stat"><span className="lead-stat-value">—</span><span className="lead-stat-label">Impact</span></div>
          <div className="lead-stat"><span className="lead-stat-value">{providersList.length}</span><span className="lead-stat-label">Providers</span></div>
          <div className="lead-stat"><span className="lead-stat-value">—</span><span className="lead-stat-label">Allowed</span></div>
          <div className="lead-stat"><span className={`lead-stat-value${anyCcm ? ' good' : ''}`}>{anyCcm ? 'Yes' : 'No'}</span><span className="lead-stat-label">CCM</span></div>
          <div className="lead-stat"><span className="lead-stat-value">—</span><span className="lead-stat-label">CCM Opp</span></div>
        </div>

        {/* ---- Two-column: Practice Profile | Worksheet ---- */}
        <div className="lead-2col">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            <div className="lead-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 12 }}>
                <h4 style={{ margin: 0, border: 'none', padding: 0 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /><rect width="20" height="14" x="2" y="6" rx="2" /></svg>
                  Practice Profile
                </h4>
              </div>

              <div className="lead-kv"><span>NPI Type 2</span><span className="mono">{primaryProvider?.npi ?? 'N/A'}</span></div>
              <div className="lead-kv"><span>Org PAC ID</span><span className="mono">N/A</span></div>

              <div className="lead-divider">
                <span className="lead-subhead">Authorized Official</span>
                <div className="lead-kv"><span>Name</span><span>{primaryProvider?.name ?? '—'}</span></div>
                <div className="lead-kv"><span>Phone</span><span className="mono">{primaryProvider?.phone ?? practice.phone ?? '—'}</span></div>
              </div>

              <div className="lead-divider">
                <span className="lead-subhead">CCM Details</span>
                <div className="lead-kv">
                  <span>Qualified</span>
                  <span className={`lead-pill-sm ${anyCcm ? 'lead-pill-good' : 'lead-pill-neutral'}`}>
                    {anyCcm ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="lead-kv"><span>CCM Opportunity</span><span style={{ color: 'var(--ok)' }}>—</span></div>
              </div>

              <div className="lead-divider">
                <span className="lead-subhead">Locations</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14} style={{ color: 'var(--accent)', flexShrink: 0 }}><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></svg>
                  <span style={{ fontWeight: 700, color: 'var(--ink-strong)' }}>{[practice.city, practice.state, practice.postal].filter(Boolean).join(', ') || '—'}</span>
                  <span className="lead-pill-sm lead-pill-neutral" style={{ fontSize: 9 }}>Primary</span>
                </div>
              </div>

              <div className="lead-divider">
                <span className="lead-subhead">MIPS History</span>
                <p style={{ color: 'var(--muted)', fontSize: 11, fontStyle: 'italic', margin: 0 }}>No MIPS history — enrich via CMS APIs to pull QPP data.</p>
              </div>

              <div className="lead-divider">
                <span className="lead-subhead">MIPS Eligibility ({providersList.length} Clinicians)</span>
                <div className="lead-mips-grid">
                  <div className="lead-mips-cell good">
                    <span className="n">{mipsIndividual}</span>
                    <span className="l">Individual</span>
                  </div>
                  <div className="lead-mips-cell warn">
                    <span className="n">{mipsGroup}</span>
                    <span className="l">Group/Opt-in</span>
                  </div>
                  <div className="lead-mips-cell bad">
                    <span className="n">{mipsNonEligible}</span>
                    <span className="l">Non Eligible</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Provider mini-cards */}
            {providersList.length > 0 && (
              <div className="lead-providers-grid">
                {providersList.map((prov: any) => {
                  const mipsRows: any[] = Array.isArray(prov.provider_mips) ? prov.provider_mips : (prov.provider_mips ? [prov.provider_mips] : [])
                  const reportingOption = mipsRows[0]?.reporting_option
                  const eligible = hasRealMips(reportingOption)
                  return (
                    <div key={prov.npi} className="lead-provider-card">
                      <div className="lead-provider-top">
                        <span className="lead-provider-name">{prov.name}</span>
                        <span className={`lead-pill-sm ${eligible ? 'lead-pill-good' : 'lead-pill-bad'}`} style={{ fontSize: 8 }}>
                          {eligible ? 'Eligible' : 'Non Eligible'}
                        </span>
                      </div>
                      <div className="lead-provider-sub">{prov.taxonomy_desc || '—'} | 0 pts | Score: —</div>
                      <div className="lead-provider-npi">{prov.npi}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Organization roster — everyone sharing this provider's Org_PAC_ID */}
            {primaryProvider?.npi && <OrgRoster npi={primaryProvider.npi} />}

            {/* Activity history */}
            <div className="lead-card">
              <h4>Activity History &amp; Call Logs</h4>
              {(!activity || activity.length === 0) ? (
                <p className="lead-activity-empty">No prior logs or activities recorded.</p>
              ) : activity.map((a: any, i) => (
                <div key={i} className="lead-activity-row">
                  <div style={{ fontSize: 13 }}>
                    {a.disposition && <strong style={{ color: 'var(--accent)' }}>{a.disposition}</strong>}
                    {a.note && <span style={{ color: 'var(--ink)' }}> — {a.note}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {a.users?.full_name ?? 'Someone'} · {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column — shared Worksheet */}
          <div className="sticky-col" style={{ position: 'sticky', top: 24, minWidth: 0 }}>
            <Worksheet practiceCode={code} initial={worksheetInitial} />
          </div>
        </div>
      </div>
    </AppShell>
  )
}