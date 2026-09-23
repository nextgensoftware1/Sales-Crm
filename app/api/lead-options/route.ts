import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../../lib/supabase-server'
import { roleLabel } from '../../../lib/roles'

export async function GET() {
  const respond = (body: unknown, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  })
  const { data: { user } } = await getCurrentUser()
  if (!user) return respond({ message: 'Not signed in.' }, 401)
  const { data: me } = await getCurrentProfile(user.id)
  const role = me?.roles?.key
  if (!me || !role || !['super_admin', 'company_admin', 'manager', 'team_lead'].includes(role)) {
    return respond({ message: 'Not allowed.' }, 403)
  }
  const db = await createSupabaseServer()
  if (role === 'super_admin') {
    const { data, error } = await db.from('tenants').select('slug, name').eq('is_platform', false).order('name')
    return error ? respond({ message: 'Could not load companies. Please retry.' }, 503)
      : respond({ companies: data ?? [], agents: [] })
  }
  if (!me.tenant_id) return respond({ message: 'No company assigned.' }, 403)
  const { data, error } = await db.from('users').select('id, full_name, roles(key, level)')
    .eq('tenant_id', me.tenant_id).order('full_name')
  if (error) return respond({ message: 'Could not load team members. Please retry.' }, 503)
  const people = data as unknown as { id: string; full_name: string; roles: { key: string; level: number } | null }[] | null
  return respond({ companies: [], agents: (people ?? [])
    .filter(person => (person.roles?.level ?? 0) > (me.roles?.level ?? 999))
    .map(person => ({ id: person.id, full_name: person.full_name, role: roleLabel(person.roles?.key) })) })
}
