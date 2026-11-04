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

  const normalizeDigits = phoneNumber?.replace(/\D/g, '') ?? ''
  const fallbackMatches = callState.fallbackPhone
    ? callState.fallbackPhone.replace(/\D/g, '') === normalizeDigits
      || (normalizeDigits.length === 10 && callState.fallbackPhone === `+1${normalizeDigits}`)
      || (normalizeDigits.length === 11 && normalizeDigits.startsWith('1') && callState.fallbackPhone === `+${normalizeDigits}`)
    : false

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
      {fallbackMatches && callState.fallbackPhone && (
        <button
          type="button"
          onClick={() => void ringCentralCallManager.ringOutFallback()}
          disabled={callState.busy}
          style={{ border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 11, textDecoration: 'underline', cursor: callState.busy ? 'default' : 'pointer' }}
          title="Manual legacy fallback. Do not use together with Embeddable."
        >
          RingOut fallback
        </button>
      )}
    </span>
  )
}
