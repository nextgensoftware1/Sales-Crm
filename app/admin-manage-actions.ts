'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { createSupabaseAdmin } from '../lib/supabase-admin'
import { roleLabel } from '../lib/roles'

// Roles allowed to manage/create other users at all. Agent and Closer are
// intentionally excluded — they're the bottom of the hierarchy and never
// create anyone.
const MANAGER_ROLES = ['super_admin', 'company_admin', 'manager', 'team_lead']

async function whoAmI() {
  const { data: { user } } = await getCurrentUser()
  if (!user) return null
  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return null
  return {
    id: (me as any).id as string,
    tenantId: (me as any).tenant_id as string | null,
    roleKey: ((me as any).roles?.key ?? '') as string,
    // Lower level = more senior — matches how the rest of the app already
    // sorts by level (e.g. Admin page's "Users by Company" list).
    level: ((me as any).roles?.level ?? 999) as number,
  }
}

// Turns "Acme Medical Sales" into "acme-medical-sales" — matches the slug
// format already used to look companies up elsewhere (allocatePractices,
// the company dropdown in PracticesTable).
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Super Admin only. Creates a new company (tenant) so it can then have its
// own Company Admin and team created within it.
export async function createCompany(name: string): Promise<{ ok: boolean; message?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, message: 'Company name is required.' }
  const baseSlug = slugify(trimmed)
  if (!baseSlug) return { ok: false, message: 'Company name must include at least one letter or number.' }

  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (me.roleKey !== 'super_admin') return { ok: false, message: 'Only Super Admin can add a company.' }

  // Try the plain slug first, then a couple of numbered variants if it's
  // already taken (e.g. two companies both named "Acme").
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`
    const { error } = await supabase.from('tenants').insert({ name: trimmed, slug, is_platform: false, status: 'active' })
    if (!error) return { ok: true }
    const msg = error.message.toLowerCase()
    if (msg.includes('duplicate') || msg.includes('unique')) {
      if (msg.includes('name')) return { ok: false, message: `A company named "${trimmed}" already exists.` }
      continue // slug collision — try the next numbered variant
    }
    return { ok: false, message: error.message }
  }
  return { ok: false, message: 'Could not generate a unique identifier for this company name. Try a slightly different name.' }
}

export type AssignableRole = { key: string; label: string }

// Roles the caller is allowed to hand out — strictly junior to their own
// role, using the real level values already in the roles table. This means
// the rule adapts automatically to however levels are actually configured,
// rather than a hardcoded list of role names:
//   Super Admin   → everyone (including another Super Admin or Company Admin)
//   Company Admin → Manager, Team Lead, Agent, Closer (not another Company Admin)
//   Manager       → Team Lead, Agent, Closer
//   Team Lead     → Agent, Closer
//   Agent/Closer  → nobody (not a manager role at all)
export async function getAssignableRoles(): Promise<{ ok: boolean; roles?: AssignableRole[]; message?: string }> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (!MANAGER_ROLES.includes(me.roleKey)) return { ok: false, message: 'Not allowed.' }

  const { data: roles } = await supabase.from('roles').select('key, label, level').order('level')
  const all = (roles ?? []) as (AssignableRole & { level: number })[]

  // Nobody can create another Super Admin through this form, including
  // Super Admin itself — there is exactly one, and it stays that way.
  // Everyone else can only grant roles strictly junior to their own.
  const assignable = (me.roleKey === 'super_admin' ? all : all.filter((r) => r.level > me.level))
    .filter((r) => r.key !== 'super_admin')
  return { ok: true, roles: assignable.map((r) => ({ key: r.key, label: roleLabel(r.key) })) }
}

export type CompanyOption = { id: string; name: string }

// Only Super Admin adds a user to an arbitrary company — everyone else
// (Company Admin, Manager, Team Lead) only ever adds to their own, so no
// picker is needed for them.
export async function getCompaniesForUserCreation(): Promise<{ ok: boolean; companies?: CompanyOption[]; message?: string }> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (me.roleKey !== 'super_admin') return { ok: false, message: 'Not allowed.' }

  const { data: tenants } = await supabase.from('tenants').select('id, name').eq('is_platform', false).order('name')
  return { ok: true, companies: (tenants ?? []) as CompanyOption[] }
}

// Creates a real, login-capable user: an actual Supabase Auth account plus
// the matching row in public.users. Requires SUPABASE_SERVICE_ROLE_KEY to be
// set in the server environment (see lib/supabase-admin.ts) — without it,
// this fails with a clear message rather than a silent no-op.
export async function createUser(input: {
  email: string
  fullName: string
  roleKey: string
  tenantId?: string // Super Admin only — everyone else's own tenant is used automatically
  temporaryPassword: string
}): Promise<{ ok: boolean; message?: string }> {
  const email = input.email.trim().toLowerCase()
  const fullName = input.fullName.trim()
  if (!email) return { ok: false, message: 'Email is required.' }
  if (!fullName) return { ok: false, message: 'Full name is required.' }
  if (!input.temporaryPassword || input.temporaryPassword.length < 8) {
    return { ok: false, message: 'Temporary password must be at least 8 characters.' }
  }

  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (!MANAGER_ROLES.includes(me.roleKey)) return { ok: false, message: 'Not allowed.' }

  const isSuperAdmin = me.roleKey === 'super_admin'

  // Re-verify server-side that the requested role is actually junior to the
  // caller — never trust the role the client sent, even though the form
  // only offers junior roles to begin with. This is the real enforcement
  // point; the UI filtering is just a convenience on top of it.
  if (input.roleKey === 'super_admin') {
    return { ok: false, message: 'A new Super Admin cannot be created — there is exactly one, and it stays that way.' }
  }
  const { data: targetRole } = await supabase.from('roles').select('id, level').eq('key', input.roleKey).maybeSingle()
  if (!targetRole) return { ok: false, message: `Unknown role "${input.roleKey}".` }
  if (!isSuperAdmin && (targetRole as any).level <= me.level) {
    return { ok: false, message: 'You can only create roles junior to your own.' }
  }

  // Everyone except Super Admin can only ever staff their own company.
  const targetTenantId = isSuperAdmin ? (input.tenantId ?? null) : me.tenantId
  if (!targetTenantId) return { ok: false, message: 'A company is required.' }

  let admin
  try {
    admin = createSupabaseAdmin()
  } catch (e: any) {
    return { ok: false, message: e?.message ?? 'Admin client is not configured.' }
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: input.temporaryPassword,
    email_confirm: true,
  })
  if (createErr || !created?.user) {
    return { ok: false, message: createErr?.message ?? 'Could not create the login.' }
  }

  const { error: insertErr } = await supabase.from('users').insert({
    auth_id: created.user.id,
    email,
    full_name: fullName,
    tenant_id: targetTenantId,
    role_id: (targetRole as any).id,
    status: 'active',
  })
  if (insertErr) {
    // Roll back the auth account so we don't leave an orphaned login with no matching profile.
    await admin.auth.admin.deleteUser(created.user.id)
    return { ok: false, message: insertErr.message }
  }

  return { ok: true }
}

// ---- Company lifecycle: suspend / reactivate / delete (Super Admin only) ----

async function requireSuperAdmin() {
  const me = await whoAmI()
  if (!me) return { ok: false as const, message: 'Not signed in.' }
  if (me.roleKey !== 'super_admin') return { ok: false as const, message: 'Only Super Admin can manage companies.' }
  return { ok: true as const, me }
}

// Temporarily suspends a company and every user in it — reversible via
// reactivateCompany. Individual users aren't tracked separately here, so
// reactivating restores everyone in the company to active, including
// anyone who happened to already be inactive for an unrelated reason.
export async function suspendCompany(tenantId: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createSupabaseServer()
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth

  const { data: tenant } = await supabase.from('tenants').select('is_platform').eq('id', tenantId).maybeSingle()
  if (!tenant) return { ok: false, message: 'Company not found.' }
  if ((tenant as any).is_platform) return { ok: false, message: 'The Platform company cannot be suspended.' }

  const { error: tenantErr } = await supabase.from('tenants').update({ status: 'suspended' }).eq('id', tenantId)
  if (tenantErr) return { ok: false, message: tenantErr.message }

  const { error: usersErr } = await supabase.from('users').update({ status: 'suspended' }).eq('tenant_id', tenantId)
  if (usersErr) return { ok: false, message: `Company suspended, but updating its team failed: ${usersErr.message}` }

  return { ok: true }
}

export async function reactivateCompany(tenantId: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createSupabaseServer()
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth

  const { error: tenantErr } = await supabase.from('tenants').update({ status: 'active' }).eq('id', tenantId)
  if (tenantErr) return { ok: false, message: tenantErr.message }

  const { error: usersErr } = await supabase.from('users').update({ status: 'active' }).eq('tenant_id', tenantId)
  if (usersErr) return { ok: false, message: `Company reactivated, but restoring its team failed: ${usersErr.message}` }

  return { ok: true }
}

// Uses existing APIs; no custom SQL function is required. Requests are not atomic.
export async function deleteCompany(tenantId: string): Promise<{ ok: boolean; message?: string }> {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth
  if (!tenantId) return { ok: false, message: 'Company is required.' }

  let removedUsers = 0
  let deletedLogins = 0
  const failed = (message: string) => ({ ok: false, message: message +
    (removedUsers || deletedLogins
      ? ' Deletion is incomplete: ' + removedUsers + ' user profiles and ' + deletedLogins + ' logins were removed. Refresh and retry after resolving the error.'
      : ' Nothing was deleted.') })
  try {
    const admin = createSupabaseAdmin()
    const { data: tenant, error: tenantError } = await admin.from('tenants')
      .select('id, is_platform').eq('id', tenantId).maybeSingle()
    if (tenantError) return failed(tenantError.message)
    if (!tenant) return failed('Company not found.')
    if (tenant.is_platform !== false) return failed('The Platform company cannot be deleted.')
    if (auth.me.tenantId === tenantId) return failed('You cannot delete your own company.')

    type Member = { id: string; auth_id: string | null; roles: { key: string } | null }
    const members: Member[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from('users').select('id, auth_id, roles(key)')
        .eq('tenant_id', tenantId).order('id').range(offset, offset + 999)
        .overrideTypes<Member[], { merge: false }>()
      if (error) return failed(error.message)
      members.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    if (members.some(member => member.id === auth.me.id || member.roles?.key === 'super_admin')) {
      return failed('A company containing a Super Admin cannot be deleted.')
    }
    // Never delete a login used by another profile (including another company).
    for (const member of members) {
      if (!member.auth_id) continue
      const { data, error } = await admin.from('users').select('id')
        .eq('auth_id', member.auth_id).neq('id', member.id).limit(1)
      if (error) return failed(error.message)
      if (data?.length) return failed('A company user shares a login with another profile.')
    }
    for (const member of members) {
      // Recheck membership before using the privileged Auth API.
      const { data: current, error: readError } = await admin.from('users')
        .select('tenant_id, auth_id, roles(key)').eq('id', member.id).maybeSingle()
        .overrideTypes<{ tenant_id: string | null; auth_id: string | null; roles: { key: string } | null } | null, { merge: false }>()
      if (readError) return failed(readError.message)
      if (!current) continue
      if (current.tenant_id !== tenantId || current.auth_id !== member.auth_id || current.roles?.key === 'super_admin') {
        return failed('Company membership changed during deletion. Please retry.')
      }
      // Login first: if Auth fails, the profile remains available for a retry.
      // Auth deletion may also cascade to the profile; the scoped delete is safe then.
      if (member.auth_id) {
        const { error } = await admin.auth.admin.deleteUser(member.auth_id)
        if (error && error.code !== 'user_not_found') return failed('Could not remove a user login: ' + error.message)
        if (!error) deletedLogins++
      }
      const { error } = await admin.from('users').delete().eq('id', member.id).eq('tenant_id', tenantId)
      if (error) return failed('Could not remove a user profile: ' + error.message)
      removedUsers++
    }
    // Check for users added while the deletion was running.
    const { count, error: countError } = await admin.from('users')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    if (countError) return failed(countError.message)
    if (count !== 0) return failed('Company users remain or were added during deletion. Please retry.')
    const { error } = await admin.from('tenants').delete().eq('id', tenantId).eq('is_platform', false)
    if (error) return failed('Could not remove the company: ' + error.message)
    return { ok: true }
  } catch {
    return { ok: false, message: 'Could not confirm company deletion. Some requests may have completed. Check the server admin key and connection, then refresh to verify the current state before retrying.' }
  }
}

export type CompanyStatusInfo = { id: string; userCount: number }

// Real counts to warn the caller with before they delete — not a guess.
export async function getCompanyDeletionImpact(tenantId: string): Promise<{ ok: boolean; userCount?: number; message?: string }> {
  const supabase = await createSupabaseServer()
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth

  const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  if (error) return { ok: false, message: 'Could not check company users. Please retry.' }
  return { ok: true, userCount: count ?? 0 }
}
