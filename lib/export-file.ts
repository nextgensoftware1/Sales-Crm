// ← ADDED (new file) — download a table as CSV or as a real Excel (.xlsx)
// file, in the browser, without any extra package. The .xlsx is a minimal
// workbook (one sheet, bold header row) packed in an uncompressed zip.

export type ExportTable = { headers: string[]; rows: (string | number | null | undefined)[][] }

// ---------------------------------------------------------------- CSV

// Cells starting with = + - @ (or tab / CR) could run as formulas when the
// CSV is opened in Excel; prefix them with ' so they stay plain text.
// Numbers like -12 or phone numbers like (555) 123-4567 are left alone.
function safeCsvText(value: string): string {
  if (/^[=+@\t\r]/.test(value) || (/^-/.test(value) && !/^-\d+(\.\d+)?$/.test(value))) return `'${value}`
  return value
}

export function toCsv({ headers, rows }: ExportTable): string {
  const cell = (v: string | number | null | undefined) => {
    const text = safeCsvText(v === null || v === undefined ? '' : String(v))
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [headers, ...rows].map((r) => r.map(cell).join(','))
  return '\ufeff' + lines.join('\r\n') // BOM so Excel reads UTF-8 correctly
}

// ---------------------------------------------------------------- XLSX

const enc = new TextEncoder()

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Store-only (no compression) zip archive. */
function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = enc.encode(file.name)
    const crc = crc32(file.data)
    const size = file.data.length

    const header = new DataView(new ArrayBuffer(30))
    header.setUint32(0, 0x04034b50, true) // local file header
    header.setUint16(4, 20, true)         // version needed
    header.setUint16(6, 0x0800, true)     // UTF-8 names
    header.setUint16(8, 0, true)          // stored
    header.setUint32(14, crc, true)
    header.setUint32(18, size, true)
    header.setUint32(22, size, true)
    header.setUint16(26, name.length, true)
    local.push(new Uint8Array(header.buffer), name, file.data)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)    // central directory header
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint16(10, 0, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, size, true)
    dir.setUint32(24, size, true)
    dir.setUint16(28, name.length, true)
    dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), name)

    offset += 30 + name.length + size
  }
  const centralSize = central.reduce((n, part) => n + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)      // end of central directory
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  const parts = [...local, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.length }
  return out
}

function xmlText(value: string): string {
  // Remove characters XML doesn't allow, then escape.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

export function toXlsx({ headers, rows }: ExportTable, sheetName = 'Sheet1'): Uint8Array {
  const all = [headers, ...rows]
  const sheetRows = all.map((r, ri) => {
    const cells = r.map((v, ci) => {
      if (v === null || v === undefined || v === '') return ''
      const ref = `${columnName(ci)}${ri + 1}`
      const style = ri === 0 ? ' s="1"' : ''
      // Everything is written as text (phones, NPIs, dates keep their format).
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlText(String(v))}</t></is></c>`
    }).join('')
    return `<row r="${ri + 1}">${cells}</row>`
  }).join('')
  const widths = headers.map((h, i) => {
    const longest = Math.max(h.length, ...rows.slice(0, 500).map((r) => String(r[i] ?? '').length))
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, longest + 2))}" customWidth="1"/>`
  }).join('')

  const files = [
    { name: '[Content_Types].xml', xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData></worksheet>` },
  ]
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })))
}

// ---------------------------------------------------------------- download

export function downloadFile(filename: string, content: string | Uint8Array, mime: string) {
  const blob = new Blob([content as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}