// 'use server'

// import { createSupabaseServer } from '../lib/supabase-server'

// type CsvRow = Record<string, string>

// const CHUNK = 500
// const clean = (v: string | undefined) => (v ?? '').trim()
// const yes = (v: string | undefined) => (v ?? '').trim().toLowerCase() === 'yes'

// function chunk<T>(arr: T[], size: number): T[][] {
//   const out: T[][] = []
//   for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
//   return out
// }

// export async function uploadLeadsCsv(
//   rows: CsvRow[]
// ): Promise<{ ok: boolean; message: string; inserted?: number; skipped?: number }> {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not signed in.' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, tenant_id, roles(key)')
//     .eq('auth_id', user.id)
//     .single()

//   const roleKey = (me as any)?.roles?.key ?? ''
//   let tenantId = (me as any)?.tenant_id

//   if (!['company_admin', 'manager', 'super_admin'].includes(roleKey)) {
//     return { ok: false, message: 'Only a Company Admin, Manager, or Super Admin can upload leads.' }
//   }

//   if (roleKey === 'super_admin') {
//     const { data: platform } = await supabase
//       .from('tenants')
//       .select('id')
//       .eq('is_platform', true)
//       .maybeSingle()
//     if (!platform) return { ok: false, message: 'No Platform tenant found. Run migration 014.' }
//     tenantId = (platform as any).id
//   }

//   if (!tenantId) return { ok: false, message: 'No company linked to your account.' }
//   if (!Array.isArray(rows) || rows.length === 0) {
//     return { ok: false, message: 'No rows found in the file.' }
//   }

//   const keyMap = new Map<string, string>()
//   for (const k of Object.keys(rows[0])) keyMap.set(k.trim().toLowerCase(), k)
//   const col = (row: CsvRow, name: string) => {
//     const realKey = keyMap.get(name.toLowerCase())
//     return realKey ? clean(row[realKey]) : ''
//   }
//   const npiKey = keyMap.get('npi')
//   if (!npiKey) return { ok: false, message: 'CSV has no NPI column.' }

//   const byCode = new Map<string, CsvRow>()
//   for (const row of rows) {
//     const npi = clean(row[npiKey])
//     if (!npi) continue
//     const code = `PR-${npi}`
//     if (!byCode.has(code)) byCode.set(code, row)
//   }
//   const allCodes = Array.from(byCode.keys())

//   const existingCodes = new Set<string>()
//   for (const codes of chunk(allCodes, 800)) {
//     const { data: existing } = await supabase
//       .from('master_practices')
//       .select('practice_code')
//       .eq('owner_tenant_id', tenantId)
//       .in('practice_code', codes)
//     for (const e of (existing ?? []) as any[]) existingCodes.add(e.practice_code)
//   }

//   const toInsertByCode = allCodes.filter((c) => !existingCodes.has(c))

//   const npiByCode = new Map<string, string>()
//   for (const code of toInsertByCode) {
//     const npi = clean(byCode.get(code)![npiKey])
//     if (npi) npiByCode.set(code, npi)
//   }
//   const incomingNpis = Array.from(new Set(npiByCode.values()))
//   const existingNpis = new Set<string>()
//   for (const part of chunk(incomingNpis, 300)) {
//     const { data: existProv } = await supabase
//       .from('providers')
//       .select('npi')
//       .eq('owner_tenant_id', tenantId)
//       .in('npi', part)
//     for (const p of (existProv ?? []) as any[]) existingNpis.add(p.npi)
//   }

//   const toInsert = toInsertByCode.filter((c) => {
//     const npi = npiByCode.get(c)
//     return npi ? !existingNpis.has(npi) : true
//   })
//   const skipped = allCodes.length - toInsert.length
//   if (toInsert.length === 0) {
//     return { ok: true, message: `Nothing new — all ${skipped} lead(s) already exist for your company.`, inserted: 0, skipped }
//   }

//   // Anchor detection: Source='uploaded' OR (PECOS + ENRLMT present).
//   const isAnchorRow = (code: string) => {
//     const row = byCode.get(code)!
//     const source = col(row, 'Source').toLowerCase()
//     if (source === 'uploaded') return true
//     if (source.startsWith('roster')) return false
//     return !!(col(row, 'PECOS_ASCT_CNTL_ID') && col(row, 'ENRLMT_ID'))
//   }

//   const providerRows = toInsert.map((code) => {
//     const row = byCode.get(code)!
//     const npi = clean(row[npiKey])
//     const numMembers = col(row, 'Num_Org_Members')
//     const pecos = col(row, 'PECOS_ASCT_CNTL_ID') || null
//     const enrlmt = col(row, 'ENRLMT_ID') || null
//     return {
//       npi,
//       name: col(row, 'NPPES_Name') || col(row, 'Name') || `Practice (NPI ${npi})`,
//       state: col(row, 'NPPES_PrimaryState') || col(row, 'NPPES_State') || col(row, 'State') || null,
//       city: col(row, 'NPPES_PrimaryCity') || col(row, 'NPPES_City') || col(row, 'City') || null,
//       postal: col(row, 'NPPES_PrimaryPostal') || col(row, 'NPPES_Postal') || col(row, 'Postal') || null,
//       taxonomy_desc: col(row, 'NPPES_PrimaryTaxonomyDesc') || col(row, 'NPPES_Taxonomy_Desc') || col(row, 'Specialty') || null,
//       phone: col(row, 'NPPES_PrimaryPhone') || col(row, 'NPPES_Phone') || col(row, 'Phone') || null,
//       org_pac_id: col(row, 'Org_PAC_ID') || null,
//       org_name: col(row, 'Org_Name') || null,
//       num_org_members: numMembers ? parseInt(numMembers, 10) || null : null,
//       pecos_asct_cntl_id: pecos,
//       enrlmt_id: enrlmt,
//       nppes_sex: col(row, 'NPPES_Sex') || null,
//       nppes_last_updated: col(row, 'NPPES_LastUpdated') || null,
//       payment_adj_pct: col(row, 'Payment_Adj_%') || col(row, 'Payment_Adj_Pct') || col(row, 'Payment Adjustment Percentage') || null,
//       at_risk: col(row, 'At_Risk') || null,
//       penalty: col(row, 'Panelty') || col(row, 'Penalty') || null,
//       is_anchor: isAnchorRow(code),
//       owner_tenant_id: tenantId,
//     }
//   })

//   const providerIdByCode = new Map<string, string>()
//   for (const part of chunk(providerRows, CHUNK)) {
//     const { data, error } = await supabase.from('providers').insert(part).select('id, npi')
//     if (error) return { ok: false, message: `Provider insert failed: ${error.message}` }
//     for (const p of (data ?? []) as any[]) providerIdByCode.set(`PR-${p.npi}`, p.id)
//   }

//   const anchorCodes = toInsert.filter(isAnchorRow)

//   // Practices for EVERY provider (anchors + roster). Roster rows flagged
//   // is_roster=true so the main Lead Pool hides them; still openable via roster.
//   const practiceRows = toInsert.map((code) => {
//     const row = byCode.get(code)!
//     return {
//       practice_code: code,
//       name: col(row, 'NPPES_Name') || col(row, 'Name') || `Practice (${code})`,
//       state: col(row, 'NPPES_PrimaryState') || col(row, 'NPPES_State') || col(row, 'State') || null,
//       city: col(row, 'NPPES_PrimaryCity') || col(row, 'NPPES_City') || col(row, 'City') || null,
//       postal: col(row, 'NPPES_PrimaryPostal') || col(row, 'NPPES_Postal') || col(row, 'Postal') || null,
//       specialty: col(row, 'NPPES_PrimaryTaxonomyDesc') || col(row, 'NPPES_Taxonomy_Desc') || col(row, 'Specialty') || null,
//       phone: col(row, 'NPPES_PrimaryPhone') || col(row, 'NPPES_Phone') || col(row, 'Phone') || null,
//       is_roster: !isAnchorRow(code),
//       owner_tenant_id: tenantId,
//     }
//   })

//   const practiceIdByCode = new Map<string, string>()
//   for (const part of chunk(practiceRows, CHUNK)) {
//     const { data, error } = await supabase.from('master_practices').insert(part).select('id, practice_code')
//     if (error) return { ok: false, message: `Practice insert failed: ${error.message}` }
//     for (const m of (data ?? []) as any[]) practiceIdByCode.set(m.practice_code, m.id)
//   }

//   const linkRows: any[] = []
//   for (const code of toInsert) {
//     const pid = providerIdByCode.get(code)
//     const mid = practiceIdByCode.get(code)
//     if (pid && mid) linkRows.push({ practice_id: mid, provider_id: pid, is_primary: true })
//   }
//   for (const part of chunk(linkRows, CHUNK)) {
//     const { error } = await supabase.from('practice_providers').insert(part)
//     if (error) return { ok: false, message: `Link insert failed: ${error.message}` }
//   }

//   const signalRows: any[] = []
//   for (const code of toInsert) {
//     const pid = providerIdByCode.get(code)
//     if (!pid) continue
//     const row = byCode.get(code)!
//     signalRows.push({
//       provider_id: pid,
//       ccm: yes(col(row, 'CMS_CCM')),
//       pcm: yes(col(row, 'CMS_PCM')),
//       awv: yes(col(row, 'CMS_AWV')),
//       tcm: yes(col(row, 'CMS_TCM')),
//       bhi: yes(col(row, 'CMS_BHI')),
//       rpm: yes(col(row, 'CMS_RPM')),
//       rcm_fit: yes(col(row, 'CMS_RCM')),
//       cms_category: col(row, 'CMS_Category') || null,
//     })
//   }
//   for (const part of chunk(signalRows, CHUNK)) {
//     const { error } = await supabase.from('provider_signals').insert(part)
//     if (error) return { ok: false, message: `Signals insert failed: ${error.message}` }
//   }

//   const mipsRows: any[] = []
//   for (const code of toInsert) {
//     const pid = providerIdByCode.get(code)
//     if (!pid) continue
//     const row = byCode.get(code)!
//     const mipsText = col(row, 'MIPS_By_Year')
//     if (mipsText) {
//       mipsRows.push({
//         provider_id: pid,
//         reporting_option: mipsText,
//         source: 'Company CSV upload (MIPS_By_Year text)',
//       })
//     }
//   }
//   for (const part of chunk(mipsRows, CHUNK)) {
//     const { error } = await supabase.from('provider_mips').insert(part)
//     if (error) return { ok: false, message: `MIPS insert failed: ${error.message}` }
//   }

//   const rosterCount = toInsert.length - anchorCodes.length
//   return {
//     ok: true,
//     message: `Uploaded ${anchorCodes.length} lead(s)` +
//       (rosterCount ? ` + ${rosterCount} roster member(s)` : '') +
//       (skipped ? `, skipped ${skipped} duplicate(s)` : '') + '.',
//     inserted: anchorCodes.length,
//     skipped,
//   }
// }
'use server'

import { createSupabaseServer } from '../lib/supabase-server'
import { mapConcurrent } from '../lib/query-utils'

type CsvRow = Record<string, string>

const CHUNK = 500
const clean = (v: string | undefined) => (v ?? '').trim()
const yes = (v: string | undefined) => (v ?? '').trim().toLowerCase() === 'yes'

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function uploadLeadsCsv(
  rows: CsvRow[]
): Promise<{ ok: boolean; message: string; inserted?: number; skipped?: number }> {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id, roles(key)')
    .eq('auth_id', user.id)
    .single()

  const roleKey = (me as any)?.roles?.key ?? ''
  let tenantId = (me as any)?.tenant_id

  if (!['company_admin', 'manager', 'super_admin'].includes(roleKey)) {
    return { ok: false, message: 'Only a Company Admin, Manager, or Super Admin can upload leads.' }
  }

  if (roleKey === 'super_admin') {
    const { data: platform } = await supabase
      .from('tenants')
      .select('id')
      .eq('is_platform', true)
      .maybeSingle()
    if (!platform) return { ok: false, message: 'No Platform tenant found. Run migration 014.' }
    tenantId = (platform as any).id
  }

  if (!tenantId) return { ok: false, message: 'No company linked to your account.' }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, message: 'No rows found in the file.' }
  }

  const keyMap = new Map<string, string>()
  for (const k of Object.keys(rows[0])) keyMap.set(k.trim().toLowerCase(), k)
  const col = (row: CsvRow, name: string) => {
    const realKey = keyMap.get(name.toLowerCase())
    return realKey ? clean(row[realKey]) : ''
  }
  const npiKey = keyMap.get('npi')
  if (!npiKey) return { ok: false, message: 'CSV has no NPI column.' }

  const byCode = new Map<string, CsvRow>()
  for (const row of rows) {
    const npi = clean(row[npiKey])
    if (!npi) continue
    const code = `PR-${npi}`
    if (!byCode.has(code)) byCode.set(code, row)
  }
  const allCodes = Array.from(byCode.keys())

  const existingCodes = new Set<string>()
  for (const codes of chunk(allCodes, 800)) {
    const { data: existing } = await supabase
      .from('master_practices')
      .select('practice_code')
      .eq('owner_tenant_id', tenantId)
      .is('deleted_at', null)   // soft-deleted leads don't block a re-upload
      .in('practice_code', codes)
    for (const e of (existing ?? []) as any[]) existingCodes.add(e.practice_code)
  }

  const toInsertByCode = allCodes.filter((c) => !existingCodes.has(c))

  const npiByCode = new Map<string, string>()
  for (const code of toInsertByCode) {
    const npi = clean(byCode.get(code)![npiKey])
    if (npi) npiByCode.set(code, npi)
  }
  const incomingNpis = Array.from(new Set(npiByCode.values()))
  const existingNpis = new Set<string>()
  for (const part of chunk(incomingNpis, 300)) {
    const { data: existProv } = await supabase
      .from('providers')
      .select('npi')
      .eq('owner_tenant_id', tenantId)
      .in('npi', part)
    for (const p of (existProv ?? []) as any[]) existingNpis.add(p.npi)
  }

  const toInsert = toInsertByCode.filter((c) => {
    const npi = npiByCode.get(c)
    return npi ? !existingNpis.has(npi) : true
  })
  const skipped = allCodes.length - toInsert.length

  // Re-uploading a lead you already have is normally a no-op — except when
  // NPPES has since matched an NPI that previously had no match (or is
  // simply fresher data). That row now carries real enrichment data worth
  // keeping, so its descriptive fields are refreshed instead of the row
  // being silently discarded. Rows without a "Found" match (e.g. still
  // "NPPES - Not Found", which per the source data carries no other
  // populated fields anyway) are left alone, unchanged from before.
  // Ownership/structural fields — org_pac_id, is_anchor, owner_tenant_id,
  // num_org_members, pecos_asct_cntl_id, enrlmt_id — are deliberately NOT
  // touched here: this only refreshes descriptive data, it never
  // reclassifies or reassigns an existing lead.
  const isNppesFound = (row: CsvRow) => {
    const v = col(row, 'Record_Source').toLowerCase()
    return v.includes('found') && !v.includes('not found')
  }
  const toInsertSet = new Set(toInsert)
  const codesToEnrich = allCodes.filter((c) => !toInsertSet.has(c) && isNppesFound(byCode.get(c)!))

  let enrichedCount = 0
  let enrichError: string | null = null
  const notMatchedCodes: string[] = []
  if (codesToEnrich.length > 0) {
    await mapConcurrent(codesToEnrich, 4, async (code) => {
      if (enrichError) return // one failure is enough to report; stop piling on more work
      const row = byCode.get(code)!
      const npi = clean(row[npiKey])
      const enrichment: Record<string, string> = {
        name: col(row, 'NPPES_Name') || col(row, 'Name') || '',
        state: col(row, 'NPPES_PrimaryState') || col(row, 'NPPES_State') || col(row, 'State') || '',
        city: col(row, 'NPPES_PrimaryCity') || col(row, 'NPPES_City') || col(row, 'City') || '',
        postal: col(row, 'NPPES_PrimaryPostal') || col(row, 'NPPES_Postal') || col(row, 'Postal') || '',
        taxonomy_desc: col(row, 'NPPES_PrimaryTaxonomyDesc') || col(row, 'NPPES_Taxonomy_Desc') || col(row, 'Specialty') || '',
        phone: col(row, 'NPPES_PrimaryPhone') || col(row, 'NPPES_Phone') || col(row, 'Phone') || '',
        nppes_sex: col(row, 'NPPES_Sex') || '',
        nppes_last_updated: col(row, 'NPPES_LastUpdated') || '',
        payment_adj_pct: col(row, 'Payment_Adj_%') || col(row, 'Payment_Adj_Pct') || col(row, 'Payment Adjustment Percentage') || '',
        at_risk: col(row, 'At_Risk') || '',
        penalty: col(row, 'Panelty') || col(row, 'Penalty') || '',
        status: col(row, 'NPPES_Status') || '',
        taxonomy_code: col(row, 'NPPES_PrimaryTaxonomyCode') || '',
        mailing_phone: col(row, 'NPPES_MailingPhone') || col(row, 'NPPES_ContactPhone') || '',
        entity_type: col(row, 'NPPES_EnumerationType') || '',
        enumeration_date: col(row, 'NPPES_EnumerationDate') || '',
        record_source: col(row, 'Record_Source') || '',
      }
      // Only patch fields this row actually has a value for — a blank
      // cell in the enrichment file shouldn't blank out data the lead
      // already had.
      const providerPatch = Object.fromEntries(Object.entries(enrichment).filter(([, v]) => v !== ''))
      let providerMatched = true
      if (Object.keys(providerPatch).length > 0) {
        // .select() after .update() is required here — without it, Supabase
        // returns 204 success even when the WHERE clause matched zero rows,
        // which would silently count a no-op as "enriched".
        const { data, error } = await supabase.from('providers').update(providerPatch).eq('npi', npi).eq('owner_tenant_id', tenantId).select('id')
        if (error) { enrichError = `Enrichment update failed: ${error.message}`; return }
        providerMatched = (data ?? []).length > 0
      }
      // Kept in sync with master_practices too — the leads list reads
      // name/state/specialty directly from there, not from providers.
      // is_roster is unconditionally set to false here: every code in
      // codesToEnrich was already filtered to isNppesFound() rows only, so
      // reaching this point means NPPES confirmed a match — the explicit
      // request is that these always surface in the Lead Pool and under
      // the Credentialing filter, regardless of their prior roster status.
      const practicePatch: Record<string, string | boolean> = { is_roster: false }
      if (providerPatch.name) practicePatch.name = providerPatch.name as string
      if (providerPatch.state) practicePatch.state = providerPatch.state as string
      if (providerPatch.city) practicePatch.city = providerPatch.city as string
      if (providerPatch.postal) practicePatch.postal = providerPatch.postal as string
      if (providerPatch.taxonomy_desc) practicePatch.specialty = providerPatch.taxonomy_desc as string
      if (providerPatch.phone) practicePatch.phone = providerPatch.phone as string
      if (Object.keys(practicePatch).length > 0) {
        const { data, error } = await supabase.from('master_practices').update(practicePatch).eq('practice_code', code).eq('owner_tenant_id', tenantId).select('id')
        if (error) { enrichError = `Enrichment update failed: ${error.message}`; return }
        if ((data ?? []).length === 0) providerMatched = false
      }
      if (!providerMatched) { notMatchedCodes.push(code); return }
      enrichedCount++
    })
  }
  // A failed update was previously counted as "enriched" anyway, since
  // nothing checked whether these calls actually succeeded — that made the
  // reported count wrong without any visible error. Surface it instead.
  if (enrichError) return { ok: false, message: enrichError }

  if (toInsert.length === 0) {
    if (enrichedCount > 0 || notMatchedCodes.length > 0) {
      const untouched = skipped - enrichedCount - notMatchedCodes.length
      const parts: string[] = []
      if (enrichedCount > 0) parts.push(`Enriched ${enrichedCount} existing lead(s) with new NPPES data`)
      if (notMatchedCodes.length > 0) {
        parts.push(
          `${notMatchedCodes.length} lead(s) had "Found" data but no matching record under your company to update ` +
          `(e.g. ${notMatchedCodes.slice(0, 5).join(', ')}${notMatchedCodes.length > 5 ? ', …' : ''}) — ` +
          `they may be owned by a different company or the practice/provider link is out of sync`
        )
      }
      if (untouched > 0) parts.push(`${untouched} other duplicate(s) had no new match to add`)
      return { ok: true, message: parts.join('. ') + '.', inserted: 0, skipped }
    }
    return { ok: true, message: `Nothing new — all ${skipped} lead(s) already exist for your company.`, inserted: 0, skipped }
  }

  // Anchor detection: Source='uploaded' OR (PECOS + ENRLMT present) OR
  // NPPES has matched this NPI ("NPPES - Found") — a confirmed NPPES match
  // means this is a real, workable lead regardless of what the Source
  // column says (or whether it's present at all), so it always belongs in
  // the visible Lead Pool, not hidden as a roster member.
  const isAnchorRow = (code: string) => {
    const row = byCode.get(code)!
    if (isNppesFound(row)) return true
    const source = col(row, 'Source').toLowerCase()
    if (source === 'uploaded') return true
    if (source.startsWith('roster')) return false
    return !!(col(row, 'PECOS_ASCT_CNTL_ID') && col(row, 'ENRLMT_ID'))
  }

  const providerRows = toInsert.map((code) => {
    const row = byCode.get(code)!
    const npi = clean(row[npiKey])
    const numMembers = col(row, 'Num_Org_Members')
    const pecos = col(row, 'PECOS_ASCT_CNTL_ID') || null
    const enrlmt = col(row, 'ENRLMT_ID') || null
    return {
      npi,
      name: col(row, 'NPPES_Name') || col(row, 'Name') || `Practice (NPI ${npi})`,
      state: col(row, 'NPPES_PrimaryState') || col(row, 'NPPES_State') || col(row, 'State') || null,
      city: col(row, 'NPPES_PrimaryCity') || col(row, 'NPPES_City') || col(row, 'City') || null,
      postal: col(row, 'NPPES_PrimaryPostal') || col(row, 'NPPES_Postal') || col(row, 'Postal') || null,
      taxonomy_desc: col(row, 'NPPES_PrimaryTaxonomyDesc') || col(row, 'NPPES_Taxonomy_Desc') || col(row, 'Specialty') || null,
      phone: col(row, 'NPPES_PrimaryPhone') || col(row, 'NPPES_Phone') || col(row, 'Phone') || null,
      // Roster members are grouped by their ANCHOR's org (from the Source
      // column, e.g. "roster:4183160328"), NOT their own individual org_pac_id
      // — because a clinician's own org can differ from the anchor they belong
      // to, which would otherwise break the roster→anchor link. Anchors keep
      // their real Org_PAC_ID.
      org_pac_id: (() => {
        const src = col(row, 'Source').toLowerCase()
        if (src.startsWith('roster:')) return src.slice('roster:'.length).trim() || null
        return col(row, 'Org_PAC_ID') || null
      })(),
      org_name: col(row, 'Org_Name') || null,
      num_org_members: numMembers ? parseInt(numMembers, 10) || null : null,
      pecos_asct_cntl_id: pecos,
      enrlmt_id: enrlmt,
      nppes_sex: col(row, 'NPPES_Sex') || null,
      nppes_last_updated: col(row, 'NPPES_LastUpdated') || null,
      payment_adj_pct: col(row, 'Payment_Adj_%') || col(row, 'Payment_Adj_Pct') || col(row, 'Payment Adjustment Percentage') || null,
      at_risk: col(row, 'At_Risk') || null,
      penalty: col(row, 'Panelty') || col(row, 'Penalty') || null,
      status: col(row, 'NPPES_Status') || null,
      taxonomy_code: col(row, 'NPPES_PrimaryTaxonomyCode') || null,
      mailing_phone: col(row, 'NPPES_MailingPhone') || col(row, 'NPPES_ContactPhone') || null,
      entity_type: col(row, 'NPPES_EnumerationType') || null,
      enumeration_date: col(row, 'NPPES_EnumerationDate') || null,
      // Whether NPPES found a match for this NPI (e.g. "NPPES - Found" /
      // "NPPES - Not Found") — drives the new "NPI Found" category filter.
      record_source: col(row, 'Record_Source') || null,
      is_anchor: isAnchorRow(code),
      owner_tenant_id: tenantId,
    }
  })

  const providerIdByCode = new Map<string, string>()
  for (const part of chunk(providerRows, CHUNK)) {
    const { data, error } = await supabase.from('providers').insert(part).select('id, npi')
    if (error) return { ok: false, message: `Provider insert failed: ${error.message}` }
    for (const p of (data ?? []) as any[]) providerIdByCode.set(`PR-${p.npi}`, p.id)
  }

  const anchorCodes = toInsert.filter(isAnchorRow)

  // Practices for EVERY provider (anchors + roster). Roster rows flagged
  // is_roster=true so the main Lead Pool hides them; still openable via roster.
  const practiceRows = toInsert.map((code) => {
    const row = byCode.get(code)!
    return {
      practice_code: code,
      name: col(row, 'NPPES_Name') || col(row, 'Name') || `Practice (${code})`,
      state: col(row, 'NPPES_PrimaryState') || col(row, 'NPPES_State') || col(row, 'State') || null,
      city: col(row, 'NPPES_PrimaryCity') || col(row, 'NPPES_City') || col(row, 'City') || null,
      postal: col(row, 'NPPES_PrimaryPostal') || col(row, 'NPPES_Postal') || col(row, 'Postal') || null,
      specialty: col(row, 'NPPES_PrimaryTaxonomyDesc') || col(row, 'NPPES_Taxonomy_Desc') || col(row, 'Specialty') || null,
      phone: col(row, 'NPPES_PrimaryPhone') || col(row, 'NPPES_Phone') || col(row, 'Phone') || null,
      is_roster: !isAnchorRow(code),
      owner_tenant_id: tenantId,
    }
  })

  const practiceIdByCode = new Map<string, string>()
  for (const part of chunk(practiceRows, CHUNK)) {
    const { data, error } = await supabase.from('master_practices').insert(part).select('id, practice_code')
    if (error) return { ok: false, message: `Practice insert failed: ${error.message}` }
    for (const m of (data ?? []) as any[]) practiceIdByCode.set(m.practice_code, m.id)
  }

  const linkRows: any[] = []
  for (const code of toInsert) {
    const pid = providerIdByCode.get(code)
    const mid = practiceIdByCode.get(code)
    if (pid && mid) linkRows.push({ practice_id: mid, provider_id: pid, is_primary: true })
  }
  for (const part of chunk(linkRows, CHUNK)) {
    const { error } = await supabase.from('practice_providers').insert(part)
    if (error) return { ok: false, message: `Link insert failed: ${error.message}` }
  }

  const signalRows: any[] = []
  for (const code of toInsert) {
    const pid = providerIdByCode.get(code)
    if (!pid) continue
    const row = byCode.get(code)!
    signalRows.push({
      provider_id: pid,
      ccm: yes(col(row, 'CMS_CCM')),
      pcm: yes(col(row, 'CMS_PCM')),
      awv: yes(col(row, 'CMS_AWV')),
      tcm: yes(col(row, 'CMS_TCM')),
      bhi: yes(col(row, 'CMS_BHI')),
      rpm: yes(col(row, 'CMS_RPM')),
      rcm_fit: yes(col(row, 'CMS_RCM')),
      cms_category: col(row, 'CMS_Category') || null,
    })
  }
  for (const part of chunk(signalRows, CHUNK)) {
    const { error } = await supabase.from('provider_signals').insert(part)
    if (error) return { ok: false, message: `Signals insert failed: ${error.message}` }
  }

  const mipsRows: any[] = []
  for (const code of toInsert) {
    const pid = providerIdByCode.get(code)
    if (!pid) continue
    const row = byCode.get(code)!
    const mipsText = col(row, 'MIPS_By_Year')
    if (mipsText) {
      mipsRows.push({
        provider_id: pid,
        reporting_option: mipsText,
        source: 'Company CSV upload (MIPS_By_Year text)',
      })
    }
  }
  for (const part of chunk(mipsRows, CHUNK)) {
    const { error } = await supabase.from('provider_mips').insert(part)
    if (error) return { ok: false, message: `MIPS insert failed: ${error.message}` }
  }

  const rosterCount = toInsert.length - anchorCodes.length
  const plainSkipped = skipped - enrichedCount - notMatchedCodes.length
  return {
    ok: true,
    message: `Uploaded ${anchorCodes.length} lead(s)` +
      (rosterCount ? ` + ${rosterCount} roster member(s)` : '') +
      (enrichedCount ? `, enriched ${enrichedCount} existing lead(s) with new NPPES data` : '') +
      (notMatchedCodes.length ? `, ${notMatchedCodes.length} had "Found" data but no matching record to update` : '') +
      (plainSkipped ? `, skipped ${plainSkipped} duplicate(s)` : '') + '.',
    inserted: anchorCodes.length,
    skipped,
  }
}