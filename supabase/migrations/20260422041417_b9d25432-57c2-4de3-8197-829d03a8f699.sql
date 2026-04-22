-- Function callable by anon to check booking availability for a tenant on a specific date.
-- Counts service_bookings + test_drive_bookings (excluding cancelled service bookings).
CREATE OR REPLACE FUNCTION public.check_booking_availability(
  _tenant_id uuid,
  _date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _service_count int;
  _testdrive_count int;
  _total int;
  _limit int;
  _settings jsonb;
BEGIN
  -- Tenant must exist & be active
  SELECT settings INTO _settings
  FROM public.tenants
  WHERE id = _tenant_id AND status = 'active';

  IF _settings IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'tenant_inactive', 'count', 0, 'limit', 0);
  END IF;

  _limit := COALESCE(NULLIF(_settings ->> 'max_vehicles_per_day', '')::int, 0);

  SELECT COUNT(*) INTO _service_count
  FROM public.service_bookings
  WHERE tenant_id = _tenant_id
    AND booking_date = _date
    AND status <> 'cancelled';

  SELECT COUNT(*) INTO _testdrive_count
  FROM public.test_drive_bookings
  WHERE tenant_id = _tenant_id
    AND preferred_date = _date
    AND status <> 'cancelled';

  _total := _service_count + _testdrive_count;

  -- limit = 0 means no limit configured -> always available
  RETURN jsonb_build_object(
    'available', (_limit = 0 OR _total < _limit),
    'count', _total,
    'limit', _limit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_booking_availability(uuid, date) TO anon, authenticated;