'use client'

import { useEffect, useState } from 'react'
import { PhoneCall } from 'lucide-react'
import { ringCentralCallManager, type RingCentralCallSnapshot } from '../lib/ringcentral-call-manager'

export default function RingCentralDialButton({
  phoneNumber,
  className,
  children,
}: {
  phoneNumber: string | null | undefined
  className?: string
  children?: React.ReactNode
}) {
  const [callState, setCallState] = useState<RingCentralCallSnapshot>(() => ringCentralCallManager.getSnapshot())

  useEffect(() => {
    return ringCentralCallManager.subscribe(setCallState)
  }, [])

  const dial = () => {
    if (!phoneNumber) return
    void ringCentralCallManager.initiate(phoneNumber)
  }

  if (!phoneNumber?.trim()) return <>{children ?? '—'}</>

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
      <button
        type="button"
        className={className}
        onClick={dial}
        disabled={callState.busy}
        title={`Call ${phoneNumber} with RingCentral`}
        aria-label={`Call ${phoneNumber} with RingCentral`}
        style={{
          appearance: 'none',
          border: 0,
          background: 'transparent',
          color: 'inherit',
          padding: 0,
          margin: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          font: 'inherit',
          minWidth: 0,
          textAlign: 'left',
        }}
      >
        <PhoneCall size={14} aria-hidden="true" />
        <span style={{ overflowWrap: 'anywhere' }}>{children ?? phoneNumber}</span>
      </button>
    </span>
  )
}
