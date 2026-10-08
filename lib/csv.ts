export type CsvRow = Record<string, string>

/** RFC-4180-style parser for browser uploads. Empty trailing headers are ignored. */
export function parseCsv(text: string): CsvRow[] {
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
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field); matrix.push(row); row = []; field = '' }
    else if (char !== '\r') field += char
  }
  if (field || row.length) { row.push(field); matrix.push(row) }
  if (matrix.length < 2) return []
  const headers = matrix[0].map(header => header.trim())
  return matrix.slice(1).filter(values => values.some(value => value.trim())).map(values => {
    const result: CsvRow = {}
    headers.forEach((header, index) => { if (header) result[header] = values[index] ?? '' })
    return result
  })
}
