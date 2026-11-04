import { NextRequest } from 'next/server'
import { authorizeRingCentral, parsePositiveInteger, ringCentralGet } from '../../../../lib/ringcentral'

export const dynamic = 'force-dynamic'

type CallParty = { phoneNumber?: string | null; name?: string | null; extensionNumber?: string | null }
type RingCentralCall = {
  id?: string | null
  startTime?: string | null
  duration?: number | null
  type?: string | null
  direction?: string | null
  result?: string | null
  from?: CallParty | null
  to?: CallParty | null
  extensionName?: string | null
  extensionNumber?: string | null
}
type RingCentralCallLog = {
  records?: RingCentralCall[] | null
  navigation?: {
    page?: number | null
    perPage?: number | null
    pageStart?: number | null
    pageEnd?: number | null
    totalPages?: number | null
    totalElements?: number | null
  } | null
}

export async function GET(request: NextRequest) {
  const respond = (body: unknown, status = 200) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
  const authorized = await authorizeRingCentral()
  if (!authorized.ok) return respond({ message: authorized.message }, authorized.status)

  const search = request.nextUrl.searchParams
  const page = parsePositiveInteger(search.get('page'), 1, 1000)
  const perPage = parsePositiveInteger(search.get('perPage'), 25, 100)
  if (page === null || perPage === null) {
    return respond({ message: 'Page and page size must be positive integers.' }, 400)
  }

  const from = search.get('from')
  const to = search.get('to')
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const dateFrom = from ? new Date(from) : defaultFrom
  const dateTo = to ? new Date(`${to}T23:59:59.999Z`) : now
  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime()) || dateFrom > dateTo) {
    return respond({ message: 'Provide valid from and to date filters.' }, 400)
  }
  if (dateTo.getTime() - dateFrom.getTime() > 93 * 24 * 60 * 60 * 1000) {
    return respond({ message: 'Date range cannot exceed 93 days.' }, 400)
  }

  const direction = search.get('direction')
  if (direction && !['Inbound', 'Outbound'].includes(direction)) {
    return respond({ message: 'Direction must be Inbound or Outbound.' }, 400)
  }

  const query: Record<string, string | number> = {
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    page,
    perPage,
    view: 'Simple',
  }
  if (direction) query.direction = direction.toLowerCase()

  const result = await ringCentralGet<RingCentralCallLog>(
    '/restapi/v1.0/account/~/call-log',
    query,
  )
  if (!result.ok) return respond({ message: result.message, code: result.code }, result.status)

  const records = (result.data.records ?? [])
    .filter((record): record is RingCentralCall => Boolean(record))
  const seen = new Set<string>()
  const calls = records.flatMap((record) => {
    const key = `${record.id ?? ''}|${record.startTime ?? ''}|${record.direction ?? ''}|${record.from?.phoneNumber ?? ''}|${record.to?.phoneNumber ?? ''}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      id: record.id ?? null,
      startTime: record.startTime ?? null,
      duration: typeof record.duration === 'number' ? record.duration : null,
      type: record.type ?? null,
      direction: record.direction ?? null,
      result: record.result ?? null,
      from: { name: record.from?.name ?? null, phoneNumber: record.from?.phoneNumber ?? null, extensionNumber: record.from?.extensionNumber ?? null },
      to: { name: record.to?.name ?? null, phoneNumber: record.to?.phoneNumber ?? null, extensionNumber: record.to?.extensionNumber ?? null },
      extensionName: record.extensionName ?? null,
      extensionNumber: record.extensionNumber ?? null,
    }]
  })

  const navigation = result.data.navigation
  return respond({
    calls,
    pagination: {
      page: navigation?.page ?? page,
      perPage: navigation?.perPage ?? perPage,
      pageStart: navigation?.pageStart ?? null,
      pageEnd: navigation?.pageEnd ?? null,
      totalPages: navigation?.totalPages ?? null,
      totalElements: navigation?.totalElements ?? null,
    },
  })
}
