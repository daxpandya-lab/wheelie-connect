-- 1. Metadata JSONB columns for dynamic data capture from chatbot flows
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.test_drive_bookings ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- GIN indexes for fast key discovery and filtering
CREATE INDEX IF NOT EXISTS idx_leads_metadata_gin ON public.leads USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_service_bookings_metadata_gin ON public.service_bookings USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_test_drive_bookings_metadata_gin ON public.test_drive_bookings USING GIN (metadata);

-- 2. Active flow per tenant tracked on chatbot_flows.is_active (already exists). Add a unique partial index so only one active flow per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_flow_per_tenant
  ON public.chatbot_flows (tenant_id) WHERE is_active = true;

-- 3. Notification trigger when a lead is assigned (insert with assigned_to OR update that changes assigned_to)
CREATE OR REPLACE FUNCTION public.notify_on_lead_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)) THEN
    INSERT INTO public.notifications (tenant_id, user_id, title, message, type, source, source_id)
    VALUES (
      NEW.tenant_id,
      NEW.assigned_to,
      'New lead assigned',
      'You have been assigned: ' || COALESCE(NEW.customer_name, 'a new lead'),
      'info',
      'lead',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_lead_assignment ON public.leads;
CREATE TRIGGER trg_notify_on_lead_assignment
AFTER INSERT OR UPDATE OF assigned_to ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_lead_assignment();

-- 4. Realtime for notifications (so the bell updates live)
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;