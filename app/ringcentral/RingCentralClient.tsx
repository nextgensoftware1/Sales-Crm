'use client'

import { useCallback, useEffect, useState } from 'react'

type CallParty = { name: string | null; phoneNumber: string | null; extensionNumber: string | null }
type CallRecord = {
  id: string | null
  startTime: string | null
  duration: number | null
  type: string | null
  direction: string | null
  result: string | null
  from: CallParty
  to: CallParty
  extensionName: string | null
  extensionNumber: string | null
}
type Pagination = {
  page: number
  perPage: number
  totalPages: number | null
  totalElements: number | null
}

function isoDate(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function partyLabel(party: CallParty | null | undefined) {
  if (!party) return 'Unknown'
  return party.name || party.phoneNumber || (party.extensionNumber ? `Extension ${party.extensionNumber}` : 'Unknown')
}

export default function RingCentralClient() {
  const [from, setFrom] = useState(() => isoDate(-30))
  const [to, setTo] = useState(() => isoDate(0))
  const [direction, setDirection] = useState('')
  const [page, setPage] = useState(1)
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'checking' | 'connected' | 'configuration' | 'error'>('checking')

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/ringcentral/status', { cache: 'no-store' })
      const data = await response.json()
      setStatus(response.ok ? 'connected' : data.code === 'RC_NOT_CONFIGURED' ? 'configuration' : 'error')
    } catch {
      setStatus('error')
    }
  }, [])

  const loadCalls = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ from, to, page: String(page), perPage: '25' })
      if (direction) params.set('direction', direction)
      const response = await fetch(`/api/ringcentral/call-logs?${params}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not load call history.')
      setCalls(data.calls ?? [])
      setPagination(data.pagination ?? null)
    } catch (caught) {
      setCalls([])
      setPagination(null)
      setError(caught instanceof Error ? caught.message : 'Could not load call history.')
    } finally {
      setLoading(false)
    }
  }, [from, to, direction, page])

  useEffect(() => { void loadStatus() }, [loadStatus])
  useEffect(() => { void loadCalls() }, [loadCalls])

  const applyFilters = () => setPage(1)

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <strong>RingCentral connection</strong>
            <div className="subtle" style={{ marginTop: 4 }}>
              {status === 'checking' && 'Checking server-side configuration...'}
              {status === 'connected' && 'Connected to RingCentral'}
              {status === 'configuration' && 'Server configuration is incomplete'}
              {status === 'error' && 'RingCentral connection unavailable'}
            </div>
          </div>
          <button className="btn" type="button" onClick={() => { void loadStatus(); void loadCalls() }}>Retry</button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          <label><span className="subtle" style={{ display: 'block', marginBottom: 6 }}>From</span>
            <input className="input" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label><span className="subtle" style={{ display: 'block', marginBottom: 6 }}>To</span>
            <input className="input" type="date" value={to} min={from} max={isoDate(0)} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label><span className="subtle" style={{ display: 'block', marginBottom: 6 }}>Direction</span>
            <select className="input" value={direction} onChange={(event) => { setDirection(event.target.value); setPage(1) }}>
              <option value="">All calls</option>
              <option value="Inbound">Incoming</option>
              <option value="Outbound">Outgoing</option>
            </select>
          </label>
          <button className="btn btn-primary" style={{ alignSelf: 'end' }} type="button" onClick={applyFilters}>Apply filters</button>
        </div>

        {loading && <p className="subtle" role="status">Loading RingCentral call history...</p>}
        {!loading && error && <div role="alert"><p style={{ color: 'var(--danger)' }}>{error}</p></div>}
        {!loading && !error && calls.length === 0 && <p className="subtle">No call records were returned for this date range.</p>}

        {!loading && !error && calls.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ width: '100%' }}>
              <thead><tr><th>Started</th><th>Direction</th><th>From</th><th>To</th><th>Result</th><th>Duration</th><th>Extension</th></tr></thead>
              <tbody>
                {calls.map((call, index) => (
                  <tr key={call.id ?? `${call.startTime ?? 'call'}-${index}`}>
                    <td>{call.startTime ? new Date(call.startTime).toLocaleString() : 'Unknown'}</td>
                    <td>{call.direction ? call.direction[0].toUpperCase() + call.direction.slice(1) : 'Unknown'}</td>
                    <td>{partyLabel(call.from)}</td>
                    <td>{partyLabel(call.to)}</td>
                    <td>{call.result || 'Unknown'}</td>
                    <td>{typeof call.duration === 'number' ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : 'Unknown'}</td>
                    <td>{call.extensionName || call.extensionNumber || 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && pagination && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <button className="btn" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <span className="subtle">Page {pagination.page}{pagination.totalPages ? ` of ${pagination.totalPages}` : ''}</span>
            <button className="btn" type="button" disabled={pagination.totalPages !== null && page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
