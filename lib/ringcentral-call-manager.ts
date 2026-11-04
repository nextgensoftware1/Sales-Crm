'use client'

export type RingCentralCallSnapshot = {
  adapterReady: boolean
  loggedIn: boolean
  webPhoneConnected: boolean
  hasOutboundPermission: boolean | undefined
  loginNumber?: string
  busy: boolean
  callStatus: string
}

type Subscriber = (snapshot: RingCentralCallSnapshot) => void

const CALL_TIMEOUT_MS = 12_000

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
  private callStarted = false
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
    this.transactionId = null
    this.callStarted = false
    this.emit({ busy: false })
  }

  setAdapterReady(adapterReady: boolean) {
    if (!adapterReady && this.transactionId) {
      this.failTransaction('Call failed: RingCentral adapter disconnected.')
      this.emit({ adapterReady: false })
      return
    }
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
      this.callStarted = true
      if (this.transactionTimeout) {
        clearTimeout(this.transactionTimeout)
        this.transactionTimeout = null
      }
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
    this.callStarted = false
    this.emit({ busy: false, callStatus })
    window.dispatchEvent(new CustomEvent('ringcentral-call-status', { detail: { status: callStatus } }))
  }

  private failTransaction(callStatus: string) {
    if (this.transactionTimeout) clearTimeout(this.transactionTimeout)
    this.transactionTimeout = null
    this.transactionId = null
    this.callStarted = false
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
      this.emit({ callStatus: 'Call failed: RingCentral adapter is not ready. Refresh the page and retry.' })
      return false
    }
    if (!this.snapshot.loggedIn) {
      this.emit({ callStatus: 'Call failed: sign in to your RingCentral account.' })
      return false
    }
    if (this.snapshot.hasOutboundPermission === false) {
      this.emit({ callStatus: 'Call failed: no verified outbound calling configuration.' })
      return false
    }
    this.transactionId = `call-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.callStarted = false
    this.emit({ busy: true, callStatus: `Calling ${e164}` })
    this.transactionTimeout = setTimeout(() => {
      if (this.callStarted) return
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
}

export const ringCentralCallManager = new RingCentralCallManager()
