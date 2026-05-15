
-- Atomic, channel-safe status transition for service_bookings.
-- Locks the row, validates that the caller's expected current status matches,
-- and that the new status is reachable from the current one.
CREATE OR REPLACE FUNCTION public.transition_service_booking_status(
  _booking_id uuid,
  _expected_status text,
  _new_status text,
  _patch jsonb DEFAULT '{}'::jsonb
)
RETURNS public.service_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.service_bookings;
  _allowed jsonb := jsonb_build_object(
    'pending',          jsonb_build_array('estimation_sent','confirmed','in_progress','cancelled'),
    'estimation_sent',  jsonb_build_array('confirmed','in_progress','cancelled','pending'),
    'confirmed',        jsonb_build_array('in_progress','ready_for_pickup','completed','cancelled'),
    'in_progress',      jsonb_build_array('ready_for_pickup','completed','cancelled'),
    'ready_for_pickup', jsonb_build_array('completed','cancelled'),
    'completed',        jsonb_build_array(),
    'cancelled',        jsonb_build_array()
  );
BEGIN
  SELECT * INTO _row FROM public.service_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found', _booking_id USING ERRCODE = 'no_data_found';
  END IF;

  IF _expected_status IS NOT NULL
     AND _row.status::text <> _expected_status THEN
    RAISE EXCEPTION 'Stale status: expected % but row is %', _expected_status, _row.status
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF _row.status::text = _new_status THEN
    -- Idempotent no-op transition; still apply patch fields.
    NULL;
  ELSIF NOT (_allowed -> _row.status::text) ? _new_status THEN
    RAISE EXCEPTION 'Illegal transition % -> %', _row.status, _new_status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.service_bookings
     SET status = _new_status::public.service_status,
         estimate_amount = COALESCE((_patch->>'estimate_amount')::numeric, estimate_amount),
         estimated_cost  = COALESCE((_patch->>'estimated_cost')::numeric, estimated_cost),
         total_amount    = COALESCE((_patch->>'total_amount')::numeric, total_amount),
         work_notes      = COALESCE(_patch->>'work_notes', work_notes),
         parts_required  = COALESCE(_patch->>'parts_required', parts_required),
         approval_status = COALESCE(_patch->>'approval_status', approval_status),
         estimation_sent_at = COALESCE((_patch->>'estimation_sent_at')::timestamptz, estimation_sent_at),
         ready_at        = COALESCE((_patch->>'ready_at')::timestamptz, ready_at),
         updated_at      = now()
   WHERE id = _booking_id
   RETURNING * INTO _row;

  RETURN _row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_service_booking_status(uuid, text, text, jsonb)
  TO authenticated, service_role, anon;
