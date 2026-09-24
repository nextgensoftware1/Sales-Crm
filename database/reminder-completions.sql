-- Required once for persisted reminder completion history.
ALTER TABLE public.lead_reminders
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_lead_reminders_completed_at
  ON public.lead_reminders (completed_at DESC)
  WHERE done = true;
