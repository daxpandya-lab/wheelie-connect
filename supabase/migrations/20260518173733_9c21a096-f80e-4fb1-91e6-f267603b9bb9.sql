
CREATE OR REPLACE FUNCTION public.seed_default_tenant_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _defaults jsonb := jsonb_build_object(
    'predictive_service_reminder', jsonb_build_object('enabled', true, 'interval_months', 6),
    'working_hours', jsonb_build_object(
      'start', '09:00',
      'end', '18:00',
      'days', jsonb_build_array('mon','tue','wed','thu','fri','sat')
    ),
    'max_vehicles_per_day', 10,
    'daily_booking_limit', 10,
    'advance_booking_days', 30,
    'holidays', '[]'::jsonb,
    'google_review_url', null,
    'manager_phone', null
  );
BEGIN
  -- Merge defaults UNDER any explicitly provided settings (provided values win)
  NEW.settings := _defaults || COALESCE(NEW.settings, '{}'::jsonb);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_default_tenant_settings_trigger ON public.tenants;
CREATE TRIGGER seed_default_tenant_settings_trigger
BEFORE INSERT ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.seed_default_tenant_settings();

-- Backfill existing tenants non-destructively
UPDATE public.tenants
SET settings = jsonb_build_object(
    'predictive_service_reminder', jsonb_build_object('enabled', true, 'interval_months', 6),
    'working_hours', jsonb_build_object(
      'start', '09:00',
      'end', '18:00',
      'days', jsonb_build_array('mon','tue','wed','thu','fri','sat')
    ),
    'max_vehicles_per_day', 10,
    'daily_booking_limit', 10,
    'advance_booking_days', 30,
    'holidays', '[]'::jsonb,
    'google_review_url', null,
    'manager_phone', null
  ) || COALESCE(settings, '{}'::jsonb);
