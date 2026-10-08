'use client'

import { Search } from 'lucide-react'
import { useWorksheetSearch } from '../../lib/worksheet-search-store'

// Search box in the left Worksheets panel (same look as the Leads panel's
// search). Filters the report on the right as you type.
export default function WorksheetSearchBox() {
  const [search, setSearch] = useWorksheetSearch()
  return (
    <label className="lead-engine-subnav-search worksheet-panel-search">
      <Search size={15} strokeWidth={2} aria-hidden="true" />
      <input
        type="search"
        aria-label="Search worksheets"
        placeholder="Name, NPI, phone, email…"
        title="Search by provider name, NPI / lead code, phone number, email, contact person, call details, state, specialty, company, agent or disposition"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
    </label>
  )
}
