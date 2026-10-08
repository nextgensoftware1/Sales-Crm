export const REMINDER_WARNING_MS = 8 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

type TimedReminder = { remindAt: string; done: boolean }

export function classifyReminderAttention<T extends TimedReminder>(reminders: T[], nowMs: number) {
  const active = reminders.filter((reminder) => !reminder.done)
  const overdue = active
    .filter((reminder) => +new Date(reminder.remindAt) < nowMs)
    .sort((a, b) => +new Date(a.remindAt) - +new Date(b.remindAt))
  const upcoming = active
    .filter((reminder) => +new Date(reminder.remindAt) >= nowMs)
    .sort((a, b) => +new Date(a.remindAt) - +new Date(b.remindAt))
  const nearDue = upcoming.filter((reminder) => +new Date(reminder.remindAt) - nowMs <= REMINDER_WARNING_MS)
  return { overdue, upcoming, nearDue }
}

export function getReminderNotificationSlot(remindAt: string, nowMs: number): string | null {
  const remaining = +new Date(remindAt) - nowMs
  // Toast notifications are only for upcoming reminders. Overdue reminders
  // remain visible in the bell and Overdue list without producing popups.
  if (remaining < 0) return null
  if (remaining === 0) return 'due-now'
  const hoursRemaining = Math.ceil(remaining / HOUR_MS)
  return hoursRemaining >= 1 && hoursRemaining <= 8 ? `hour-${hoursRemaining}` : null
}
