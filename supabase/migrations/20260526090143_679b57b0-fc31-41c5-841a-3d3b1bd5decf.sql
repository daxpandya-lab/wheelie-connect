
-- Parts suggestion library (per tenant)
CREATE TABLE IF NOT EXISTS public.parts_suggestion_library (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  part_name text NOT NULL,
  part_name_normalized text GENERATED ALWAYS AS (lower(btrim(part_name))) STORED,
  usage_count integer NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, part_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_parts_library_tenant ON public.parts_suggestion_library(tenant_id, last_used_at DESC);

ALTER TABLE public.parts_suggestion_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view parts library"
ON public.parts_suggestion_library FOR SELECT TO authenticated
USING (public.is_user_tenant(tenant_id) OR public.is_super_admin());

CREATE POLICY "Tenant users can insert parts"
ON public.parts_suggestion_library FOR INSERT TO authenticated
WITH CHECK (public.is_user_tenant(tenant_id) OR public.is_super_admin());

CREATE POLICY "Tenant users can update parts"
ON public.parts_suggestion_library FOR UPDATE TO authenticated
USING (public.is_user_tenant(tenant_id) OR public.is_super_admin());

CREATE POLICY "Tenant users can delete parts"
ON public.parts_suggestion_library FOR DELETE TO authenticated
USING (public.is_user_tenant(tenant_id) OR public.is_super_admin());

CREATE POLICY "Service role full access on parts_library"
ON public.parts_suggestion_library FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Customer approval status on service_bookings
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS customer_approval_status text NOT NULL DEFAULT 'pending_approval';

-- Backfill from existing approval_status
UPDATE public.service_bookings
SET customer_approval_status = CASE
  WHEN approval_status = 'approved' THEN 'approved'
  WHEN approval_status = 'rejected' THEN 'rejected'
  ELSE 'pending_approval'
END
WHERE customer_approval_status = 'pending_approval';

ALTER TABLE public.service_bookings
  DROP CONSTRAINT IF EXISTS service_bookings_customer_approval_status_check;
ALTER TABLE public.service_bookings
  ADD CONSTRAINT service_bookings_customer_approval_status_check
  CHECK (customer_approval_status IN ('pending_approval','approved','rejected','call_requested'));
