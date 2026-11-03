'use server'

import { createSupabaseServer, getCurrentProfile, getCurrentUser } from '../lib/supabase-server'
import { normalizeWorksheetImportRows } from '../lib/worksheet-import'
import type { CsvRow } from '../lib/csv'
import { revalidatePath } from 'next/cache'
import { readAgentWorksheetCsv, isFullWorksheetFormat, type SkippedRow } from '../lib/agent-worksheet-import' // ← ADDED
import { removeLeadsFromSnapshots } from '../lib/lead-snapshots' // ← ADDED
import { roleLabel } from '../lib/roles' // ← ADDED

export type WorksheetImportResult = { ok: boolean; message: string; imported?: number; errors?: string[] }

export async function importWorksheetCsv(filename: string, sourceRows: CsvRow[]): Promise<WorksheetImportResult> {
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }
  const { data: me } = await getCurrentProfile(user.id)
  if (me?.roles?.key !== 'super_admin') return { ok: false, message: 'Only a Super Admin can import worksheet files.' }
  if (!Array.isArray(sourceRows) || sourceRows.length > 2000) return { ok: false, message: 'Upload must contain between 1 and 2,000 rows.' }
  const normalized = normalizeWorksheetImportRows(sourceRows)
  if (normalized.errors.length) return { ok: false, message: 'The file was not imported. Fix the validation errors and try again.', errors: normalized.errors.slice(0, 100) }
  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.rpc('import_worksheet_csv', {
    p_filename: filename.trim().slice(0, 255) || 'worksheet.csv', p_rows: normalized.rows,
  })
  if (error) {
    const missingRpc = error.code === 'PGRST202' || /Could not find the function public\.import_worksheet_csv/i.test(error.message)
    return { ok: false, message: missingRpc
      ? 'Worksheet import is not installed in this database. Run database/worksheet-csv-import.sql in the Supabase SQL Editor, then retry.'
      : `Import failed: ${error.message}` }
  }
  const result = data as { ok?: boolean; imported?: number; errors?: string[]; message?: string } | null
  if (!result?.ok) return { ok: false, message: result?.message ?? 'The file was not imported.', errors: result?.errors ?? [] }
  return { ok: true, imported: result.imported ?? normalized.rows.length, message: `Imported ${result.imported ?? normalized.rows.length} worksheet row(s).` }
}

export async function updateImportedWorksheet(
  tenantId: string,
  practiceId: string,
  fields: Record<string, string>,
): Promise<{ ok: boolean; message: string }> {
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }
  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = me?.roles?.key ?? ''
  if (!me || !['super_admin', 'company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(roleKey)) {
    return { ok: false, message: 'You do not have permission to edit this worksheet.' }
  }
  if (!tenantId || !practiceId || !fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return { ok: false, message: 'Invalid worksheet data.' }
  }
  const entries = Object.entries(fields)
  if (!entries.length || entries.length > 200 || entries.some(([key, value]) =>
    !key.trim() || key.length > 200 || typeof value !== 'string' || value.length > 20000)) {
    return { ok: false, message: 'One or more worksheet fields are invalid or too long.' }
  }

  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.rpc('update_imported_worksheet', {
    p_tenant_id: tenantId,
    p_practice_id: practiceId,
    p_import_data: Object.fromEntries(entries.map(([key, value]) => [key, value.trim()])),
  })
  if (error) {
    const missingRpc = error.code === 'PGRST202' || /Could not find the function public\.update_imported_worksheet/i.test(error.message)
    return { ok: false, message: missingRpc
      ? 'Worksheet editing is not installed in this database. Run database/worksheet-import-edit.sql in the Supabase SQL Editor, then try again.'
      : `Save failed: ${error.message}` }
  }
  const result = data as { ok?: boolean; message?: string } | null
  if (!result?.ok) return { ok: false, message: result?.message ?? 'Worksheet could not be saved.' }
  revalidatePath('/worksheet-reports')
  revalidatePath(`/worksheet-reports/${tenantId}/${practiceId}`)
  return { ok: true, message: result.message ?? 'Worksheet saved.' }
}

// ---------------------------------------------------------------------------
// ← ADDED: upload ONE agent's call work (NPI, Disposition / Response,
// Call details * / Note). Company and agent are chosen on the upload screen.
// Good rows are saved as that agent's call worksheets (they show on Active
// Call under the agent); rows with a problem are skipped and listed.
// ---------------------------------------------------------------------------

export type ImportAgentOption = { id: string; name: string; role: string }

async function requireSuperAdmin() {
  const { data: { user } } = await getCurrentUser()
  if (!user) return null
  const { data: me } = await getCurrentProfile(user.id)
  return me?.roles?.key === 'super_admin' ? me : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Active people of one company, for the "Agent" dropdown. */
export async function getImportAgents(tenantId: string): Promise<{ ok: boolean; message?: string; agents?: ImportAgentOption[] }> {
  if (!(await requireSuperAdmin())) return { ok: false, message: 'Only a Super Admin can import worksheet files.' }
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) return { ok: false, message: 'Choose a company.' }
  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.from('users')
    .select('id, full_name, roles(key)')
    .eq('tenant_id', tenantId).eq('status', 'active').order('full_name')
  if (error) return { ok: false, message: error.message }
  const agents = ((data ?? []) as unknown as { id: string; full_name: string | null; roles: { key: string } | null }[])
    .filter((u) => u.roles?.key !== 'super_admin')
    .map((u) => ({ id: u.id, name: u.full_name || 'Unnamed user', role: roleLabel(u.roles?.key) }))
  return { ok: true, agents }
}

export type AgentImportResult = {
  ok: boolean
  message: string
  /** The file has Company Name + Agent Name columns → use the full importer. */
  fullFormat?: boolean
  imported?: number
  skipped?: SkippedRow[]
}

export async function importAgentWorksheetCsv(filename: string, tenantId: string, agentId: string, sourceRows: CsvRow[]): Promise<AgentImportResult> {
  if (!(await requireSuperAdmin())) return { ok: false, message: 'Only a Super Admin can import worksheet files.' }
  if (!Array.isArray(sourceRows) || !sourceRows.length) return { ok: false, message: 'No data rows were found in the file.' }
  if (sourceRows.length > 2000) return { ok: false, message: 'Upload up to 2,000 rows at a time.' }
  if (isFullWorksheetFormat(sourceRows)) return { ok: false, fullFormat: true, message: 'This file has Company Name and Agent Name columns.' }
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) return { ok: false, message: 'Choose the company.' }
  if (typeof agentId !== 'string' || !UUID_RE.test(agentId)) return { ok: false, message: 'Choose the agent who did this work.' }

  const read = readAgentWorksheetCsv(sourceRows)
  if (!read.ok) return { ok: false, message: read.message ?? 'The file could not be read.' }
  if (!read.rows.length) {
    return { ok: false, imported: 0, skipped: read.skipped, message: `Nothing was imported — all ${read.skipped.length} row(s) had a problem.` }
  }

  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.rpc('import_agent_worksheets', {
    p_filename: (filename || '').trim().slice(0, 255) || 'agent-worksheets.csv',
    p_tenant_id: tenantId,
    p_agent_id: agentId,
    p_rows: read.rows,
  })
  if (error) {
    const missingRpc = error.code === 'PGRST202' || /Could not find the function public\.import_agent_worksheets/i.test(error.message)
    return { ok: false, skipped: read.skipped, message: missingRpc
      ? 'Agent worksheet import is not installed in this database. Run database/agent-worksheet-import.sql in the Supabase SQL Editor, then retry.'
      : `Import failed: ${error.message}` }
  }
  const result = data as { ok?: boolean; imported?: number; skipped?: SkippedRow[]; npis?: string[]; agent_auth_id?: string | null } | null
  const skipped = [...read.skipped, ...(result?.skipped ?? [])].sort((a, b) => a.row - b.row)
  const imported = result?.imported ?? 0

  // The agent's cached lead list (server memory) drops the imported leads at
  // once, like after a normal save — no database reload needed.
  if (result?.agent_auth_id && result.npis?.length) {
    removeLeadsFromSnapshots(result.agent_auth_id, result.npis.map((npi) => `PR-${npi}`))
  }
  revalidatePath('/worksheet-reports')
  const skippedText = skipped.length ? ` ${skipped.length} row(s) skipped — see the list.` : ''
  return { ok: imported > 0, imported, skipped,
    message: imported > 0 ? `Imported ${imported} lead(s) to Active Call.${skippedText}` : `Nothing was imported.${skippedText}` }
}
