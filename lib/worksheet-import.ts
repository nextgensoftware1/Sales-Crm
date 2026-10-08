import type { CsvRow } from './csv'

export const WORKSHEET_IMPORT_REQUIRED = ['Company Name', 'Agent Name', 'NPI', 'Notes'] as const

const clean = (value: unknown) => String(value ?? '').trim()
const key = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')

function value(row: CsvRow, name: string) {
  const wanted = key(name)
  const found = Object.keys(row).find(header => key(header) === wanted)
  return found ? clean(row[found]) : ''
}

function parseUsDate(input: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input)
  if (!match) return null
  const [, month, day, year] = match
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const date = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : iso
}

const zoneNames: Record<string, string> = {
  est: 'Eastern', edt: 'Eastern', eastern: 'Eastern',
  cst: 'Central', cdt: 'Central', central: 'Central',
  mst: 'Mountain', mdt: 'Mountain', mountain: 'Mountain',
  pst: 'Pacific', pdt: 'Pacific', pacific: 'Pacific',
}

export type WorksheetImportRow = {
  row_number: number
  company_name: string
  agent_name: string
  npi: string
  notes: string
  callback_date: string | null
  timezone: string | null
  latest_call_date: string | null
  provider_name: string | null
  phone_number: string | null
  secondary_phone: string | null
  raw_data: CsvRow
}

export function normalizeWorksheetImportRows(rows: CsvRow[]): { rows: WorksheetImportRow[]; errors: string[] } {
  if (!rows.length) return { rows: [], errors: ['No data rows were found.'] }
  const headers = Object.keys(rows[0]).map(key)
  const missing = WORKSHEET_IMPORT_REQUIRED.filter(name => !headers.includes(key(name)))
  if (missing.length) return { rows: [], errors: [`Missing required column(s): ${missing.join(', ')}.`] }
  const errors: string[] = []
  const normalized = rows.map((row, index) => {
    const line = index + 2
    const company = value(row, 'Company Name'), agent = value(row, 'Agent Name')
    const npi = value(row, 'NPI').replace(/\D/g, ''), notes = value(row, 'Notes')
    if (!company) errors.push(`Row ${line}: Company Name is required.`)
    if (!agent) errors.push(`Row ${line}: Agent Name is required.`)
    if (!/^\d{10}$/.test(npi)) errors.push(`Row ${line}: NPI must contain exactly 10 digits.`)
    if (!notes) errors.push(`Row ${line}: Notes is required.`)
    const followUp = value(row, 'Follow up'), latestCall = value(row, 'Latest call')
    const callbackDate = followUp ? parseUsDate(followUp) : null
    const latestCallDate = latestCall ? parseUsDate(latestCall) : null
    if (followUp && !callbackDate) errors.push(`Row ${line}: Follow up must use M/D/YYYY.`)
    if (latestCall && !latestCallDate) errors.push(`Row ${line}: Latest call must use M/D/YYYY.`)
    const raw_data = Object.fromEntries(Object.entries(row).map(([header, cell]) => [header.trim(), clean(cell)]))
    return { row_number: line, company_name: company, agent_name: agent, npi, notes,
      callback_date: callbackDate, timezone: zoneNames[value(row, 'T-Z').toLowerCase()] ?? null,
      latest_call_date: latestCallDate, provider_name: value(row, "Provider's Name") || null,
      phone_number: value(row, 'Phone Number') || null,
      secondary_phone: value(row, 'Secondary Phone').replace(/^[-–—]$/, '') || null, raw_data }
  })
  const identities = new Set<string>()
  for (const row of normalized) {
    const identity = `${row.company_name.toLowerCase()}|${row.npi}`
    if (identities.has(identity)) errors.push(`Row ${row.row_number}: duplicate company and NPI in this file.`)
    identities.add(identity)
  }
  return { rows: normalized, errors }
}
