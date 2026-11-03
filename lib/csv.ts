export type CsvRow = Record<string, string>

// ← CHANGED: optional `delimiter` (comma by default — existing callers are
// unchanged) and optional `findHeader` to use the first row that looks like
// the header (so a title row above the column names is skipped).
type ParseOptions = { delimiter?: string; findHeader?: (cells: string[]) => boolean }

/** RFC-4180-style parser for browser uploads. Empty trailing headers are ignored. */
export function parseCsv(text: string, options: ParseOptions = {}): CsvRow[] {
  const delimiter = options.delimiter ?? ','
  const matrix: string[][] = []
  let field = '', row: string[] = [], quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { row.push(field); field = '' }
    else if (char === '\n') { row.push(field); matrix.push(row); row = []; field = '' }
    else if (char !== '\r') field += char
  }
  if (field || row.length) { row.push(field); matrix.push(row) }
  // ← ADDED: header row = first of the first 20 rows that matches, else row 1
  let headerIndex = 0
  if (options.findHeader) {
    const found = matrix.slice(0, 20).findIndex((cells) => options.findHeader!(cells.map((c) => c.trim())))
    if (found > 0) headerIndex = found
  }
  if (matrix.length < headerIndex + 2) return []
  const headers = matrix[headerIndex].map(header => header.trim())
  return matrix.slice(headerIndex + 1).filter(values => values.some(value => value.trim())).map(values => {
    const result: CsvRow = {}
    headers.forEach((header, index) => { if (header) result[header] = values[index] ?? '' })
    return result
  })
}

// ← ADDED: comma, semicolon or tab — whichever splits the first lines best
// (Excel in some regions saves "CSV" with semicolons; copying from a
// spreadsheet or "Text (Tab delimited)" gives tabs).
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 5)
  const count = (line: string, d: string) => {
    let n = 0, quoted = false
    for (const ch of line) { if (ch === '"') quoted = !quoted; else if (!quoted && ch === d) n++ }
    return n
  }
  let best: ',' | ';' | '\t' = ',', bestScore = 0
  for (const d of [',', ';', '\t'] as const) {
    const score = lines.reduce((sum, line) => sum + count(line, d), 0)
    if (score > bestScore) { best = d; bestScore = score }
  }
  return best
}

// ← ADDED: the file's text, whatever Excel saved it as. "Unicode Text" is
// UTF-16; a real .xlsx file is a zip (starts with "PK") and cannot be read.
export async function readUploadText(file: File): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return { ok: false, message: 'This is an Excel workbook (.xlsx), not a CSV. In Excel use File → Save As → "CSV UTF-8 (Comma delimited)" and upload that file.' }
  }
  const utf16le = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0)
  const utf16be = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes.length > 3 && bytes[0] === 0 && bytes[2] === 0)
  const text = new TextDecoder(utf16le ? 'utf-16le' : utf16be ? 'utf-16be' : 'utf-8').decode(bytes)
  return { ok: true, text: text.replace(/^\uFEFF/, '') }
}
