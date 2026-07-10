
CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_name text NOT NULL UNIQUE,
  instance_token text,
  status text NOT NULL DEFAULT 'pending',
  webhook_url text,
  last_event_at timestamptz,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_tenant_unique
  ON public.whatsapp_instances(tenant_id);

GRANT SELECT ON public.whatsapp_instances TO authenticated;
GRANT ALL ON public.whatsapp_instances TO service_role;

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their tenant's whatsapp instance"
  ON public.whatsapp_instances
  FOR SELECT
  TO authenticated
  USING (public.is_user_tenant(tenant_id) OR public.is_super_admin());

CREATE TRIGGER trg_whatsapp_instances_updated_at
  BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
