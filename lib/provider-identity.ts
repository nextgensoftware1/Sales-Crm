// Provider name + NPI for a lead, worked out the same way the Worksheet
// Reports page does it: the name from an imported worksheet first, then the
// provider record, then the lead's own name — skipping system placeholders
// like "Practice (PR-1356495915)" — and finally the organisation name.

const isPlaceholder = (name: string) => /^Practice\s*\(/i.test(name.trim())

export function importedProviderName(importData: Record<string, unknown> | null | undefined): string | null {
  if (!importData || typeof importData !== 'object') return null
  const norm = (label: string) => label.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  const value = (v: unknown) => String(v ?? '').trim()
  const entries = Object.entries(importData)
  // A single "name" column (many spreadsheets use slightly different headers).
  const single = entries.find(([label, v]) => value(v) && /^(provider'?s? (full )?name|provider|nppes (provider )?name|practice name|physician name|doctor name|full name|name)$/.test(norm(label)))
  const name = value(single?.[1])
  if (name && !isPlaceholder(name)) return name
  // Separate first / last name columns.
  const pick = (re: RegExp) => value(entries.find(([label]) => re.test(norm(label)))?.[1])
  const first = pick(/^(provider |nppes )?first name$/)
  const last = pick(/^(provider |nppes )?last name$/)
  const joined = [first, last].filter(Boolean).join(' ')
  return joined && !isPlaceholder(joined) ? joined : null
}

export function providerDisplayName(opts: {
  importData?: Record<string, unknown> | null
  providerName?: string | null
  practiceName?: string | null
  orgName?: string | null
}): string | null {
  const clean = (v?: string | null) => (v && v.trim() && !isPlaceholder(v) ? v.trim() : null)
  return importedProviderName(opts.importData) ?? clean(opts.providerName) ?? clean(opts.practiceName) ?? clean(opts.orgName)
}

/** NPI from the provider record, else from a lead code of the form "PR-<10-digit NPI>". */
export function leadNpi(providerNpi?: string | null, practiceCode?: string | null): string | null {
  const fromProvider = String(providerNpi ?? '').replace(/\D/g, '')
  if (fromProvider.length === 10) return fromProvider
  const fromCode = /^PR-(\d{10})$/i.exec(String(practiceCode ?? '').trim())
  return fromCode ? fromCode[1] : null
}
