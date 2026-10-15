// ← ADDED (new file) — the addresses shown in the practice page's
// "Locations" box: primary practice, mailing and secondary practice
// address(es) from the NPPES columns of the uploaded CSV.
//
// The same address is shown ONCE with all its labels (e.g. "Primary ·
// Mailing"). Two addresses are the same when street, city, state and ZIP
// match — ignoring upper/lower case, spaces, commas/dots, and a ZIP+4 vs a
// 5-digit ZIP (92123 = 921234363). Empty addresses are never shown.

export type LocationLabel = 'Primary' | 'Mailing' | 'Secondary'
export type PracticeLocation = { address: string; labels: LocationLabel[]; phones: string[] }

type ProviderAddressFields = {
  primary_practice_address?: string | null
  mailing_address?: string | null
  secondary_practice_address?: string | null
  secondary_phone?: string | null
  mailing_phone?: string | null
  phone?: string | null
  addr1?: string | null
} | null | undefined

type PracticeFields = { city?: string | null; state?: string | null; postal?: string | null; phone?: string | null }

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/** Several values in one cell ("A | B", "A; B" or one per line). */
function splitCell(value: unknown): string[] {
  return clean(value).split(/\s*\|\s*|\s*;\s*|\r?\n/).map((s) => s.trim()).filter(Boolean)
}

/** Comparison key for "is this the same address?". */
export function addressKey(address: string): string {
  return address
    .toUpperCase()
    .replace(/\b(\d{5})-?\d{4}\b/g, '$1') // ZIP+4 → ZIP
    .replace(/[^A-Z0-9]+/g, '')
}

const phoneDigits = (p: string) => p.replace(/\D/g, '')

export function practiceLocations(provider: ProviderAddressFields, practice: PracticeFields): PracticeLocation[] {
  const out: PracticeLocation[] = []
  const byKey = new Map<string, PracticeLocation>()

  const add = (address: string, label: LocationLabel, phone: string) => {
    const text = address.trim()
    if (!text) return
    const key = addressKey(text)
    if (!key) return
    let entry = byKey.get(key)
    if (!entry) {
      entry = { address: text, labels: [], phones: [] }
      byKey.set(key, entry)
      out.push(entry)
    }
    if (!entry.labels.includes(label)) entry.labels.push(label)
    const p = phone.trim()
    if (p && !entry.phones.some((x) => phoneDigits(x) === phoneDigits(p))) entry.phones.push(p)
  }

  // Primary practice address. Leads uploaded before the full-address columns
  // existed fall back to the street + city/state/ZIP the CRM already has.
  const primary = clean(provider?.primary_practice_address)
    || [clean(provider?.addr1), [practice.city, practice.state, practice.postal].map(clean).filter(Boolean).join(', ')]
      .filter(Boolean).join(', ')
  add(primary, 'Primary', clean(provider?.phone) || clean(practice.phone))

  add(clean(provider?.mailing_address), 'Mailing', clean(provider?.mailing_phone))

  // Secondary practice address(es), shown as written in the CSV.
  const secondaries = splitCell(provider?.secondary_practice_address)
  const secondaryPhones = splitCell(provider?.secondary_phone)
  secondaries.forEach((address, i) => {
    const phone = secondaryPhones.length === secondaries.length
      ? secondaryPhones[i]
      : i === 0 ? secondaryPhones.join(', ') : ''
    add(address, 'Secondary', phone)
  })

  return out
}
