import { authorizeRingCentral, parsePositiveInteger, ringCentralGet } from '../../../../lib/ringcentral'

export const dynamic = 'force-dynamic'

type RingCentralExtension = {
  id?: number | string | null
  extensionNumber?: string | null
  name?: string | null
  type?: string | null
  status?: string | null
  contact?: { firstName?: string | null; lastName?: string | null } | null
}
type ExtensionsResponse = {
  records?: RingCentralExtension[] | null
  navigation?: { page?: number | null; perPage?: number | null; totalPages?: number | null; totalElements?: number | null } | null
}

export async function GET(request: Request) {
  const respond = (body: unknown, status = 200) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
  const authorized = await authorizeRingCentral()
  if (!authorized.ok) return respond({ message: authorized.message }, authorized.status)

  const url = new URL(request.url)
  const page = parsePositiveInteger(url.searchParams.get('page'), 1, 1000)
  const perPage = parsePositiveInteger(url.searchParams.get('perPage'), 50, 100)
  if (page === null || perPage === null) {
    return respond({ message: 'Page and page size must be positive integers.' }, 400)
  }

  const result = await ringCentralGet<ExtensionsResponse>(
    '/restapi/v1.0/account/~/extension',
    { page, perPage, status: 'Enabled' },
  )
  if (!result.ok) return respond({ message: result.message, code: result.code }, result.status)

  const extensions = (result.data.records ?? []).map((extension) => ({
    id: extension.id ?? null,
    extensionNumber: extension.extensionNumber ?? null,
    name: extension.name ?? null,
    type: extension.type ?? null,
    status: extension.status ?? null,
  }))
  return respond({
    extensions,
    pagination: {
      page: result.data.navigation?.page ?? page,
      perPage: result.data.navigation?.perPage ?? perPage,
      totalPages: result.data.navigation?.totalPages ?? null,
      totalElements: result.data.navigation?.totalElements ?? null,
    },
  })
}
