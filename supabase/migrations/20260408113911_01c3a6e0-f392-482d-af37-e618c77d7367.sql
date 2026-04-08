
-- Automation rules table
CREATE TABLE public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_event text NOT NULL, -- e.g. 'booking_created', 'lead_status_changed', 'campaign_replied'
  trigger_table text NOT NULL, -- e.g. 'service_bookings', 'leads'
  conditions jsonb NOT NULL DEFAULT '{}', -- e.g. {"status": "pending", "service_type": "repair"}
  actions jsonb NOT NULL DEFAULT '[]', -- e.g. [{"type": "notify", "to": "tenant_admin"}, {"type": "assign", "to_field": "assigned_to"}]
  is_active boolean NOT NULL DEFAULT true,
  execution_count integer NOT NULL DEFAULT 0,
  last_executed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_automation_rules_tenant ON public.automation_rules (tenant_id, is_active);
CREATE INDEX idx_automation_rules_trigger ON public.automation_rules (trigger_table, trigger_event);

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view own rules" ON public.automation_rules
  FOR SELECT TO authenticated USING (is_user_tenant(tenant_id) OR is_super_admin());
CREATE POLICY "Active tenant users can insert rules" ON public.automation_rules
  FOR INSERT TO authenticated WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());
CREATE POLICY "Active tenant users can update rules" ON public.automation_rules
  FOR UPDATE TO authenticated USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());
CREATE POLICY "Active tenant users can delete rules" ON public.automation_rules
  FOR DELETE TO authenticated USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());
CREATE POLICY "Service role full access on automation_rules" ON public.automation_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Automation execution logs
CREATE TABLE public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  trigger_event text NOT NULL,
  trigger_data jsonb,
  actions_executed jsonb,
  status text NOT NULL DEFAULT 'success', -- success, failed, skipped
  error_message text,
  execution_time_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_automation_logs_tenant ON public.automation_logs (tenant_id, created_at DESC);
CREATE INDEX idx_automation_logs_rule ON public.automation_logs (rule_id, created_at DESC);

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view own logs" ON public.automation_logs
  FOR SELECT TO authenticated USING (is_user_tenant(tenant_id) OR is_super_admin());
CREATE POLICY "Service role full access on automation_logs" ON public.automation_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info', -- info, warning, success, error
  source text, -- 'automation', 'system', 'campaign', 'booking'
  source_id uuid, -- reference to the triggering record
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_tenant ON public.notifications (tenant_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access on notifications" ON public.notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger function to fire automation engine on data changes
CREATE OR REPLACE FUNCTION public.trigger_automation_engine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant_id uuid;
  _event text;
  _rule record;
  _conditions_match boolean;
  _start_time timestamptz;
BEGIN
  _tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  
  IF TG_OP = 'INSERT' THEN
    _event := lower(TG_TABLE_NAME) || '_created';
  ELSIF TG_OP = 'UPDATE' THEN
    _event := lower(TG_TABLE_NAME) || '_updated';
  ELSIF TG_OP = 'DELETE' THEN
    _event := lower(TG_TABLE_NAME) || '_deleted';
  END IF;

  FOR _rule IN
    SELECT * FROM automation_rules
    WHERE tenant_id = _tenant_id
      AND trigger_table = TG_TABLE_NAME
      AND trigger_event = _event
      AND is_active = true
  LOOP
    _start_time := clock_timestamp();
    _conditions_match := true;

    -- Simple JSON condition matching against NEW row
    IF _rule.conditions IS NOT NULL AND _rule.conditions != '{}'::jsonb THEN
      DECLARE
        _key text;
        _val text;
      BEGIN
        FOR _key, _val IN SELECT * FROM jsonb_each_text(_rule.conditions)
        LOOP
          IF to_jsonb(NEW) ->> _key IS DISTINCT FROM _val THEN
            _conditions_match := false;
            EXIT;
          END IF;
        END LOOP;
      END;
    END IF;

    IF _conditions_match THEN
      -- Log execution
      INSERT INTO automation_logs (tenant_id, rule_id, trigger_event, trigger_data, actions_executed, status, execution_time_ms)
      VALUES (
        _tenant_id,
        _rule.id,
        _event,
        to_jsonb(NEW),
        _rule.actions,
        'success',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - _start_time)::integer
      );

      -- Create notifications for notify actions
      DECLARE
        _action jsonb;
        _notify_users uuid[];
      BEGIN
        FOR _action IN SELECT * FROM jsonb_array_elements(_rule.actions)
        LOOP
          IF _action->>'type' = 'notify' THEN
            -- Notify all tenant users with matching role
            INSERT INTO notifications (tenant_id, user_id, title, message, type, source, source_id)
            SELECT
              _tenant_id,
              ur.user_id,
              _rule.name,
              'Automation triggered: ' || _event || ' matched rule "' || _rule.name || '"',
              'info',
              'automation',
              _rule.id
            FROM user_roles ur
            WHERE ur.tenant_id = _tenant_id
              AND (
                _action->>'to' IS NULL
                OR _action->>'to' = 'all'
                OR ur.role::text = _action->>'to'
              );
          END IF;
        END LOOP;
      END;

      -- Update rule stats
      UPDATE automation_rules
      SET execution_count = execution_count + 1, last_executed_at = now()
      WHERE id = _rule.id;
    ELSE
      INSERT INTO automation_logs (tenant_id, rule_id, trigger_event, trigger_data, status, execution_time_ms)
      VALUES (_tenant_id, _rule.id, _event, to_jsonb(NEW), 'skipped',
        EXTRACT(MILLISECONDS FROM clock_timestamp() - _start_time)::integer);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Attach triggers to key tables
CREATE TRIGGER automation_service_bookings
  AFTER INSERT OR UPDATE ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION trigger_automation_engine();

CREATE TRIGGER automation_leads
  AFTER INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION trigger_automation_engine();

CREATE TRIGGER automation_test_drives
  AFTER INSERT OR UPDATE ON public.test_drive_bookings
  FOR EACH ROW EXECUTE FUNCTION trigger_automation_engine();

CREATE TRIGGER automation_customers
  AFTER INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION trigger_automation_engine();

CREATE TRIGGER automation_campaigns
  AFTER INSERT OR UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION trigger_automation_engine();
