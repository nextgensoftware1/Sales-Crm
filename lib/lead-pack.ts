// Compact transport formats for the Leads page.
//
// 1. decodeFlatLead: turns one compact row from crm_lead_rows_flat
//    (database/performance-rpc-v4.sql) back into the exact nested shape the
//    Leads page already understands, so none of its rules change.
// 2. packRows / unpackRows: send the table rows to the browser as
//    { keys, rows } (each field name once) instead of repeating every field
//    name for every lead. unpackRows rebuilds the same compact objects.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export function decodeFlatLead(row: Json[]): Record<string, unknown> {
  const [id, practice_code, name, state, specialty, owner_tenant_id, created_at, latestActivity, provider, assignedAway] =
    row as [string, string, string, string | null, string | null, string | null, string | null, string | null, Json[] | null, Json[] | null]

  const lead: Record<string, unknown> = {
    id, practice_code, name, state, specialty, owner_tenant_id, created_at,
    lead_activity: latestActivity ? [{ created_at: latestActivity }] : [],
    practice_providers: [],
  }

  if (Array.isArray(provider)) {
    const [npi, org_name, nppes_sex, nppes_last_updated, payment_adj_pct, at_risk, record_source,
      entity_type, enumeration_date, signals, mips] = provider
    const s = Array.isArray(signals) ? signals : null
    lead.practice_providers = [{
      providers: {
        npi, org_name, nppes_sex, nppes_last_updated, payment_adj_pct, at_risk, record_source,
        entity_type, enumeration_date,
        provider_signals: s
          ? { ccm: s[0], pcm: s[1], awv: s[2], tcm: s[3], bhi: s[4], rpm: s[5], rcm_fit: s[6] }
          : null,
        provider_mips: (Array.isArray(mips) ? mips : []).map((m) => {
          const [performance_year, status, reporting_option] = m as Json[]
          return { performance_year, status, reporting_option }
        }),
      },
    }]
  }

  if (Array.isArray(assignedAway)) {
    lead.assigned_away = assignedAway.map((entry) => {
      const [assigned_at, user] = entry as [string | null, Json[] | null]
      return {
        assigned_at,
        users: Array.isArray(user)
          ? { full_name: user[0], roles: user[1] == null ? null : { key: user[1] } }
          : null,
      }
    })
  }

  return lead
}

export type PackedRows = { keys: string[]; rows: unknown[][] }

// Fields that are always present on a row, even when their value is null.
const ALWAYS_KEPT = new Set(['practiceCode', 'name'])

/** Rows must already be compacted (see compactRow): absent fields are not stored. */
export function packRows(rows: Record<string, unknown>[]): PackedRows {
  const index = new Map<string, number>()
  const keys: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!index.has(key)) { index.set(key, keys.length); keys.push(key) }
    }
  }
  const packed = rows.map((row) => {
    const values: unknown[] = new Array(keys.length).fill(null)
    for (const key of Object.keys(row)) values[index.get(key)!] = row[key]
    // Trailing nulls carry no information; drop them to save more space.
    let end = values.length
    while (end > 0 && values[end - 1] === null) end--
    return values.slice(0, end)
  })
  return { keys, rows: packed }
}

export function unpackRows<T = Record<string, unknown>>(packed: PackedRows): T[] {
  const { keys, rows } = packed
  return rows.map((values) => {
    const row: Record<string, unknown> = {}
    keys.forEach((key, i) => {
      const value = i < values.length ? values[i] : null
      if (value !== null && value !== undefined) row[key] = value
      else if (ALWAYS_KEPT.has(key)) row[key] = value ?? null
    })
    return row as T
  })
}
