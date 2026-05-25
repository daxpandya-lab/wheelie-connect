
CREATE TABLE public.service_booking_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  event text NOT NULL,
  previous_status text,
  new_status text,
  source text,
  flow_id uuid,
  actor_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_sbal_tenant ON public.service_booking_audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_sbal_booking ON public.service_booking_audit_logs (booking_id, created_at DESC);

ALTER TABLE public.service_booking_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view own audit logs"
  ON public.service_booking_audit_logs
  FOR SELECT TO authenticated
  USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Service role full access on sbal"
  ON public.service_booking_audit_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.log_service_booking_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event text;
  _prev text;
  _new text;
  _source text;
  _flow_id uuid;
BEGIN
  _new := NEW.status::text;
  _source := COALESCE(NEW.booking_source, 'manual');
  _flow_id := NULLIF(NEW.metadata->>'flow_id','')::uuid;

  IF TG_OP = 'INSERT' THEN
    _event := 'created';
    _prev := NULL;
  ELSE
    _prev := OLD.status::text;
    IF _prev IS NOT DISTINCT FROM _new THEN
      RETURN NEW;
    END IF;
    _event := CASE _new
      WHEN 'confirmed' THEN 'confirmed'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'completed' THEN 'completed'
      ELSE 'status_changed'
    END;
  END IF;

  INSERT INTO public.service_booking_audit_logs
    (tenant_id, booking_id, event, previous_status, new_status, source, flow_id, actor_user_id, metadata)
  VALUES
    (NEW.tenant_id, NEW.id, _event, _prev, _new, _source, _flow_id, auth.uid(),
     jsonb_build_object('customer_name', NEW.customer_name, 'phone_number', NEW.phone_number));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_service_booking_change ON public.service_bookings;
CREATE TRIGGER trg_log_service_booking_change
AFTER INSERT OR UPDATE OF status ON public.service_bookings
FOR EACH ROW EXECUTE FUNCTION public.log_service_booking_change();
