'use client'

import { useEffect } from 'react'
import { ringCentralCallManager } from '../lib/ringcentral-call-manager'

const ADAPTER_SCRIPT_ID = 'ringcentral-embeddable-adapter'
const ADAPTER_SCRIPT_URL = 'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js'

declare global {
  interface Window {
    RC_EMBEDDABLE_ADAPTER_MANUAL_INIT?: boolean
    RCAdapter?: {
      clickToCall: (phoneNumber: string, toCall?: boolean) => unknown
      dispose?: () => void
    }
    RCAdapterInit?: () => void
    RCAdapterDisposed?: boolean
    __ringCentralEmployeeStatus?: {
      loggedIn?: boolean
      webPhoneConnected?: boolean
      loginNumber?: string
      callWith?: string
      hasOutboundPermission?: boolean
    }
  }
}

export type RingCentralEmployeeStatus = {
  adapterReady: boolean
  loggedIn: boolean
  loginNumber?: string
  webPhoneConnected: boolean
  callStatus: string
}

export default function RingCentralEmbeddable() {
  useEffect(() => {
    window.RC_EMBEDDABLE_ADAPTER_MANUAL_INIT = true
    ringCentralCallManager.attach()
    let observer: MutationObserver | null = null

    const hideAdapterWidget = () => {
      const frame = document.querySelector<HTMLIFrameElement>('#rc-widget-adapter-frame')
      if (frame) {
        frame.style.display = 'none'
        observer?.disconnect()
        observer = null
      }
    }

    const initialize = () => {
      if (!window.RCAdapter && typeof window.RCAdapterInit === 'function') {
        window.RCAdapterInit()
      }
      ringCentralCallManager.setAdapterReady(typeof window.RCAdapter?.clickToCall === 'function')
      hideAdapterWidget()
      observer = new MutationObserver(hideAdapterWidget)
      observer.observe(document.body, { childList: true, subtree: true })
    }

    let script = document.getElementById(ADAPTER_SCRIPT_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = ADAPTER_SCRIPT_ID
      script.src = ADAPTER_SCRIPT_URL
      script.async = true
      script.onload = initialize
      document.body.appendChild(script)
    } else if (window.RCAdapter || typeof window.RCAdapterInit === 'function') {
      initialize()
    } else {
      script.addEventListener('load', initialize, { once: true })
    }

    return () => observer?.disconnect()
  }, [])

  return null
}
