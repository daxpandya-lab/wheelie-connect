
CREATE OR REPLACE FUNCTION public.log_service_booking_approval_change()
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
  _prev := COALESCE(OLD.customer_approval_status, '');
  _new := COALESCE(NEW.customer_approval_status, '');

  IF _prev IS NOT DISTINCT FROM _new THEN
    RETURN NEW;
  END IF;

  _event := CASE _new
    WHEN 'approved'       THEN 'approval_approved'
    WHEN 'rejected'       THEN 'approval_rejected'
    WHEN 'call_requested' THEN 'approval_call_requested'
    WHEN 'pending_approval' THEN 'approval_reset'
    ELSE 'approval_changed'
  END;

  _source := COALESCE(NULLIF(NEW.metadata->>'approval_source',''), NEW.booking_source, 'manual');
  _flow_id := NULLIF(NEW.metadata->>'flow_id','')::uuid;

  INSERT INTO public.service_booking_audit_logs
    (tenant_id, booking_id, event, previous_status, new_status, source, flow_id, actor_user_id, metadata)
  VALUES
    (NEW.tenant_id, NEW.id, _event, NULLIF(_prev,''), NULLIF(_new,''), _source, _flow_id, auth.uid(),
     jsonb_build_object(
       'customer_name', NEW.customer_name,
       'phone_number', NEW.phone_number,
       'channel', CASE
         WHEN NEW.booking_source ILIKE '%whatsapp%' THEN 'whatsapp_webhook'
         WHEN NEW.booking_source ILIKE '%chatbot%'  THEN 'chatbot_web'
         ELSE NEW.booking_source
       END
     ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_service_booking_approval_change ON public.service_bookings;
CREATE TRIGGER trg_log_service_booking_approval_change
AFTER UPDATE OF customer_approval_status ON public.service_bookings
FOR EACH ROW
EXECUTE FUNCTION public.log_service_booking_approval_change();
