'use client'

// Worksheet Reports search text, shared by the search box in the left panel
// and the report in the page body (see lib/page-shared-value.ts).
import { useSharedValue, setSharedValue } from './page-shared-value'

export const setWorksheetSearch = (next: string) => setSharedValue('worksheet-search', next)
export const useWorksheetSearch = () => useSharedValue('worksheet-search')
