
CREATE TABLE IF NOT EXISTS public.gateway_health_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'unknown',
  version text,
  last_success_at timestamptz,
  last_check_at timestamptz NOT NULL DEFAULT now(),
  error_message text,
  action_required boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider)
);

GRANT SELECT ON public.gateway_health_status TO authenticated;
GRANT ALL ON public.gateway_health_status TO service_role;

ALTER TABLE public.gateway_health_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant can view own gateway health"
  ON public.gateway_health_status FOR SELECT
  TO authenticated
  USING (public.is_user_tenant(tenant_id) OR public.is_super_admin());

CREATE TRIGGER trg_gateway_health_updated
  BEFORE UPDATE ON public.gateway_health_status
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_gateway_health_tenant ON public.gateway_health_status(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gateway_health_status ON public.gateway_health_status(status) WHERE action_required = true;
