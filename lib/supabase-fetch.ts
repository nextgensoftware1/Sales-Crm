// Development-only timings: never log query strings, headers, IDs or payloads.
// Set CRM_PERF_LOG=0 to silence, or CRM_PERF_LOG=1 to enable in production.
export const timedSupabaseFetch: typeof fetch = async (input, init) => {
  if (process.env.CRM_PERF_LOG === '0' ||
      (process.env.NODE_ENV !== 'development' && process.env.CRM_PERF_LOG !== '1')) {
    return fetch(input, init)
  }
  const start = performance.now()
  let status = 'failed'
  try {
    const response = await fetch(input, init)
    status = String(response.status)
    return response
  } finally {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let label = 'request'
    try {
      const path = new URL(raw).pathname
      const match = path.match(/^\/(rest\/v1|auth\/v1)\/([a-z_]+)(?:\/([a-z_]+))?$/i)
      if (match) label = `${match[1]}/${match[2]}${match[2] === 'rpc' && match[3] ? `/${match[3]}` : ''}`
    } catch { /* Timing output must not interfere with the request. */ }
    console.info(`[crm:db] ${label} ${status} ${Math.round(performance.now() - start)}ms`)
  }
}
