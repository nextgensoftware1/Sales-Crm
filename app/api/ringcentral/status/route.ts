import { authorizeRingCentral, ringCentralGet } from '../../../../lib/ringcentral'

export const dynamic = 'force-dynamic'

export async function GET() {
  const respond = (body: unknown, status = 200) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
  const authorized = await authorizeRingCentral()
  if (!authorized.ok) return respond({ message: authorized.message }, authorized.status)

  const result = await ringCentralGet<{ id?: string }>(
    '/restapi/v1.0/account/~/extension/~',
    {},
  )
  if (!result.ok) return respond({ message: result.message, code: result.code }, result.status)
  return respond({ ok: true, accountAvailable: true })
}
