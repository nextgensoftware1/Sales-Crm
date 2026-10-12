// The worksheet's Disposition options — one list used everywhere: the
// worksheet on a lead, the Worksheet Reports edit popup, and the disposition
// filters on the Leads and Worksheet Reports pages (which also show any other
// value found in saved data, e.g. older or imported dispositions).
export const DISPOSITIONS = ['New', 'No Answer', 'Call back', 'Front Desk', 'Not Interested', 'Transfer', 'Voicemail', 'Send Mail', 'Interested', 'Meeting', 'Qualified', 'Not Eligible', 'Hung up', 'DNC', 'Offc Perm Closed', 'Follow Up', 'Proposal', 'Contract', 'Sold']

/** Filter options: every standard disposition plus any other value in the data, A–Z. */
export function dispositionOptions(fromData: Iterable<string | null | undefined>): string[] {
  const all = new Set<string>(DISPOSITIONS)
  for (const value of fromData) if (value && value.trim()) all.add(value)
  return Array.from(all).sort((a, b) => a.localeCompare(b))
}
