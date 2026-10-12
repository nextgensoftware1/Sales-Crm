-- Reminders follow the LATEST callback, and working a lead clears its reminder.
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
--
-- Problem: an agent sets a callback, then on the callback day works the lead
-- again and sets a NEW callback date. The CRM kept the first reminder too,
-- so after the first date passed the lead showed up in Overdue even though
-- the agent had already worked it and rescheduled.
--
-- New rules (per lead, per company):
--   1. Setting a new callback closes the previous active reminder (it moves
--      to Completed / Completed Overdue as history, with the time it was
--      replaced) and the new date becomes the only Upcoming reminder.
--      Saving again with the SAME callback time just keeps the reminder.
--   2. Saving the worksheet WITHOUT a callback (e.g. Not Interested) means
--      the lead was worked: its active reminder is closed, so it never turns
--      Overdue.
--   3. A lead is Overdue only when its single active reminder's time has
--      passed and nobody has worked the lead since.
-- "Same lead" = same company + same practice code, so the Platform copy and
-- a company copy of one practice are treated as one lead within a company.
-- Nothing is deleted: closed reminders stay as history.

BEGIN;

ALTER TABLE public.lead_reminders ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.lead_reminders ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. Clean up existing data
-- ---------------------------------------------------------------------------

-- 1a. Several active reminders for one lead: keep the most recently set one.
--     The older ones are closed at the moment the newer one was set.
WITH active AS (
  SELECT r.id, r.tenant_id, mp.practice_code, r.created_at,
         lead(r.created_at) OVER (
           PARTITION BY r.tenant_id, mp.practice_code
           ORDER BY r.created_at NULLS FIRST, r.id
         ) AS replaced_at,
         row_number() OVER (
           PARTITION BY r.tenant_id, mp.practice_code
           ORDER BY r.created_at DESC NULLS LAST, r.id DESC
         ) AS newest_first
  FROM public.lead_reminders r
  JOIN public.master_practices mp ON mp.id = r.practice_id
  WHERE r.done IS NOT TRUE
)
UPDATE public.lead_reminders r
SET done = true,
    completed_at = COALESCE(a.replaced_at, now())
FROM active a
WHERE r.id = a.id AND a.newest_first > 1;

-- 1b. Lead worked after its reminder was set, without a new callback:
--     close the reminder at the time of that worksheet save.
UPDATE public.lead_reminders r
SET done = true,
    completed_at = w.updated_at
FROM public.master_practices rp, public.lead_worksheets w, public.master_practices wp
WHERE r.done IS NOT TRUE
  AND rp.id = r.practice_id
  AND w.tenant_id = r.tenant_id
  AND wp.id = w.practice_id
  AND wp.practice_code = rp.practice_code
  AND w.callback_at IS NULL
  AND w.updated_at > COALESCE(r.created_at, '-infinity'::timestamptz);

-- One active reminder per lead row per company (also existed before).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_reminders_one_active_per_company
  ON public.lead_reminders (practice_id, tenant_id)
  WHERE done IS NOT TRUE;

-- ---------------------------------------------------------------------------
-- 2. New callback replaces the previous active reminder (keeps history)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_active_lead_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_same_id uuid;
BEGIN
  IF NEW.done IS TRUE THEN RETURN NEW; END IF; -- inserting history, not a schedule

  SELECT practice_code INTO v_code FROM public.master_practices WHERE id = NEW.practice_id;

  -- Serialize scheduling for this lead/company (also closes a double-click race).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(COALESCE(v_code, NEW.practice_id::text) || ':' || NEW.tenant_id::text, 0)
  );

  -- Saved again with the same callback time: keep the reminder, refresh it.
  SELECT r.id INTO v_same_id
  FROM public.lead_reminders r
  WHERE r.practice_id = NEW.practice_id
    AND r.tenant_id = NEW.tenant_id
    AND r.done IS NOT TRUE
    AND date_trunc('minute', r.remind_at) = date_trunc('minute', NEW.remind_at)
  LIMIT 1;

  IF v_same_id IS NOT NULL THEN
    UPDATE public.lead_reminders
    SET agent_id = NEW.agent_id, note = NEW.note
    WHERE id = v_same_id;
    -- Close any other stray active reminder of the same lead.
    UPDATE public.lead_reminders r
    SET done = true, completed_at = now()
    FROM public.master_practices mp
    WHERE r.done IS NOT TRUE AND r.id <> v_same_id
      AND r.tenant_id = NEW.tenant_id
      AND mp.id = r.practice_id AND mp.practice_code = v_code;
    RETURN NULL; -- nothing new to insert
  END IF;

  -- A different time: close the previous reminder(s) as history...
  UPDATE public.lead_reminders r
  SET done = true, completed_at = now()
  FROM public.master_practices mp
  WHERE r.done IS NOT TRUE
    AND r.tenant_id = NEW.tenant_id
    AND mp.id = r.practice_id
    AND (mp.practice_code = v_code OR r.practice_id = NEW.practice_id);

  -- ...and insert the new one as the only active reminder.
  NEW.created_at := COALESCE(NEW.created_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_replace_active_lead_reminder ON public.lead_reminders;
CREATE TRIGGER trg_replace_active_lead_reminder
BEFORE INSERT ON public.lead_reminders
FOR EACH ROW
EXECUTE FUNCTION public.replace_active_lead_reminder();

-- ---------------------------------------------------------------------------
-- 3. Worksheet saved without a callback = lead worked: close its reminder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_reminder_when_worked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  -- Only a real save (new row or new updated_at), and only when no callback
  -- was set. A save WITH a callback is handled by the reminder trigger.
  IF NEW.callback_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN RETURN NEW; END IF;

  SELECT practice_code INTO v_code FROM public.master_practices WHERE id = NEW.practice_id;

  UPDATE public.lead_reminders r
  SET done = true, completed_at = COALESCE(NEW.updated_at, now())
  FROM public.master_practices mp
  WHERE r.done IS NOT TRUE
    AND r.tenant_id = NEW.tenant_id
    AND mp.id = r.practice_id
    AND (mp.practice_code = v_code OR r.practice_id = NEW.practice_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_reminder_when_worked ON public.lead_worksheets;
CREATE TRIGGER trg_close_reminder_when_worked
AFTER INSERT OR UPDATE ON public.lead_worksheets
FOR EACH ROW
EXECUTE FUNCTION public.close_reminder_when_worked();

COMMIT;

NOTIFY pgrst, 'reload schema';
