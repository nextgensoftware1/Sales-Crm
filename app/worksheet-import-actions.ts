'use server'

import { createSupabaseServer, getCurrentProfile, getCurrentUser } from '../lib/supabase-server'
import { normalizeWorksheetImportRows } from '../lib/worksheet-import'
import type { CsvRow } from '../lib/csv'
import { revalidatePath } from 'next/cache'

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
