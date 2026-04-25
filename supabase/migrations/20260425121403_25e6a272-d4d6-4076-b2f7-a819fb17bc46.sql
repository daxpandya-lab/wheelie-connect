-- Session debug log for chatbot session lifecycle events
CREATE TABLE public.session_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  flow_id uuid,
  session_id uuid,
  visitor_token text,
  event text NOT NULL,
  reason text,
  node_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_debug_tenant_created
  ON public.session_debug (tenant_id, created_at DESC);
CREATE INDEX idx_session_debug_session
  ON public.session_debug (session_id);
CREATE INDEX idx_session_debug_event
  ON public.session_debug (event);

ALTER TABLE public.session_debug ENABLE ROW LEVEL SECURITY;

-- Service role full access (for cleanup / backend)
CREATE POLICY "Service role full access on session_debug"
ON public.session_debug
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Anonymous chat visitors can insert debug entries for active tenants
CREATE POLICY "Anon can insert session debug for active tenants"
ON public.session_debug
FOR INSERT
TO anon
WITH CHECK (is_tenant_id_active(tenant_id));

-- Authenticated tenant users can also insert (covers preview/admin contexts)
CREATE POLICY "Tenant users can insert session debug"
ON public.session_debug
FOR INSERT
TO authenticated
WITH CHECK (is_user_tenant(tenant_id) OR is_super_admin());

-- Tenant users / super admins can read their dealer's debug entries
CREATE POLICY "Tenant users can view own session debug"
ON public.session_debug
FOR SELECT
TO authenticated
USING (is_user_tenant(tenant_id) OR is_super_admin());