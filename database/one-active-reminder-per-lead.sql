-- Keep one active reminder per lead for each company.
-- Re-scheduling a follow-up updates the existing incomplete reminder while
-- completed reminders remain untouched as history.

BEGIN;

-- Existing duplicate active reminders are reduced to the latest scheduled one.
WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY practice_id, tenant_id
      ORDER BY remind_at DESC, id::text DESC
    ) AS position
  FROM public.lead_reminders
  WHERE done IS NOT TRUE
)
DELETE FROM public.lead_reminders reminders
USING ranked_active ranked
WHERE reminders.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_reminders_one_active_per_company
  ON public.lead_reminders (practice_id, tenant_id)
  WHERE done IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.replace_active_lead_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  -- Serialize reminder creation for this lead/company pair. This also closes
  -- the small race where two browser requests schedule at the same time.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.practice_id::text || ':' || NEW.tenant_id::text, 0)
  );

  SELECT id INTO v_existing_id
  FROM public.lead_reminders
  WHERE practice_id = NEW.practice_id
    AND tenant_id = NEW.tenant_id
    AND done IS NOT TRUE
  ORDER BY remind_at DESC, id::text DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.lead_reminders
    SET agent_id = NEW.agent_id,
        remind_at = NEW.remind_at,
        note = NEW.note,
        done = false,
        completed_at = NULL
    WHERE id = v_existing_id;

    -- Suppress the duplicate INSERT; the existing active row was updated.
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_replace_active_lead_reminder
  ON public.lead_reminders;

CREATE TRIGGER trg_replace_active_lead_reminder
BEFORE INSERT ON public.lead_reminders
FOR EACH ROW
EXECUTE FUNCTION public.replace_active_lead_reminder();

COMMIT;
