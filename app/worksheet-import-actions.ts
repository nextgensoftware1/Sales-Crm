'use server'

import { createSupabaseServer, getCurrentProfile, getCurrentUser } from '../lib/supabase-server'
import { normalizeWorksheetImportRows } from '../lib/worksheet-import'
import type { CsvRow } from '../lib/csv'

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
