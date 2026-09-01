'use server'

import { createSupabaseServer } from '../lib/supabase-server'

// ---------------------------------------------------------------------------
// uploadLeadsCsv(rows) — BATCHED version for large files (1000s of rows).
//
// Instead of 5 DB calls per row, this does a handful of bulk inserts:
//   1. bulk-insert providers          (tagged owner_tenant_id)
//   2. bulk-insert master_practices   (tagged owner_tenant_id)
//   3. bulk-insert practice_providers links
//   4. bulk-insert provider_signals
//   5. bulk-insert provider_mips
// Everything is chunked at CHUNK rows per call. Duplicates (by practice_code
// within this company) are skipped up front. Only Company Admin + Manager.
// ---------------------------------------------------------------------------

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
  const tenantId = (me as any)?.tenant_id
  if (!tenantId) return { ok: false, message: 'No company linked to your account.' }
  if (roleKey !== 'company_admin' && roleKey !== 'manager') {
    return { ok: false, message: 'Only a Company Admin or Manager can upload leads.' }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, message: 'No rows found in the file.' }
  }

  // tolerant column reader
  const keyMap = new Map<string, string>()
  for (const k of Object.keys(rows[0])) keyMap.set(k.trim().toLowerCase(), k)
  const col = (row: CsvRow, name: string) => {
    const realKey = keyMap.get(name.toLowerCase())
    return realKey ? clean(row[realKey]) : ''
  }
  const npiKey = keyMap.get('npi')
  if (!npiKey) return { ok: false, message: 'CSV has no NPI column.' }

  // --- de-dupe within the file, and against what this company already owns ---
  const byCode = new Map<string, CsvRow>()
  for (const row of rows) {
    const npi = clean(row[npiKey])
    if (!npi) continue
    const code = `PR-${npi}`
    if (!byCode.has(code)) byCode.set(code, row) // first wins
  }
  const allCodes = Array.from(byCode.keys())

  const existingCodes = new Set<string>()
  for (const codes of chunk(allCodes, 800)) {
    const { data: existing } = await supabase
      .from('master_practices')
      .select('practice_code')
      .eq('owner_tenant_id', tenantId)
      .in('practice_code', codes)
    for (const e of (existing ?? []) as any[]) existingCodes.add(e.practice_code)
  }

  const toInsert = allCodes.filter((c) => !existingCodes.has(c))
  const skipped = allCodes.length - toInsert.length
  if (toInsert.length === 0) {
    return { ok: true, message: `Nothing new — all ${skipped} lead(s) already exist for your company.`, inserted: 0, skipped }
  }

  // 1) PROVIDERS ---------------------------------------------------------------
  const providerRows = toInsert.map((code) => {
    const row = byCode.get(code)!
    const npi = clean(row[npiKey])
    return {
      npi,
      name: col(row, 'NPPES_Name') || col(row, 'Name') || `Practice (NPI ${npi})`,
      state: col(row, 'NPPES_State') || col(row, 'State') || null,
      city: col(row, 'NPPES_City') || col(row, 'City') || null,
      postal: col(row, 'NPPES_Postal') || col(row, 'Postal') || null,
      taxonomy_desc: col(row, 'NPPES_Taxonomy_Desc') || col(row, 'Specialty') || col(row, 'Taxonomy') || null,
      phone: col(row, 'NPPES_Phone') || col(row, 'Phone') || null,
      owner_tenant_id: tenantId,
    }
  })

  // code -> provider id (filled as we insert)
  const providerIdByCode = new Map<string, string>()
  for (const part of chunk(providerRows, CHUNK)) {
    const { data, error } = await supabase.from('providers').insert(part).select('id, npi')
    if (error) return { ok: false, message: `Provider insert failed: ${error.message}` }
    for (const p of (data ?? []) as any[]) providerIdByCode.set(`PR-${p.npi}`, p.id)
  }

  // 2) MASTER PRACTICES --------------------------------------------------------
  const practiceRows = toInsert.map((code) => {
    const row = byCode.get(code)!
    return {
      practice_code: code,
      name: col(row, 'NPPES_Name') || col(row, 'Name') || `Practice (${code})`,
      state: col(row, 'NPPES_State') || col(row, 'State') || null,
      city: col(row, 'NPPES_City') || col(row, 'City') || null,
      postal: col(row, 'NPPES_Postal') || col(row, 'Postal') || null,
      specialty: col(row, 'NPPES_Taxonomy_Desc') || col(row, 'Specialty') || col(row, 'Taxonomy') || null,
      phone: col(row, 'NPPES_Phone') || col(row, 'Phone') || null,
      owner_tenant_id: tenantId,
    }
  })

  const practiceIdByCode = new Map<string, string>()
  for (const part of chunk(practiceRows, CHUNK)) {
    const { data, error } = await supabase.from('master_practices').insert(part).select('id, practice_code')
    if (error) return { ok: false, message: `Practice insert failed: ${error.message}` }
    for (const m of (data ?? []) as any[]) practiceIdByCode.set(m.practice_code, m.id)
  }

  // 3) LINKS -------------------------------------------------------------------
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

  // 4) SIGNALS -----------------------------------------------------------------
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

  // 5) MIPS --------------------------------------------------------------------
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

  return {
    ok: true,
    message: `Uploaded ${toInsert.length} lead(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ''}.`,
    inserted: toInsert.length,
    skipped,
  }
}