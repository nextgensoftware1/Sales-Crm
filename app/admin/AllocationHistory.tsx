'use client'

import { useEffect, useState } from 'react'
import { getAllocationHistory } from './allocation-history-actions'

export default function AllocationHistory() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getAllocationHistory>> | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    getAllocationHistory().then(data => { if (!cancelled) setRows(data) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [attempt])
  return <div className="card">
    <h2 className="h-section">Allocation History{rows ? ` (${rows.length})` : ''}</h2>
    {error ? <p role="alert">Could not load allocation history. <button className="btn" onClick={() => { setError(false); setAttempt(n => n + 1) }}>Retry</button></p>
      : !rows ? <p role="status">Loading allocation history…</p>
      : !rows.length ? <p className="subtle">No allocations yet.</p>
      : <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Date</th><th>Time</th><th>Practice</th><th>Allocated To</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row, index) => {
          const date = new Date(row.allocatedAt)
          return <tr key={index}>
            <td>{date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</td>
            <td>{date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
            <td>{row.practice}</td><td><strong>{row.company}</strong></td><td>{row.status}</td>
          </tr>
        })}</tbody>
      </table></div>}
  </div>
}
