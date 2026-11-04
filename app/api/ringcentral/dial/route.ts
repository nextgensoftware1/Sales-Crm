import { ringCentralPost } from '../../../../lib/ringcentral'

export const dynamic = 'force-dynamic'

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  if (!/^\d+$/.test(digits) || digits.length < 7 || digits.length > 15) return null
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null
}

export async function POST(request: Request) {
  const respond = (body: unknown, status = 200) => Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })

  const { getCurrentUser, getCurrentProfile } = await import('../../../../lib/supabase-server')
  const { data: { user } } = await getCurrentUser()
  if (!user) return respond({ message: 'Not signed in.' }, 401)
  const { data: profile } = await getCurrentProfile(user.id)
  if (!profile?.status || profile.status !== 'active') {
    return respond({ message: 'Your CRM account is not active.' }, 403)
  }

  let body: { phoneNumber?: unknown }
  try {
    body = await request.json() as { phoneNumber?: unknown }
  } catch {
    return respond({ message: 'Invalid request body.' }, 400)
  }

  const phoneNumber = normalizePhone(body.phoneNumber)
  if (!phoneNumber) return respond({ message: 'Enter a valid destination phone number.' }, 400)

  const fromNumber = normalizePhone(process.env.RINGCENTRAL_FROM_NUMBER?.trim())
  if (!fromNumber) {
    return respond({
      message: 'Outbound calling is not configured. Set RINGCENTRAL_FROM_NUMBER to an authorized RingCentral number.',
      code: 'RC_NOT_CONFIGURED',
    }, 503)
  }
  if (fromNumber === phoneNumber) {
    return respond({
      message: 'The destination number must be different from the outbound RingCentral number.',
      code: 'RC_SAME_PHONE_NUMBER',
    }, 400)
  }

  // The optional ReadAccounts scope is not required for RingOut. Let RingOut
  // validate that the authenticated extension owns and may use this source.
  const result = await ringCentralPost<{ id?: string; status?: unknown }>(
    '/restapi/v1.0/account/~/extension/~/ringout',
    {
      from: { phoneNumber: fromNumber },
      to: { phoneNumber },
      playPrompt: false,
    },
  )
  if (!result.ok) {
    return respond({
      message: result.message,
      code: result.code ?? result.errorCode ?? 'RC_RINGOUT_FAILED',
      upstreamStatus: result.upstreamStatus,
      errorCode: result.errorCode,
      additionalInfo: result.additionalInfo,
    }, result.status)
  }

  return respond({
    ok: true,
    message: 'RingCentral is dialing this number.',
    ringOutId: result.data.id ?? null,
  })
}
