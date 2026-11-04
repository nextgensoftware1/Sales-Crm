'use client'

export type RingCentralCallSnapshot = {
  adapterReady: boolean
  loggedIn: boolean
  webPhoneConnected: boolean
  hasOutboundPermission: boolean | undefined
  loginNumber?: string
  busy: boolean
  callStatus: string
  fallbackPhone?: string
}

type Subscriber = (snapshot: RingCentralCallSnapshot) => void

const CALL_TIMEOUT_MS = 25_000
const RINGOUT_TIMEOUT_MS = 15_000

class RingCentralCallManager {
  private snapshot: RingCentralCallSnapshot = {
    adapterReady: false,
    loggedIn: false,
    webPhoneConnected: false,
    hasOutboundPermission: undefined,
    busy: false,
    callStatus: 'Initializing RingCentral...',
  }
  private subscribers = new Set<Subscriber>()
  private transactionId: string | null = null
  private transactionTimeout: ReturnType<typeof setTimeout> | null = null
  private ringOutAbort: AbortController | null = null
  private attached = false
  private messageHandler: ((event: MessageEvent) => void) | null = null

  subscribe = (subscriber: Subscriber) => {
    this.subscribers.add(subscriber)
    subscriber(this.snapshot)
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  getSnapshot = () => this.snapshot

  private emit(patch: Partial<RingCentralCallSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const subscriber of this.subscribers) subscriber(this.snapshot)
  }

  attach() {
    if (this.attached || typeof window === 'undefined') return
    this.attached = true
    this.messageHandler = (event: MessageEvent) => {
      if (event.origin !== 'https://apps.ringcentral.com') return
      this.ingestAdapterMessage(event.data)
    }
    window.addEventListener('message', this.messageHandler)
    window.addEventListener('pagehide', this.clearPendingTransaction)
  }

  detach() {
    if (!this.attached || typeof window === 'undefined') return
    if (this.messageHandler) window.removeEventListener('message', this.messageHandler)
    window.removeEventListener('pagehide', this.clearPendingTransaction)
    this.attached = false
    this.clearPendingTransaction()
  }

  private clearPendingTransaction = () => {
    if (this.transactionTimeout) {
      clearTimeout(this.transactionTimeout)
      this.transactionTimeout = null
    }
    this.ringOutAbort?.abort()
    this.ringOutAbort = null
    this.transactionId = null
    this.emit({ busy: false })
  }

  setAdapterReady(adapterReady: boolean) {
    this.emit({
      adapterReady,
      callStatus: adapterReady ? 'RingCentral adapter ready' : 'RingCentral adapter unavailable',
    })
  }

  setCallStatus(callStatus: string) {
    this.emit({ callStatus })
  }

  ingestAdapterMessage(data: unknown) {
    if (!data || typeof data !== 'object' || typeof (data as { type?: unknown }).type !== 'string') return
    const message = data as Record<string, unknown>

    if (message.type === 'rc-login-status-notify') {
      const loggedIn = message.loggedIn === true
      const loginNumber = typeof message.loginNumber === 'string' ? message.loginNumber : undefined
      this.emit({ loggedIn, loginNumber, callStatus: loggedIn ? 'RingCentral signed in' : 'Sign in to your RingCentral account' })
      window.dispatchEvent(new CustomEvent('ringcentral-employee-status', { detail: { loggedIn, loginNumber } }))
    } else if (message.type === 'rc-webphone-connection-status-notify') {
      const webPhoneConnected = message.connectionStatus === 'connectionStatus-connected'
      this.emit({
        webPhoneConnected,
        callStatus: webPhoneConnected ? 'RingCentral phone connected' : 'RingCentral phone disconnected',
      })
      window.dispatchEvent(new CustomEvent('ringcentral-employee-status', { detail: { webPhoneConnected } }))
    } else if (message.type === 'rc-calling-settings-notify') {
      const callWith = typeof message.callWith === 'string' ? message.callWith : undefined
      const fromNumbers = Array.isArray(message.fromNumbers) ? message.fromNumbers : []
      const hasOutboundPermission = Boolean(callWith || fromNumbers.length > 0)
      this.emit({ hasOutboundPermission })
      window.dispatchEvent(new CustomEvent('ringcentral-employee-status', { detail: { callWith, hasOutboundPermission } }))
    } else if (message.type === 'rc-call-init-notify') {
      this.emit({ callStatus: 'Calling...' })
      window.dispatchEvent(new CustomEvent('ringcentral-call-status', { detail: { status: 'Calling' } }))
    } else if (message.type === 'rc-call-start-notify') {
      this.emit({ callStatus: 'Call started' })
      window.dispatchEvent(new CustomEvent('ringcentral-call-status', { detail: { status: 'Call started' } }))
    } else if (message.type === 'rc-call-end-notify') {
      this.completeTransaction('Call ended')
    } else if (message.type === 'rc-adapter-error' || message.type === 'rc-call-failed-notify') {
      this.failTransaction('Call failed: RingCentral could not complete the call.')
    }
  }

  private completeTransaction(callStatus: string) {
    if (this.transactionTimeout) clearTimeout(this.transactionTimeout)
    this.transactionTimeout = null
    this.transactionId = null
    this.emit({ busy: false, callStatus })
    window.dispatchEvent(new CustomEvent('ringcentral-call-status', { detail: { status: callStatus } }))
  }

  private failTransaction(callStatus: string) {
    if (this.transactionTimeout) clearTimeout(this.transactionTimeout)
    this.transactionTimeout = null
    this.transactionId = null
    this.emit({ busy: false, callStatus })
    window.dispatchEvent(new CustomEvent('ringcentral-call-status', { detail: { status: callStatus } }))
  }

  async initiate(phoneNumber: string): Promise<boolean> {
    if (this.transactionId || this.snapshot.busy) return false
    const digits = phoneNumber.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) {
      this.emit({ callStatus: 'Call failed: enter a valid destination phone number.' })
      return false
    }
    const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+${digits}`

    if (!this.snapshot.adapterReady || typeof window.RCAdapter?.clickToCall !== 'function') {
      this.emit({ fallbackPhone: e164, callStatus: 'Call failed: RingCentral Embeddable is not ready. Use RingOut fallback.' })
      return false
    }
    if (!this.snapshot.loggedIn) {
      this.emit({ fallbackPhone: e164, callStatus: 'Call failed: sign in to your RingCentral account in the embedded widget.' })
      return false
    }
    if (this.snapshot.hasOutboundPermission === false) {
      this.emit({ fallbackPhone: e164, callStatus: 'Call failed: no verified outbound calling configuration.' })
      return false
    }
    this.transactionId = `call-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.emit({ busy: true, fallbackPhone: e164, callStatus: `Calling ${e164}` })
    this.transactionTimeout = setTimeout(() => {
      this.failTransaction(`Call failed: no call status received within ${CALL_TIMEOUT_MS / 1000} seconds.`)
    }, CALL_TIMEOUT_MS)

    try {
      window.RCAdapter.clickToCall(e164, true)
      return true
    } catch {
      this.failTransaction(`Call failed: RingCentral could not start the call to ${e164}.`)
      return false
    }
  }

  async ringOutFallback(): Promise<boolean> {
    const phoneNumber = this.snapshot.fallbackPhone
    if (!phoneNumber || this.transactionId) return false
    this.transactionId = `ringout-${Date.now()}`
    this.ringOutAbort = new AbortController()
    const timeout = setTimeout(() => this.ringOutAbort?.abort(), RINGOUT_TIMEOUT_MS)
    this.emit({ busy: true, callStatus: `Calling ${phoneNumber} through RingOut fallback` })
    try {
      const response = await fetch('/api/ringcentral/dial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: this.ringOutAbort.signal,
        body: JSON.stringify({ phoneNumber }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        this.failTransaction(`Call failed: ${data.message || 'RingOut could not start the call.'}`)
        return false
      }
      this.completeTransaction(`Calling ${phoneNumber} through RingOut fallback`)
      return true
    } catch {
      this.failTransaction(`Call failed: RingOut timed out or could not be reached for ${phoneNumber}.`)
      return false
    } finally {
      clearTimeout(timeout)
      this.ringOutAbort = null
    }
  }
}

export const ringCentralCallManager = new RingCentralCallManager()
