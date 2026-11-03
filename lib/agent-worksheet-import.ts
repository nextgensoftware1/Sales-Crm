// ← ADDED (new file) — reads a CSV of ONE agent's call work:
//   NPI | Disposition / Response | Call details * / Note
// (the same headers as the Leads Engine spreadsheet). Header names are
// matched loosely, so "Disposition", "Response", "Notes", "Call details" …
// also work. Rows that cannot be used are returned as `skipped` with the
// reason — they are ignored, the rest are imported.
// ← CHANGED: an empty "Call details / Note" is allowed (the disposition is
// used as the note), and common spellings such as "HANG UP", "VM" or "NA"
// are understood.

import type { CsvRow } from './csv'
import { DISPOSITIONS } from './dispositions'
import { EMAIL_RESPONSES } from './email-leads'

export type AgentWorksheetRow = { row_number: number; npi: string; disposition: string; notes: string; note_given: boolean; raw: Record<string, string> } // ← CHANGED: + note_given
export type SkippedRow = { row: number; npi: string | null; reason: string }

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

const NPI_HEADERS = ['npi', 'npi number', 'provider npi']
const DISPOSITION_HEADERS = ['disposition response', 'disposition', 'call disposition', 'response', 'status']
const NOTES_HEADERS = ['call details note', 'call details', 'notes', 'note', 'call notes', 'details']

function findHeader(headers: string[], wanted: string[]): string | null {
  for (const name of wanted) {
    const hit = headers.find((h) => key(h) === name)
    if (hit) return hit
  }
  return null
}

/** ← ADDED: does this row look like the header of a worksheet file? (used to skip title rows) */
export function looksLikeWorksheetHeader(cells: string[]): boolean {
  const keys = cells.map(key)
  const has = (names: string[]) => names.some((n) => keys.includes(n))
  return has(NPI_HEADERS) && (has(DISPOSITION_HEADERS) || has(NOTES_HEADERS) || keys.includes('company name'))
}

/** Is this file in the old full format (Company Name + Agent Name columns)? */
export function isFullWorksheetFormat(rows: CsvRow[]): boolean {
  const headers = Object.keys(rows[0] ?? {}).map(key)
  return headers.includes('company name') && headers.includes('agent name')
}

const DISPOSITION_BY_KEY = new Map(DISPOSITIONS.map((d) => [squash(d), d]))
// ← ADDED: common ways agents write a disposition in their own sheets.
// (Capital letters, spaces and dashes are already ignored: "HUNG UP",
// "follow-up", "Call Back" match without being listed here.)
const DISPOSITION_ALIASES: Record<string, string> = {
  hangup: 'Hung up', hangedup: 'Hung up', hungup: 'Hung up', hu: 'Hung up',
  vm: 'Voicemail', voicemail: 'Voicemail', leftvm: 'Voicemail', leftvoicemail: 'Voicemail',
  na: 'No Answer', noans: 'No Answer', noanswer: 'No Answer', notanswered: 'No Answer', nopickup: 'No Answer', rna: 'No Answer',
  cb: 'Call back', callback: 'Call back', callbacklater: 'Call back',
  fd: 'Front Desk', frontdesk: 'Front Desk', receptionist: 'Front Desk', gatekeeper: 'Front Desk',
  ni: 'Not Interested', notinterested: 'Not Interested',
  donotcall: 'DNC', dnc: 'DNC',
  fu: 'Follow Up', followup: 'Follow Up',
  ne: 'Not Eligible', noteligible: 'Not Eligible',
  closed: 'Offc Perm Closed', permanentlyclosed: 'Offc Perm Closed', officeclosed: 'Offc Perm Closed', offcpermclosed: 'Offc Perm Closed',
  sendmail: 'Send Mail', sendemail: 'Send Mail', mailsent: 'Send Mail',
}
for (const [alias, value] of Object.entries(DISPOSITION_ALIASES)) if (!DISPOSITION_BY_KEY.has(alias)) DISPOSITION_BY_KEY.set(alias, value)
const EMAIL_ONLY = new Set((EMAIL_RESPONSES as readonly string[]).map(squash).filter((k) => !DISPOSITION_BY_KEY.has(k)))

/** NPI as 10 digits, repairing what Excel often does to long numbers. */
export function cleanNpi(input: string): string | null {
  const v = (input ?? '').trim().replace(/^'+/, '')
  if (/^\d{10}\.0+$/.test(v)) return v.split('.')[0]          // 1234567890.0
  const digits = v.replace(/\D/g, '')
  return /^\d{10}$/.test(digits) ? digits : null
}

export function readAgentWorksheetCsv(rows: CsvRow[]): {
  ok: boolean; message?: string; rows: AgentWorksheetRow[]; skipped: SkippedRow[]
} {
  if (!rows.length) return { ok: false, message: 'No data rows were found in the file.', rows: [], skipped: [] }
  const headers = Object.keys(rows[0])
  const npiH = findHeader(headers, NPI_HEADERS)
  const dispoH = findHeader(headers, DISPOSITION_HEADERS)
  const notesH = findHeader(headers, NOTES_HEADERS)
  const missing = [!npiH && 'NPI', !dispoH && 'Disposition / Response', !notesH && 'Call details * / Note'].filter(Boolean)
  // ← CHANGED: also say which columns WERE found, so a wrong file is easy to spot
  if (missing.length) {
    const found = headers.filter((h) => h.trim()).slice(0, 8).map((h) => `"${h.trim().slice(0, 40)}"`).join(', ')
    return { ok: false, message: `Missing column(s): ${missing.join(', ')}. Columns found in the file: ${found || 'none'}.`, rows: [], skipped: [] }
  }

  const out: AgentWorksheetRow[] = []
  const skipped: SkippedRow[] = []
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const line = index + 2 // header is line 1
    const rawNpi = String(row[npiH!] ?? '').trim()
    const rawDispo = String(row[dispoH!] ?? '').trim()
    const notes = String(row[notesH!] ?? '').trim()
    if (!rawNpi && !rawDispo && !notes) return // blank line
    const npi = cleanNpi(rawNpi)
    const skip = (reason: string) => skipped.push({ row: line, npi: npi ?? (rawNpi || null), reason })
    if (!npi) return skip(/e\+?\d/i.test(rawNpi) ? 'NPI was changed by Excel (scientific format) — format the column as Text' : 'NPI must contain exactly 10 digits')
    if (!rawDispo) return skip('Disposition is empty')
    const disposition = DISPOSITION_BY_KEY.get(squash(rawDispo))
    if (!disposition) return skip(EMAIL_ONLY.has(squash(rawDispo))
      ? `"${rawDispo}" is an email response, not a call disposition`
      : `Unknown disposition "${rawDispo}"`)
    // ← CHANGED: an empty note is allowed — the disposition becomes the note
    // (e.g. "No Answer"), so the row is imported instead of skipped.
    if (notes.length > 5000) return skip('Call details / note is longer than 5,000 characters')
    if (seen.has(npi)) return skip('Same NPI appears earlier in this file')
    seen.add(npi)
    const raw = Object.fromEntries(Object.entries(row).map(([h, v]) => [h.trim(), String(v ?? '').trim()]))
    // ← CHANGED: blank note → the disposition is used, but only when the lead
    // has no note yet (the database keeps an existing note — see note_given).
    out.push({ row_number: line, npi, disposition, notes: notes || disposition, note_given: !!notes, raw })
  })
  return { ok: true, rows: out, skipped }
}
