export const dynamic = 'force-dynamic'

export async function POST() {
  const respond = (body: unknown, status = 200) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })

  return respond({
    message: 'Shared-number RingOut fallback is disabled. Dial through the installed RingCentral extension.',
    code: 'RC_RINGOUT_DISABLED',
  }, 410)
}
