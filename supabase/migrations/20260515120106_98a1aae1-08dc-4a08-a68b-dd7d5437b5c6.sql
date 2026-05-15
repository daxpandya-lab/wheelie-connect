-- Add completed_at and predictive_reminder_sent_at for 6-month follow-up
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS predictive_reminder_sent_at timestamptz;

-- Backfill completed_at for already-completed bookings (use updated_at as best guess)
UPDATE public.service_bookings
   SET completed_at = updated_at
 WHERE status = 'completed' AND completed_at IS NULL;

-- Trigger to set completed_at when status transitions to 'completed'
CREATE OR REPLACE FUNCTION public.set_service_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_service_completed_at ON public.service_bookings;
CREATE TRIGGER trg_set_service_completed_at
BEFORE INSERT OR UPDATE ON public.service_bookings
FOR EACH ROW EXECUTE FUNCTION public.set_service_completed_at();

CREATE INDEX IF NOT EXISTS idx_service_bookings_completed_at
  ON public.service_bookings (completed_at)
  WHERE completed_at IS NOT NULL AND predictive_reminder_sent_at IS NULL;