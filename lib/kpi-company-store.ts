'use client'

// Selected company on the KPI page, shared by the company list in the left
// panel and the KPI records in the page body (see lib/page-shared-value.ts).
import { useSharedValue, setSharedValue } from './page-shared-value'

export const setKpiCompany = (next: string) => setSharedValue('kpi-company', next)
export const useKpiCompany = () => useSharedValue('kpi-company')
