-- =========================================================
-- Booking reminder rules + scheduled reminders
-- =========================================================
CREATE TABLE public.booking_reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_type text NOT NULL CHECK (booking_type IN ('service', 'test_drive')),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- Offset: positive = after the anchor, negative = before the anchor
  offset_days integer NOT NULL,
  -- Which date the offset is applied to
  anchor text NOT NULL DEFAULT 'booking_date'
    CHECK (anchor IN ('booking_date', 'created_at')),
  -- Local send time, e.g. '10:00:00' (interpreted in tenant settings.timezone if set, else UTC)
  send_time_of_day time NOT NULL DEFAULT '10:00:00',
  template_name text,
  message_body text,
  -- If the booking moves to one of these statuses, skip pending reminders
  stop_on_statuses text[] NOT NULL DEFAULT ARRAY['cancelled','completed']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (template_name IS NOT NULL OR message_body IS NOT NULL)
);

CREATE INDEX idx_brr_tenant_type_enabled
  ON public.booking_reminder_rules (tenant_id, booking_type, enabled);

ALTER TABLE public.booking_reminder_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view own reminder rules"
ON public.booking_reminder_rules FOR SELECT TO authenticated
USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Active tenant users can insert reminder rules"
ON public.booking_reminder_rules FOR INSERT TO authenticated
WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

CREATE POLICY "Active tenant users can update reminder rules"
ON public.booking_reminder_rules FOR UPDATE TO authenticated
USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

CREATE POLICY "Tenant users can delete reminder rules"
ON public.booking_reminder_rules FOR DELETE TO authenticated
USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Service role full access on booking_reminder_rules"
ON public.booking_reminder_rules FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_brr_updated_at
BEFORE UPDATE ON public.booking_reminder_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Scheduled reminder rows
-- =========================================================
CREATE TABLE public.booking_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.booking_reminder_rules(id) ON DELETE CASCADE,
  booking_type text NOT NULL CHECK (booking_type IN ('service', 'test_drive')),
  booking_id uuid NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','skipped','failed','cancelled')),
  recipient_phone text NOT NULL,
  rendered_body text,
  queue_message_id uuid REFERENCES public.whatsapp_message_queue(id) ON DELETE SET NULL,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, booking_id)
);

CREATE INDEX idx_br_due
  ON public.booking_reminders (status, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX idx_br_tenant_type
  ON public.booking_reminders (tenant_id, booking_type);
CREATE INDEX idx_br_booking
  ON public.booking_reminders (booking_type, booking_id);

ALTER TABLE public.booking_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view own reminders"
ON public.booking_reminders FOR SELECT TO authenticated
USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Service role full access on booking_reminders"
ON public.booking_reminders FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_br_updated_at
BEFORE UPDATE ON public.booking_reminders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Schedule helper: (re)compute reminders for a booking
-- =========================================================
CREATE OR REPLACE FUNCTION public.schedule_booking_reminders(
  _tenant_id uuid,
  _booking_type text,
  _booking_id uuid,
  _phone text,
  _booking_date date,
  _created_at timestamptz,
  _status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rule record;
  _anchor_date date;
  _scheduled timestamptz;
BEGIN
  IF _phone IS NULL OR length(btrim(_phone)) = 0 THEN
    RETURN;
  END IF;

  FOR _rule IN
    SELECT * FROM public.booking_reminder_rules
    WHERE tenant_id = _tenant_id
      AND booking_type = _booking_type
      AND enabled = true
  LOOP
    -- Skip when booking already in stop status
    IF _status = ANY(_rule.stop_on_statuses) THEN
      CONTINUE;
    END IF;

    _anchor_date := CASE
      WHEN _rule.anchor = 'created_at' THEN (_created_at AT TIME ZONE 'UTC')::date
      ELSE _booking_date
    END;

    IF _anchor_date IS NULL THEN
      CONTINUE;
    END IF;

    _scheduled := ((_anchor_date + (_rule.offset_days || ' days')::interval)::date
                   + _rule.send_time_of_day) AT TIME ZONE 'UTC';

    INSERT INTO public.booking_reminders
      (tenant_id, rule_id, booking_type, booking_id, scheduled_for,
       status, recipient_phone)
    VALUES
      (_tenant_id, _rule.id, _booking_type, _booking_id, _scheduled,
       'pending', _phone)
    ON CONFLICT (rule_id, booking_id) DO UPDATE
      SET scheduled_for = EXCLUDED.scheduled_for,
          recipient_phone = EXCLUDED.recipient_phone,
          status = CASE
            WHEN public.booking_reminders.status IN ('sent','skipped','failed','cancelled')
              THEN public.booking_reminders.status
            ELSE 'pending'
          END,
          updated_at = now();
  END LOOP;
END;
$$;

-- =========================================================
-- Triggers on bookings to schedule + cancel reminders
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_service_booking_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.schedule_booking_reminders(
    NEW.tenant_id, 'service', NEW.id, NEW.phone_number,
    NEW.booking_date, NEW.created_at, NEW.status::text
  );

  -- Cancel pending reminders if booking moved to a stop status
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.booking_reminders br
    SET status = 'cancelled', updated_at = now()
    FROM public.booking_reminder_rules r
    WHERE br.booking_type = 'service'
      AND br.booking_id = NEW.id
      AND br.status = 'pending'
      AND br.rule_id = r.id
      AND NEW.status::text = ANY(r.stop_on_statuses);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_test_drive_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.schedule_booking_reminders(
    NEW.tenant_id, 'test_drive', NEW.id, NEW.phone_number,
    NEW.preferred_date, NEW.created_at, NEW.status::text
  );

  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.booking_reminders br
    SET status = 'cancelled', updated_at = now()
    FROM public.booking_reminder_rules r
    WHERE br.booking_type = 'test_drive'
      AND br.booking_id = NEW.id
      AND br.status = 'pending'
      AND br.rule_id = r.id
      AND NEW.status::text = ANY(r.stop_on_statuses);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_service_booking_reminders
AFTER INSERT OR UPDATE OF booking_date, status, phone_number
ON public.service_bookings
FOR EACH ROW EXECUTE FUNCTION public.handle_service_booking_reminders();

CREATE TRIGGER trg_test_drive_reminders
AFTER INSERT OR UPDATE OF preferred_date, status, phone_number
ON public.test_drive_bookings
FOR EACH ROW EXECUTE FUNCTION public.handle_test_drive_reminders();

-- When a rule changes, refresh existing pending reminders for that rule
CREATE OR REPLACE FUNCTION public.handle_reminder_rule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.booking_reminders
       SET status = 'cancelled', updated_at = now()
     WHERE rule_id = OLD.id AND status = 'pending';
    RETURN OLD;
  END IF;

  IF NOT NEW.enabled THEN
    UPDATE public.booking_reminders
       SET status = 'cancelled', updated_at = now()
     WHERE rule_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brr_propagate
AFTER UPDATE OR DELETE ON public.booking_reminder_rules
FOR EACH ROW EXECUTE FUNCTION public.handle_reminder_rule_change();

-- =========================================================
-- Seed default reminders for existing tenants
-- (1 day before booking_date + 1 day after booking_date)
-- =========================================================
INSERT INTO public.booking_reminder_rules
  (tenant_id, booking_type, name, offset_days, anchor, send_time_of_day, message_body)
SELECT t.id, bt.btype, bt.name, bt.offset_days, 'booking_date', '10:00:00', bt.body
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('service', 'Day-before service reminder', -1,
     'Hi! This is a reminder of your service booking with us tomorrow. Reply if you need to reschedule.'),
    ('service', 'Day-after service follow-up', 1,
     'Hi! Hope your recent service went well. Please let us know if there is anything else we can help with.'),
    ('test_drive', 'Day-before test drive reminder', -1,
     'Hi! Looking forward to your test drive with us tomorrow. Reply if you need to reschedule.'),
    ('test_drive', 'Day-after test drive follow-up', 1,
     'Hi! Thanks for taking a test drive with us. Any questions we can help with?')
) AS bt(btype, name, offset_days, body)
ON CONFLICT DO NOTHING;