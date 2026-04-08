
-- Campaign recipients tracking
CREATE TABLE public.campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  customer_id uuid REFERENCES public.customers(id),
  phone_number text NOT NULL,
  customer_name text,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  reply_text text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_recipients_campaign ON public.campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_tenant ON public.campaign_recipients(tenant_id);
CREATE INDEX idx_campaign_recipients_phone ON public.campaign_recipients(phone_number);

ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view own data" ON public.campaign_recipients
  FOR SELECT TO authenticated USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Tenant users can insert own data" ON public.campaign_recipients
  FOR INSERT TO authenticated WITH CHECK (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Tenant users can update own data" ON public.campaign_recipients
  FOR UPDATE TO authenticated USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Tenant users can delete own data" ON public.campaign_recipients
  FOR DELETE TO authenticated USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Service role full access" ON public.campaign_recipients
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Contact segments table
CREATE TABLE public.contact_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  description text,
  filter_criteria jsonb NOT NULL DEFAULT '{}',
  customer_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_segments_tenant ON public.contact_segments(tenant_id);

ALTER TABLE public.contact_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view own data" ON public.contact_segments
  FOR SELECT TO authenticated USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Tenant users can insert own data" ON public.contact_segments
  FOR INSERT TO authenticated WITH CHECK (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Tenant users can update own data" ON public.contact_segments
  FOR UPDATE TO authenticated USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Tenant users can delete own data" ON public.contact_segments
  FOR DELETE TO authenticated USING (is_user_tenant(tenant_id) OR is_super_admin());

-- Add recipient_count to campaigns
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS recipient_count integer DEFAULT 0;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS segment_id uuid REFERENCES public.contact_segments(id);

-- Enable realtime for campaign_recipients
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_recipients;
