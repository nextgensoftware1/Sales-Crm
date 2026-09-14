import OrgRoster from '../../OrgRoster'
import Worksheet from '../../Worksheet'
import { createSupabaseServer } from '../../../lib/supabase-server'
import { roleLabel } from '../../../lib/roles'
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

// Pull the 2026 status out of a MIPS_By_Year style string.
// Example inputs:
//   "2026 - Individual"                         → "Individual"
//   "2025 - Group | 2026 - Individual"          → "Individual"
//   "2026 - Excluded - low volume / No record"  → "Excluded - low volume / No record"
//   "2024 - Group"                              → "" (no 2026 mention)
// Returns "" if 2026 not present.
function mips2026(reportingOption?: string | null): string {
  if (!reportingOption) return ''
  const text = reportingOption.toString()
  if (!text.includes('2026')) return ''
  // Try common patterns: "2026 - X", "2026: X", "2026 X"
  const match = text.match(/2026\s*[-:]?\s*([^|;\n]+)/i)
  if (match && match[1]) return match[1].trim()
  return 'Yes'
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
  let myUserId: string | null = null
  let roleKey = ''
  let showTransfers = false
  let canManageUsers = false
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser) {
      const { data: me } = await supabase
        .from('users')
        .select('id, full_name, tenant_id, roles(key, label), tenants(name)')
        .eq('auth_id', authUser.id)
        .single()
      if (me) {
        currentUser = {
          full_name: (me as any).full_name,
          role: roleLabel((me as any).roles?.key),
          company: (me as any).tenants?.name ?? '',
        }
        roleKey = (me as any).roles?.key ?? ''
        isSuperAdmin = roleKey === 'super_admin'
        myTenantId = (me as any).tenant_id ?? null
        myUserId = (me as any).id ?? null
        showTransfers = true // everyone signed in can view transfers (scoped by role inside the page)
        canManageUsers = isSuperAdmin || ['company_admin', 'manager', 'team_lead'].includes(roleKey)
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
          npi, name, org_name, credential, taxonomy_code, taxonomy_desc,
          addr1, city, state, postal, phone,
          status, mailing_phone, entity_type, is_anchor,
          org_pac_id, num_org_members, payment_adj_pct,
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

  // ---- Authorization: does this signed-in user actually have access to
  // this lead? Being logged in is not enough — the same rule the main Leads
  // Engine pool already enforces applies here too, or anyone could open any
  // lead just by knowing/guessing its URL. Fails CLOSED: unrecognized roles
  // see nothing. A failed check renders the exact same "not found" card
  // used for a genuinely missing practice, so this page never reveals
  // whether a lead exists that the viewer isn't allowed to see.
  let authorized = false
  if (practice) {
    if (isSuperAdmin) {
      authorized = true
    } else if (roleKey === 'agent' || roleKey === 'closer') {
      // Same rule as the main pool: leads directly assigned to me, plus —
      // for closers — leads a transfer has sent to me.
      const idSet = new Set<string>()
      if (myUserId) {
        const { data: assigns } = await supabase
          .from('lead_assignments')
          .select('practice_id')
          .eq('assigned_to', myUserId)
          .eq('status', 'active')
        for (const a of (assigns ?? []) as any[]) if (a.practice_id) idSet.add(a.practice_id)

        if (roleKey === 'closer') {
          const { data: transfers } = await supabase
            .from('lead_transfers')
            .select('practice_id')
            .eq('to_user_id', myUserId)
          for (const t of (transfers ?? []) as any[]) if (t.practice_id) idSet.add(t.practice_id)
        }
      }
      authorized = rows.some((r) => idSet.has(r.id))
    } else if (myTenantId) {
      // Company roles (company_admin / manager / team_lead): visible if
      // they own this practice themselves, or their company has it
      // allocated — matched by practice_code, same as the main pool, since
      // an allocation points at the Platform copy while the company may be
      // viewing its own separate copy of the same code.
      const ownsIt = rows.some((r) => r.owner_tenant_id === myTenantId)
      let allocatedToMe = false
      if (!ownsIt) {
        const { data: allocs } = await supabase
          .from('lead_allocations')
          .select('id, master_practices(practice_code)')
          .eq('tenant_id', myTenantId)
          .eq('status', 'active')
        allocatedToMe = (allocs ?? []).some((a: any) => a.master_practices?.practice_code === code)
      }
      authorized = ownsIt || allocatedToMe
    }
  }

  if (!authorized) practice = null

  if (error || !practice) {
    return (
      <AppShell title="Practice not found" currentUser={currentUser} active="/" showAdmin={isSuperAdmin} showTransfers={showTransfers} canManageUsers={canManageUsers}>
        <div className="card" style={{ maxWidth: 600 }}>
          <a href="/">← Back to all practices</a>
          <h1 style={{ color: 'var(--danger)', marginTop: 20, fontSize: 20 }}>Practice not found</h1>
          <p className="subtle" style={{ marginTop: 12 }}>
            {error
              ? 'Something went wrong looking this practice up. Please try again, or contact support if it persists.'
              : `No practice with code "${code}" is visible to you. It may not be allocated or assigned to you, may have been permanently deleted, or the link is incorrect.`}
          </p>
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

  // Show the organization name at the top when this practice/clinician is
  // affiliated with one (from NPPES provider data). Falls back to the
  // practice/clinician's own name for solo practices with no organization.
  const orgName: string | null = providersList
    .map((prov: any) => (prov?.org_name ?? '').toString().trim())
    .find((n: string) => n.length > 0) || null
  const displayTitle = orgName || practice.name

  // ---- Total Provider count from the org roster ----
  // The practice_providers link table only has direct links (typically 1 anchor row
  // per practice from CSV upload). But the full ORGANIZATION roster is stored across
  // the providers table under the same org_pac_id (added via CMS Doctors & Clinicians
  // enrichment). So count everyone sharing the same org_pac_id — that's the real roster.
  let totalProviders = providersList.length   // fallback: at least the direct links
  if (primaryProvider?.org_pac_id) {
    const { count: rosterCount } = await supabase
      .from('providers')
      .select('id', { count: 'exact', head: true })
      .eq('org_pac_id', primaryProvider.org_pac_id)
    if (rosterCount && rosterCount > totalProviders) totalProviders = rosterCount
  }

  // ---- NPI Type detection ----
  // Determines whether the provider is Type 1 (individual) or Type 2 (organization).
  //   1. Primary source: providers.entity_type from NPPES (e.g. "NPI-1" / "NPI-2")
  //   2. Fallback: providers.is_anchor — auto-detected during upload from the
  //      presence of BOTH PECOS_ASCT_CNTL_ID and ENRLMT_ID, which indicates a
  //      billing organization (Type 2). Anything else is treated as Type 1.
  const entityTypeRaw = (primaryProvider?.entity_type ?? '').toString().trim().toLowerCase()
  const isAnchor      = !!primaryProvider?.is_anchor

  let isNpiType2 = false
  let isNpiType1 = false
  if (entityTypeRaw) {
    isNpiType2 = entityTypeRaw.includes('2') || entityTypeRaw.includes('org')
    isNpiType1 = entityTypeRaw.includes('1') || entityTypeRaw.includes('ind')
  } else if (primaryProvider) {
    // No entity_type — infer from is_anchor.
    isNpiType2 = isAnchor
    isNpiType1 = !isAnchor
  }
  const npiType2Value = isNpiType2 ? (primaryProvider?.npi ?? 'N/A') : 'N/A'
  const npiType1Value = isNpiType1 ? (primaryProvider?.npi ?? 'N/A') : 'N/A'

  // ---- KPI values for the 4 top tiles ----
  // MIPS: parse the 2026 status out of the primary provider's reporting_option.
  const primaryMipsRows: any[] = Array.isArray(primaryProvider?.provider_mips)
    ? primaryProvider.provider_mips
    : (primaryProvider?.provider_mips ? [primaryProvider.provider_mips] : [])
  const primaryReportingOption = primaryMipsRows[0]?.reporting_option
  const mips2026Value = mips2026(primaryReportingOption) || '—'

  // Penalty: use the primary provider's payment_adj_pct (already text like "1.88%").
  const penaltyValue = (primaryProvider?.payment_adj_pct ?? '').toString().trim() || '—'

  // Aggregate MIPS eligibility + CCM qualification across ALL providers at this practice.
  // MIPS categorization uses ONLY the 2026 year — older years are ignored so the
  // buckets reflect current eligibility, not historical status.
  let mipsIndividual = 0, mipsGroup = 0, mipsNonEligible = 0
  let anyCcm = false
  for (const prov of providersList) {
    const mipsRows: any[] = Array.isArray(prov.provider_mips) ? prov.provider_mips : (prov.provider_mips ? [prov.provider_mips] : [])
    const reportingOption = mipsRows[0]?.reporting_option
    // Extract just the 2026 portion so bucketing only reflects 2026 status.
    const status2026 = mips2026(reportingOption).toLowerCase()
    if (status2026.includes('individual')) mipsIndividual++
    else if (status2026.includes('group') || status2026.includes('apm')) mipsGroup++
    else mipsNonEligible++     // includes '', 'excluded', 'no record', etc.
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
      showTransfers={showTransfers}
      canManageUsers={canManageUsers}
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
                  <h2 className="lead-title">{displayTitle}</h2>
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

          {/* ---- Contact fields: mapped from NPPES provider data ---- */}
          <div className="lead-fields-panel" style={{ marginTop: 16 }}>
            <div className="lead-fields-grid">
              <div>
                <span className="lead-field-label">Additional Phone</span>
                <div className="lead-field-value">{primaryProvider?.phone || '—'}</div>
              </div>
              <div>
                <span className="lead-field-label">NPPES_Status</span>
                <div className="lead-field-value">{primaryProvider?.status || '—'}</div>
              </div>
              <div>
                <span className="lead-field-label">NPPES_PrimaryTaxonomyCode</span>
                <div className="lead-field-value">{primaryProvider?.taxonomy_code || '—'}</div>
              </div>
              <div>
                <span className="lead-field-label">Contact Phone</span>
                <div className="lead-field-value">{primaryProvider?.mailing_phone || '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Stat row (4 tiles — Patients/Impact/Allowed/CCM Opp hidden until wired up) ---- */}
        <div className="lead-stats-grid">
          <div className="lead-stat" title={mips2026Value}>
            <span
              className="lead-stat-value"
              style={{
                fontSize: mips2026Value.length > 12 ? 11 : undefined,
                lineHeight: 1.3,
                whiteSpace: 'normal',
                overflow: 'visible',
                textOverflow: 'clip',
                display: 'block',
                textAlign: 'center',
                fontWeight: 700,
              }}
            >
              {mips2026Value}
            </span>
            <span className="lead-stat-label">MIPS 2026</span>
          </div>
          <div className="lead-stat">
            <span className="lead-stat-value">{penaltyValue}</span>
            <span className="lead-stat-label">Penalty</span>
          </div>
          <div className="lead-stat">
            <span className="lead-stat-value">{totalProviders}</span>
            <span className="lead-stat-label">Providers</span>
          </div>
          <div className="lead-stat">
            <span className={`lead-stat-value${anyCcm ? ' good' : ''}`}>{anyCcm ? 'Yes' : 'No'}</span>
            <span className="lead-stat-label">CCM</span>
          </div>
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

              <div className="lead-kv"><span>NPI Type 1</span><span className="mono">{npiType1Value}</span></div>
              <div className="lead-kv"><span>NPI Type 2</span><span className="mono">{npiType2Value}</span></div>
              <div className="lead-kv"><span>Org PAC ID</span><span className="mono">{primaryProvider?.org_pac_id || 'N/A'}</span></div>

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
                  // Eligibility badge reflects 2026 specifically.
                  const status2026 = mips2026(reportingOption).toLowerCase()
                  const eligible = status2026.includes('individual') || status2026.includes('group') || status2026.includes('apm')
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