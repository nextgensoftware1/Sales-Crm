'use server'

import { createSupabaseServer, getCurrentProfile, getCurrentUser } from '../lib/supabase-server'

export type WorksheetFieldChange = { before: string; after: string }
export type WorksheetUpdateRow = {
  id: string
  practiceId: string | null
  practiceCode: string | null
  practiceName: string
  tenantId: string | null
  companyName: string
  editedBy: string
  changedFields: Record<string, WorksheetFieldChange>
  createdAt: string
}

export type WorksheetUpdatesResult =
  | { ok: true; rows: WorksheetUpdateRow[]; scope: 'all' | 'company'; truncated: boolean }
  | { ok: false; message: string }

type AuditRow = {
  id: string
  practice_id: string | null
  tenant_id: string | null
  edited_by: string | null
  changed_fields: Record<string, { before?: unknown; after?: unknown }>
  created_at: string
}

const UPDATE_LIMIT = 500

export async function getWorksheetUpdates(): Promise<WorksheetUpdatesResult> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }
  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found.' }
  const roleKey = me.roles?.key ?? ''
  if (!['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)) {
    return { ok: false, message: 'Only administrative roles can review worksheet updates.' }
  }
  if (roleKey !== 'super_admin' && !me.tenant_id) {
    return { ok: false, message: 'Your account is not assigned to a company.' }
  }

  let query = supabase.from('worksheet_import_updates')
    .select('id, practice_id, tenant_id, edited_by, changed_fields, created_at')
    .order('created_at', { ascending: false })
    .limit(UPDATE_LIMIT + 1)
  if (roleKey !== 'super_admin') query = query.eq('tenant_id', me.tenant_id!)

  const { data, error } = await query
  if (error) {
    const missingTable = error.code === '42P01' || /worksheet_import_updates/i.test(error.message) && /does not exist|schema cache/i.test(error.message)
    return { ok: false, message: missingTable
      ? 'Worksheet update history is not installed. Run database/worksheet-import-edit.sql in Supabase SQL Editor.'
      : `Could not load worksheet updates: ${error.message}` }
  }

  const all = (data ?? []) as unknown as AuditRow[]
  const truncated = all.length > UPDATE_LIMIT
  const audits = truncated ? all.slice(0, UPDATE_LIMIT) : all
  const practiceIds = [...new Set(audits.map(row => row.practice_id).filter((id): id is string => Boolean(id)))]
  const tenantIds = [...new Set(audits.map(row => row.tenant_id).filter((id): id is string => Boolean(id)))]
  const userIds = [...new Set(audits.map(row => row.edited_by).filter((id): id is string => Boolean(id)))]
  const [practicesResult, tenantsResult, usersResult] = await Promise.all([
    practiceIds.length ? supabase.from('master_practices').select('id, practice_code, name').in('id', practiceIds) : Promise.resolve({ data: [] }),
    tenantIds.length ? supabase.from('tenants').select('id, name').in('id', tenantIds) : Promise.resolve({ data: [] }),
    userIds.length ? supabase.from('users').select('id, full_name').in('id', userIds) : Promise.resolve({ data: [] }),
  ])
  const practiceById = new Map((practicesResult.data ?? []).map(row => [row.id, row]))
  const tenantById = new Map((tenantsResult.data ?? []).map(row => [row.id, row.name]))
  const userById = new Map((usersResult.data ?? []).map(row => [row.id, row.full_name]))

  const rows: WorksheetUpdateRow[] = audits.map(audit => {
    const practice = audit.practice_id ? practiceById.get(audit.practice_id) : undefined
    const changes = Object.fromEntries(Object.entries(audit.changed_fields ?? {}).map(([field, change]) => [field, {
      before: String(change?.before ?? ''), after: String(change?.after ?? ''),
    }]))
    return {
      id: audit.id,
      practiceId: audit.practice_id,
      practiceCode: practice?.practice_code ?? null,
      practiceName: practice?.name ?? 'Deleted or unavailable lead',
      tenantId: audit.tenant_id,
      companyName: audit.tenant_id ? tenantById.get(audit.tenant_id) ?? 'Unknown company' : 'Deleted company',
      editedBy: audit.edited_by ? userById.get(audit.edited_by) ?? 'Deleted user' : 'Deleted user',
      changedFields: changes,
      createdAt: audit.created_at,
    }
  })
  return { ok: true, rows, scope: roleKey === 'super_admin' ? 'all' : 'company', truncated }
}
