
-- 1) Extend service_status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='estimation_sent' AND enumtypid='public.service_status'::regtype) THEN
    ALTER TYPE public.service_status ADD VALUE 'estimation_sent';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='ready_for_pickup' AND enumtypid='public.service_status'::regtype) THEN
    ALTER TYPE public.service_status ADD VALUE 'ready_for_pickup';
  END IF;
END $$;

-- 2) CSAT responses
CREATE TABLE IF NOT EXISTS public.csat_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  booking_type text NOT NULL DEFAULT 'service',
  rating int NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csat_rating_range CHECK (rating BETWEEN 1 AND 5)
);
ALTER TABLE public.csat_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users can view own csat" ON public.csat_responses;
CREATE POLICY "Tenant users can view own csat" ON public.csat_responses
  FOR SELECT TO authenticated
  USING (is_user_tenant(tenant_id) OR is_super_admin());

DROP POLICY IF EXISTS "Service role full access on csat" ON public.csat_responses;
CREATE POLICY "Service role full access on csat" ON public.csat_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Track whether CSAT has been sent for a booking
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS csat_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

-- 3) Storage bucket for invoices
INSERT INTO storage.buckets (id, name, public)
VALUES ('service_invoices','service_invoices', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read invoices" ON storage.objects;
CREATE POLICY "Public read invoices" ON storage.objects
  FOR SELECT USING (bucket_id = 'service_invoices');

DROP POLICY IF EXISTS "Service role write invoices" ON storage.objects;
CREATE POLICY "Service role write invoices" ON storage.objects
  FOR ALL TO service_role USING (bucket_id='service_invoices') WITH CHECK (bucket_id='service_invoices');

-- 4) Cron extensions for CSAT follow-up
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
