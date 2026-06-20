
CREATE TABLE IF NOT EXISTS public.outbound_communication_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_phone text,
  automation_type text NOT NULL,
  channel text,
  status text NOT NULL DEFAULT 'sent',
  error_message text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbound_logs_tenant_created ON public.outbound_communication_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_logs_type ON public.outbound_communication_logs(automation_type);

GRANT SELECT ON public.outbound_communication_logs TO authenticated;
GRANT ALL ON public.outbound_communication_logs TO service_role;

ALTER TABLE public.outbound_communication_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read outbound logs"
  ON public.outbound_communication_logs FOR SELECT
  TO authenticated
  USING (public.is_user_tenant(tenant_id) OR public.is_super_admin());

CREATE POLICY "Service role manages outbound logs"
  ON public.outbound_communication_logs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
