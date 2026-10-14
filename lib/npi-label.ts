// ← ADDED (new file) — how a lead's code is SHOWN on screen: "NPI 1234567890"
// instead of the internal practice code "PR-1234567890". Links, searches and
// the database keep using the practice code; only the label changes.
export function npiLabel(practiceCode: string | null | undefined): string {
  if (!practiceCode) return ''
  return `NPI ${practiceCode.replace(/^PR-/i, '')}`
}
