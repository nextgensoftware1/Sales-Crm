import { SDK } from '@ringcentral/sdk'
import { getCurrentUser, getCurrentProfile } from './supabase-server'

const REQUEST_TIMEOUT_MS = 15_000
const MAX_PAGE_SIZE = 100

export type RingCentralResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      status: number
      message: string
      code?: string
      upstreamStatus?: number
      errorCode?: string
      additionalInfo?: unknown
    }

let ringCentralSdk: SDK | null = null
let ringCentralLogin: Promise<void> | null = null

export class RingCentralConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RingCentralConfigurationError'
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('RingCentral request timed out')), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function sanitizedText(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = value
    .replace(/(Bearer\s+)[^\s,]+/gi, '$1[REDACTED]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|jwt|client[_-]?secret)["'\s:=]+)[^,\s"'}]+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized ? sanitized.slice(0, maxLength) : undefined
}

function sanitizedAdditionalInfo(value: unknown): unknown {
  if (typeof value === 'string') return sanitizedText(value, 1000)
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizedAdditionalInfo(item)).filter((item) => item != null)
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      if (/authorization|access.?token|refresh.?token|client.?secret|jwt/i.test(key)) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = sanitizedAdditionalInfo(item)
      }
    }
    return result
  }
  return undefined
}

async function readUpstreamError(error: unknown, response?: Response): Promise<{
  upstreamStatus?: number
  errorCode?: string
  message?: string
  additionalInfo?: unknown
}> {
  const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const responseCandidate = errorRecord.response
  const candidateLooksLikeResponse = responseCandidate && typeof responseCandidate === 'object'
    && typeof (responseCandidate as { clone?: unknown }).clone === 'function'
  const errorResponse = response
    ?? (candidateLooksLikeResponse ? responseCandidate as Response : undefined)
  let payload: Record<string, unknown> = {}

  if (errorResponse) {
    try {
      payload = await errorResponse.clone().json() as Record<string, unknown>
    } catch {
      // Some upstream errors are text/plain or empty.
    }
  }

  const nestedErrors = Array.isArray(payload.errors) ? payload.errors : undefined
  const nestedError = nestedErrors?.[0] && typeof nestedErrors[0] === 'object'
    ? nestedErrors[0] as Record<string, unknown>
    : undefined

  return {
    upstreamStatus: errorResponse?.status ?? (typeof errorRecord.status === 'number' ? errorRecord.status : undefined),
    errorCode: sanitizedText(
      payload.errorCode ?? payload.code ?? nestedError?.errorCode ?? nestedError?.code,
      100,
    ),
    message: sanitizedText(
      payload.message ?? payload.error_description ?? payload.description ?? nestedError?.message
        ?? errorRecord.originalMessage ?? (error instanceof Error ? error.message : undefined),
      500,
    ),
    additionalInfo: sanitizedAdditionalInfo(payload.additionalInfo ?? payload.parameters ?? nestedError?.additionalInfo),
  }
}

function logRingCentralError(operation: string, details: {
  upstreamStatus?: number
  errorCode?: string
  message?: string
  additionalInfo?: unknown
}) {
  console.error('[RingCentral]', JSON.stringify({
    operation,
    upstreamStatus: details.upstreamStatus ?? null,
    errorCode: details.errorCode ?? null,
    message: details.message ?? null,
    additionalInfo: sanitizedAdditionalInfo(details.additionalInfo) ?? null,
  }))
}

export function getRingCentralConfiguration() {
  const clientId = process.env.RINGCENTRAL_CLIENT_ID?.trim()
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET?.trim()
  const jwt = process.env.RINGCENTRAL_JWT?.trim()
  const rawServerUrl = process.env.RINGCENTRAL_SERVER_URL?.trim()
  const missing = [
    ['RINGCENTRAL_CLIENT_ID', clientId],
    ['RINGCENTRAL_CLIENT_SECRET', clientSecret],
    ['RINGCENTRAL_JWT', jwt],
    ['RINGCENTRAL_SERVER_URL', rawServerUrl],
  ].filter(([, value]) => !value).map(([name]) => name)

  if (missing.length) {
    throw new RingCentralConfigurationError(`Missing required server configuration: ${missing.join(', ')}`)
  }

  let serverUrl: string
  try {
    const parsed = new URL(rawServerUrl!)
    if (parsed.protocol !== 'https:' || !['platform.ringcentral.com', 'platform.devtest.ringcentral.com'].includes(parsed.hostname)) {
      throw new Error('invalid host')
    }
    serverUrl = parsed.origin
  } catch {
    throw new RingCentralConfigurationError('RINGCENTRAL_SERVER_URL must be the production or sandbox RingCentral HTTPS platform URL.')
  }

  return { clientId: clientId!, clientSecret: clientSecret!, jwt: jwt!, serverUrl }
}

async function getAuthenticatedSdk(): Promise<SDK> {
  const config = getRingCentralConfiguration()
  if (!ringCentralSdk) {
    ringCentralSdk = new SDK({
      server: config.serverUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      handleRateLimit: false,
    })
  }

  const platform = ringCentralSdk.platform()
  if (await platform.loggedIn()) {
    await withTimeout(platform.ensureLoggedIn() as Promise<Response>)
    return ringCentralSdk
  }

  if (!ringCentralLogin) {
    ringCentralLogin = withTimeout(platform.login({ jwt: config.jwt }).then((response) => {
      console.info('[RingCentral]', JSON.stringify({
        operation: 'JWT login',
        upstreamStatus: response.status,
        result: 'authenticated',
      }))
    }))
      .finally(() => { ringCentralLogin = null })
  }
  await ringCentralLogin
  return ringCentralSdk
}

export async function authorizeRingCentral() {
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false as const, status: 401, message: 'Not signed in.' }
  const { data: me } = await getCurrentProfile(user.id)
  const role = me?.roles?.key ?? ''
  if (!me?.status || me.status !== 'active') {
    return { ok: false as const, status: 403, message: 'Your CRM account is not active.' }
  }
  if (!['super_admin', 'company_admin', 'manager', 'team_lead'].includes(role)) {
    return { ok: false as const, status: 403, message: 'You do not have permission to view RingCentral information.' }
  }
  return { ok: true as const }
}

export async function ringCentralGet<T>(path: string, query: Record<string, string | number>): Promise<RingCentralResult<T>> {
  try {
    const sdk = await getAuthenticatedSdk()
    const response = await withTimeout(sdk.get(path, query) as Promise<Response>)
    if (!response.ok) {
      const details = await readUpstreamError(null, response)
      logRingCentralError(`GET ${path}`, details)
      if (response.status === 429) return { ok: false, status: 429, message: 'RingCentral is receiving too many requests. Please retry shortly.' }
      if (response.status === 401 || response.status === 403) {
        ringCentralSdk = null
        ringCentralLogin = null
        return { ok: false, status: response.status, message: response.status === 403
          ? 'The RingCentral application lacks permission for this resource.'
          : 'RingCentral authentication failed. Check the JWT credential and application configuration.',
          ...details,
        }
      }
      return {
        ok: false,
        status: response.status >= 500 ? 502 : response.status,
        message: details.message ?? 'RingCentral could not complete the request. Please retry.',
        ...details,
      }
    }
    return { ok: true, data: await response.json() as T }
  } catch (error) {
    if (error instanceof RingCentralConfigurationError) {
      return { ok: false, status: 503, code: 'RC_NOT_CONFIGURED', message: error.message }
    }
    if (error instanceof Error && error.message.includes('timed out')) {
      return { ok: false, status: 504, code: 'RC_TIMEOUT', message: 'RingCentral did not respond in time. Please retry.' }
    }
    const details = await readUpstreamError(error)
    logRingCentralError(`GET ${path}`, details)
    ringCentralSdk = null
    ringCentralLogin = null
    return {
      ok: false,
      status: details.upstreamStatus && details.upstreamStatus >= 500 ? 502 : (details.upstreamStatus ?? 502),
      code: details.errorCode ?? 'RC_UNAVAILABLE',
      message: details.message ?? 'RingCentral authentication or service is unavailable. Please retry.',
      ...details,
    }
  }
}

export async function ringCentralPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<RingCentralResult<T>> {
  try {
    const sdk = await getAuthenticatedSdk()
    const response = await withTimeout(sdk.post(path, body) as Promise<Response>)
    if (!response.ok) {
      const details = await readUpstreamError(null, response)
      logRingCentralError(`POST ${path}`, details)
      if (response.status === 429) {
        return {
          ok: false,
          status: 429,
          message: details.message ?? 'RingCentral is receiving too many requests. Please retry shortly.',
          ...details,
        }
      }
      if (response.status === 401 || response.status === 403) {
        ringCentralSdk = null
        ringCentralLogin = null
        return {
          ok: false,
          status: response.status,
          message: response.status === 403
            ? 'The RingCentral application cannot start outbound calls.'
            : 'RingCentral authentication failed. Check the JWT credential and application configuration.',
          ...details,
        }
      }
      return {
        ok: false,
        status: response.status >= 500 ? 502 : response.status,
        message: details.message ?? 'RingCentral could not start the call. Please retry.',
        ...details,
      }
    }
    return { ok: true, data: await response.json() as T }
  } catch (error) {
    if (error instanceof RingCentralConfigurationError) {
      return { ok: false, status: 503, code: 'RC_NOT_CONFIGURED', message: error.message }
    }
    if (error instanceof Error && error.message.includes('timed out')) {
      return { ok: false, status: 504, code: 'RC_TIMEOUT', message: 'RingCentral did not respond in time. Please retry.' }
    }
    const details = await readUpstreamError(error)
    logRingCentralError(`POST ${path}`, details)
    ringCentralSdk = null
    ringCentralLogin = null
    return {
      ok: false,
      status: details.upstreamStatus && details.upstreamStatus >= 500 ? 502 : (details.upstreamStatus ?? 502),
      code: details.errorCode ?? 'RC_UNAVAILABLE',
      message: details.message ?? 'RingCentral could not start the call. Please retry.',
      ...details,
    }
  }
}

export function parsePositiveInteger(value: string | null, fallback: number, max = MAX_PAGE_SIZE) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return Math.min(parsed, max)
}
