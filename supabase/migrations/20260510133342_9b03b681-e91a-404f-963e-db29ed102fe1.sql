
-- ============================================================
-- 1. Helper: detect "executive" users (staff role only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_executive_user()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'staff'::app_role)
    AND NOT public.has_role(auth.uid(), 'tenant_admin'::app_role)
    AND NOT public.has_role(auth.uid(), 'super_admin'::app_role)
$$;

-- ============================================================
-- 2. Helper: feature-toggle checks
-- ============================================================
CREATE OR REPLACE FUNCTION public.tenant_feature_enabled(_tenant_id uuid, _feature text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE _feature
    WHEN 'service_booking' THEN
      COALESCE((SELECT service_booking_enabled FROM public.tenants WHERE id = _tenant_id), true)
    WHEN 'test_drive' THEN
      COALESCE((SELECT test_drive_enabled FROM public.tenants WHERE id = _tenant_id), true)
    ELSE true
  END
$$;

-- ============================================================
-- 3. Vehicle-number normalizer (mirrors frontend regex)
--    /[\s.\-_/]/g  →  '' ; lowercased
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_vehicle_number(_v text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(COALESCE(_v, ''), '[\s.\-_/]', '', 'g'))
$$;

-- ============================================================
-- 4. RLS: service_bookings
--    Replace SELECT + UPDATE with executive-aware + feature-toggle aware policies.
-- ============================================================
DROP POLICY IF EXISTS "Tenant users can view own data" ON public.service_bookings;
CREATE POLICY "Tenant users can view own data"
ON public.service_bookings
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.is_user_tenant(tenant_id)
    AND public.tenant_feature_enabled(tenant_id, 'service_booking')
    AND (NOT public.is_executive_user() OR assigned_to = auth.uid())
  )
);

DROP POLICY IF EXISTS "Active tenant users can update own data" ON public.service_bookings;
CREATE POLICY "Active tenant users can update own data"
ON public.service_bookings
FOR UPDATE
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.is_user_tenant(tenant_id)
    AND public.is_tenant_id_active(tenant_id)
    AND public.tenant_feature_enabled(tenant_id, 'service_booking')
    AND (NOT public.is_executive_user() OR assigned_to = auth.uid())
  )
);

-- ============================================================
-- 5. RLS: test_drive_bookings
-- ============================================================
DROP POLICY IF EXISTS "Tenant users can view own data" ON public.test_drive_bookings;
CREATE POLICY "Tenant users can view own data"
ON public.test_drive_bookings
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.is_user_tenant(tenant_id)
    AND public.tenant_feature_enabled(tenant_id, 'test_drive')
    AND (NOT public.is_executive_user() OR assigned_to = auth.uid())
  )
);

DROP POLICY IF EXISTS "Tenant users can update own data" ON public.test_drive_bookings;
CREATE POLICY "Tenant users can update own data"
ON public.test_drive_bookings
FOR UPDATE
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.is_user_tenant(tenant_id)
    AND public.tenant_feature_enabled(tenant_id, 'test_drive')
    AND (NOT public.is_executive_user() OR assigned_to = auth.uid())
  )
);

-- ============================================================
-- 6. RLS: leads (no feature toggle, but executive isolation)
-- ============================================================
DROP POLICY IF EXISTS "Tenant users can view own data" ON public.leads;
CREATE POLICY "Tenant users can view own data"
ON public.leads
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.is_user_tenant(tenant_id)
    AND (NOT public.is_executive_user() OR assigned_to = auth.uid())
  )
);

DROP POLICY IF EXISTS "Active tenant users can update own data" ON public.leads;
CREATE POLICY "Active tenant users can update own data"
ON public.leads
FOR UPDATE
TO authenticated
USING (
  public.is_super_admin()
  OR (
    public.is_user_tenant(tenant_id)
    AND public.is_tenant_id_active(tenant_id)
    AND (NOT public.is_executive_user() OR assigned_to = auth.uid())
  )
);

-- ============================================================
-- 7. Backend validation: holidays + daily limit on every booking insert
--    Applies to manual (dashboard), chatbot, and any future API source.
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_booking_constraints()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _settings  jsonb;
  _holidays  jsonb;
  _date      date;
  _avail     jsonb;
  _max_days  int;
  _today     date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF TG_TABLE_NAME = 'service_bookings' THEN
    _date := NEW.booking_date;
  ELSIF TG_TABLE_NAME = 'test_drive_bookings' THEN
    _date := NEW.preferred_date;
  ELSE
    RETURN NEW;
  END IF;

  IF _date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Feature toggle: refuse insert if the tenant has disabled this booking type.
  IF TG_TABLE_NAME = 'service_bookings'
     AND NOT public.tenant_feature_enabled(NEW.tenant_id, 'service_booking') THEN
    RAISE EXCEPTION 'Service bookings are disabled for this dealership.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'test_drive_bookings'
     AND NOT public.tenant_feature_enabled(NEW.tenant_id, 'test_drive') THEN
    RAISE EXCEPTION 'Test drives are disabled for this dealership.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT settings INTO _settings FROM public.tenants WHERE id = NEW.tenant_id;
  IF _settings IS NULL THEN
    RETURN NEW;
  END IF;

  -- Holidays
  _holidays := _settings -> 'holidays';
  IF _holidays IS NOT NULL AND jsonb_typeof(_holidays) = 'array' THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(_holidays) h
      WHERE NULLIF(h, '')::date = _date
    ) THEN
      RAISE EXCEPTION 'The dealership is closed on % (holiday).', _date
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Advance booking window
  _max_days := NULLIF(_settings ->> 'advance_booking_days', '')::int;
  IF _max_days IS NOT NULL AND _max_days > 0 AND _date > _today + _max_days THEN
    RAISE EXCEPTION 'Booking date % is beyond the % day advance window.', _date, _max_days
      USING ERRCODE = 'check_violation';
  END IF;

  -- Daily vehicle limit (shared across service + test drives)
  _avail := public.check_booking_availability(NEW.tenant_id, _date);
  IF (_avail ->> 'available')::boolean = false
     AND COALESCE(_avail ->> 'reason', '') <> 'tenant_inactive' THEN
    RAISE EXCEPTION 'Daily vehicle limit reached for % (%/%).',
      _date, _avail ->> 'count', _avail ->> 'limit'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_service_booking_constraints ON public.service_bookings;
CREATE TRIGGER enforce_service_booking_constraints
BEFORE INSERT ON public.service_bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_constraints();

DROP TRIGGER IF EXISTS enforce_test_drive_constraints ON public.test_drive_bookings;
CREATE TRIGGER enforce_test_drive_constraints
BEFORE INSERT ON public.test_drive_bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_constraints();
