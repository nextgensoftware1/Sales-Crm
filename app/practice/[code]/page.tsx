import OrgRoster from '../../OrgRoster'
import Worksheet from '../../Worksheet'
import { createSupabaseServer } from '../../../lib/supabase-server'
import { roleLabel } from '../../../lib/roles'
import AppShell from '../../AppShell'

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

function mips2026(reportingOption?: string | null): string {
  if (!reportingOption) return ''
  const text = reportingOption.toString()
  if (!text.includes('2026')) return ''
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

  const supabase = await createSupabaseServer()

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
        showTransfers = true
        canManageUsers = isSuperAdmin || ['company_admin', 'manager', 'team_lead'].includes(roleKey)
      }
    }
  } catch {
  }

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
          org_pac_id, num_org_members, payment_adj_pct, penalty,
          provider_signals ( ccm, pcm, awv, tcm, bhi, rpm, rcm_fit, cms_category ),
          provider_mips ( reporting_option )
        )
      )
    `)
    .eq('practice_code', code)

  if (isSuperAdmin) {
    query = query.is('deleted_at', null)
  }

  const { data: candidates, error } = await query
  const rows = (candidates ?? []) as any[]

  let practice: any = null
  if (rows.length > 0) {
    if (myTenantId && !isSuperAdmin) {
      practice = rows.find((r) => r.owner_tenant_id === myTenantId) ?? rows[0]
    } else {
      practice = rows.find((r) => !r.owner_tenant_id) ?? rows[0]
    }
  }

  let authorized = false
  if (practice) {
    if (isSuperAdmin) {
      authorized = true
    } else if (roleKey === 'agent' || roleKey === 'closer') {
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

      // Roster access: if this practice is a roster member, the agent/closer may
      // open it when they're assigned/transferred the ANCHOR that shares its
      // org_pac_id (same organization). So they can work an anchor's roster too.
      if (!authorized && idSet.size > 0) {
        const viewedOrgPac = rows
          .map((r: any) => r.practice_providers?.[0]?.providers?.org_pac_id)
          .find((o: any) => o)
        if (viewedOrgPac) {
          // Which anchor practices share this org_pac_id?
          const { data: sameOrg } = await supabase
            .from('providers')
            .select('id, practice_providers(practice_id)')
            .eq('org_pac_id', viewedOrgPac)
          const orgPracticeIds = new Set<string>()
          for (const pr of (sameOrg ?? []) as any[]) {
            for (const link of (pr.practice_providers ?? [])) {
              if (link.practice_id) orgPracticeIds.add(link.practice_id)
            }
          }
          // Authorized if any of MY assigned practices is in this org.
          for (const assignedId of idSet) {
            if (orgPracticeIds.has(assignedId)) { authorized = true; break }
          }
        }
      }
    } else if (myTenantId) {
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

      // Roster access for company roles: if this is a roster member, allow it
      // when the company owns OR is allocated an ANCHOR in the same organization
      // (same org_pac_id). So managers/TL/admin can review roster leads their
      // agents/closers are working.
      if (!authorized) {
        const viewedOrgPac = rows
          .map((r: any) => r.practice_providers?.[0]?.providers?.org_pac_id)
          .find((o: any) => o)
        if (viewedOrgPac) {
          // All practice_codes in this org.
          const { data: sameOrg } = await supabase
            .from('providers')
            .select('practice_providers(master_practices(practice_code, owner_tenant_id))')
            .eq('org_pac_id', viewedOrgPac)
          const orgCodes: { code: string; owner: string | null }[] = []
          for (const pr of (sameOrg ?? []) as any[]) {
            for (const link of (pr.practice_providers ?? [])) {
              const mp = link.master_practices
              if (mp?.practice_code) orgCodes.push({ code: mp.practice_code, owner: mp.owner_tenant_id ?? null })
            }
          }
          // Owns any anchor in this org?
          if (orgCodes.some((c) => c.owner === myTenantId)) authorized = true
          // Or is allocated any anchor in this org?
          if (!authorized && orgCodes.length) {
            const { data: allocs2 } = await supabase
              .from('lead_allocations')
              .select('master_practices(practice_code)')
              .eq('tenant_id', myTenantId)
              .eq('status', 'active')
            const allocatedCodes = new Set((allocs2 ?? []).map((a: any) => a.master_practices?.practice_code).filter(Boolean))
            if (orgCodes.some((c) => allocatedCodes.has(c.code))) authorized = true
          }
        }
      }
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

  const orgName: string | null = providersList
    .map((prov: any) => (prov?.org_name ?? '').toString().trim())
    .find((n: string) => n.length > 0) || null
  const displayTitle = orgName || practice.name

  let totalProviders = providersList.length
  if (primaryProvider?.org_pac_id) {
    const { count: rosterCount } = await supabase
      .from('providers')
      .select('id', { count: 'exact', head: true })
      .eq('org_pac_id', primaryProvider.org_pac_id)
    if (rosterCount && rosterCount > totalProviders) totalProviders = rosterCount
  }

  const entityTypeRaw = (primaryProvider?.entity_type ?? '').toString().trim().toLowerCase()
  const isAnchor      = !!primaryProvider?.is_anchor

  let isNpiType2 = false
  let isNpiType1 = false
  if (entityTypeRaw) {
    isNpiType2 = entityTypeRaw.includes('2') || entityTypeRaw.includes('org')
    isNpiType1 = entityTypeRaw.includes('1') || entityTypeRaw.includes('ind')
  } else if (primaryProvider) {
    isNpiType2 = isAnchor
    isNpiType1 = !isAnchor
  }
  const npiType2Value = isNpiType2 ? (primaryProvider?.npi ?? 'N/A') : 'N/A'
  const npiType1Value = isNpiType1 ? (primaryProvider?.npi ?? 'N/A') : 'N/A'

  const primaryMipsRows: any[] = Array.isArray(primaryProvider?.provider_mips)
    ? primaryProvider.provider_mips
    : (primaryProvider?.provider_mips ? [primaryProvider.provider_mips] : [])
  const primaryReportingOption = primaryMipsRows[0]?.reporting_option
  const mips2026Value = mips2026(primaryReportingOption) || '—'

  // Penalty: the CSV "Panelty" value for this lead, shown with a $ sign.
  const penaltyRaw = (primaryProvider?.penalty ?? '').toString().trim()
  const penaltyValue = penaltyRaw ? `$${Number(penaltyRaw).toLocaleString()}` : '—'

  let mipsIndividual = 0, mipsGroup = 0, mipsNonEligible = 0
  let anyCcm = false
  for (const prov of providersList) {
    const mipsRows: any[] = Array.isArray(prov.provider_mips) ? prov.provider_mips : (prov.provider_mips ? [prov.provider_mips] : [])
    const reportingOption = mipsRows[0]?.reporting_option
    const status2026 = mips2026(reportingOption).toLowerCase()
    if (status2026.includes('individual')) mipsIndividual++
    else if (status2026.includes('group') || status2026.includes('apm')) mipsGroup++
    else mipsNonEligible++
    if (prov.provider_signals?.ccm) anyCcm = true
  }

  const zone = practice.state ? (ZONE_BY_STATE[practice.state] ?? 'Other') : null
  const statusLabel = pr.ws_disposition || 'New'

  let updatedByName: string | null = null
  if (pr.ws_updated_by) {
    const { data: editor } = await supabase
      .from('users').select('full_name').eq('id', pr.ws_updated_by).maybeSingle()
    updatedByName = (editor as any)?.full_name ?? null
  }

  // Has this lead already been transferred once? If so, the Worksheet's
  // transfer section shows that history. But whether it's actually LOCKED
  // for the person looking at it right now depends on who they are: the
  // closer it was transferred TO still owns this lead and must be able to
  // keep working it. It's everyone else — most importantly the original
  // agent who gave it away — who gets the read-only view.
  let existingTransfer: { closerName: string; handoffStatus: string | null; transferredAt: string; toUserId: string | null } | null = null
  {
    const { data: transferRow } = await supabase
      .from('lead_transfers')
      .select('to_user_id, note, created_at')
      .eq('practice_id', practice.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (transferRow) {
      let closerName = 'Unknown'
      if ((transferRow as any).to_user_id) {
        const { data: closer } = await supabase
          .from('users').select('full_name').eq('id', (transferRow as any).to_user_id).maybeSingle()
        closerName = (closer as any)?.full_name ?? 'Unknown'
      }
      existingTransfer = {
        closerName,
        handoffStatus: (transferRow as any).note ?? null,
        transferredAt: (transferRow as any).created_at,
        toUserId: (transferRow as any).to_user_id ?? null,
      }
    }
  }
  // Only lock the worksheet for viewers who AREN'T the closer it now
  // belongs to. Super Admin can also still edit — matches their oversight
  // access everywhere else in the app.
  const worksheetLocked = !!existingTransfer && existingTransfer.toUserId !== myUserId && !isSuperAdmin
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

            {providersList.length > 0 && (
              <div className="lead-providers-grid">
                {providersList.map((prov: any) => {
                  const mipsRows: any[] = Array.isArray(prov.provider_mips) ? prov.provider_mips : (prov.provider_mips ? [prov.provider_mips] : [])
                  const reportingOption = mipsRows[0]?.reporting_option
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

            {primaryProvider?.npi && <OrgRoster npi={primaryProvider.npi} />}

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

          <div className="sticky-col" style={{ position: 'sticky', top: 24, minWidth: 0 }}>
            <Worksheet practiceCode={code} initial={worksheetInitial} existingTransfer={existingTransfer} locked={worksheetLocked} />
          </div>
        </div>
      </div>
    </AppShell>
  )
}