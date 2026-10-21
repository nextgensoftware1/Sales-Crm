// Shared settings for Email leads (browser + server).

/** Responses an agent can record on an Email lead, in display order. */
export const EMAIL_RESPONSES = [
  'Not Found', 'Undeliverable', 'Unsubscribed', 'Email Sent', 'Got Reply',
  'Not Considerable', 'Not Interested', 'Invalid', 'Repetitive', 'Reachable',
] as const

/** Responses that need the email address that was used. */
export const EMAIL_REQUIRED_FOR = ['Email Sent', 'Got Reply', 'Undeliverable', 'Unsubscribed', 'Not Interested'] as const

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Badge colour class per response (existing .badge-* styles). */
export function emailResponseBadge(response: string): string {
  if (response === 'Got Reply' || response === 'Email Sent' || response === 'Reachable') return 'badge badge-green'
  if (response === 'Not Interested' || response === 'Unsubscribed' || response === 'Undeliverable' || response === 'Invalid') return 'badge badge-red'
  if (response === 'Not Considerable' || response === 'Repetitive') return 'badge badge-amber'
  return 'badge badge-grey'
}