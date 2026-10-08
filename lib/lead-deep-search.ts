// Deep search for the Leads page search box: finds leads by details that are
// not part of the lead list rows — phone numbers (lead, provider, mailing,
// worksheet direct line / additional phone), email, city, ZIP and the
// worksheet's contact person.
//
// No database changes: plain, read-only queries through the signed-in user's
// own Supabase client, so Row Level Security applies as usual. Each lookup is
// independent — if one column doesn't exist in a given database, only that
// lookup is skipped. The caller keeps only codes that are already in the
// user's own lead list, so this can never add leads they can't see.

type Db = { from: (table: string) => any }
type Row = { practice_code?: string | null; master_practices?: { practice_code?: string | null } | null }

const MAX_MATCHES_PER_LOOKUP = 2000

/** Escape LIKE wildcards in what the user typed. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Phone numbers are stored in many formats ("(555) 123-4567", "555.123.4567",
 * "5551234567"). Putting a wildcard between the typed digits matches all of
 * them: "5551234567" -> "%5%5%5%1%2%3%4%5%6%7%".
 */
export function phonePattern(text: string): string | null {
  const digits = text.replace(/\D/g, '')
  if (digits.length < 4 || /[a-z@]/i.test(text)) return null
  return `%${digits.split('').join('%')}%`
}

export function textPattern(text: string): string | null {
  const t = text.trim()
  if (t.length < 3 || !/[a-z@]/i.test(t)) return null
  return `%${escapeLike(t)}%`
}

export async function deepSearchLeadCodes(
  db: Db,
  term: string,
  { tenantId, isSuperAdmin }: { tenantId: string | null; isSuperAdmin: boolean },
): Promise<Set<string>> {
  const phone = phonePattern(term)
  const text = textPattern(term)
  const digits = term.replace(/\D/g, '')
  if (!phone && !text) return new Set()

  // Worksheet details are company data: only search your own company's
  // worksheets (Super Admin: all companies).
  const worksheets = () => {
    const q = db.from('lead_worksheets').select('master_practices!inner(practice_code)')
    return !isSuperAdmin && tenantId ? q.eq('tenant_id', tenantId) : q
  }
  const viaProvider = (column: string, pattern: string) => db.from('practice_providers')
    .select('master_practices!inner(practice_code), providers!inner(id)')
    .ilike(`providers.${column}`, pattern)

  const lookups: PromiseLike<{ data: Row[] | null; error: unknown }>[] = []
  const add = (query: any) => lookups.push(query.limit(MAX_MATCHES_PER_LOOKUP))
  if (phone) {
    add(db.from('master_practices').select('practice_code').ilike('phone', phone))
    add(viaProvider('phone', phone))
    add(viaProvider('mailing_phone', phone))
    add(worksheets().ilike('additional_phone', phone))
    add(worksheets().ilike('direct_line', phone))
    if (digits.length >= 3 && digits.length <= 10) add(db.from('master_practices').select('practice_code').ilike('postal', `${digits}%`))
  }
  if (text) {
    add(db.from('master_practices').select('practice_code').ilike('city', text))
    add(worksheets().ilike('email', text))
    add(worksheets().ilike('concerned_person', text))
  }

  const codes = new Set<string>()
  const settled = await Promise.allSettled(lookups)
  for (const result of settled) {
    if (result.status !== 'fulfilled' || result.value.error) continue
    for (const row of result.value.data ?? []) {
      const code = row.practice_code ?? row.master_practices?.practice_code
      if (code) codes.add(code)
    }
  }
  return codes
}
