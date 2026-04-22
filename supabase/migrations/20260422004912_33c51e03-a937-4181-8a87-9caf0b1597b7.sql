-- Public chatbot sessions: stores visitor session state for a specific flow
CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.chatbot_flows(id) ON DELETE CASCADE,
  visitor_token text NOT NULL,
  current_node_id text,
  collected_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, flow_id, visitor_token)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant_flow ON public.chat_sessions(tenant_id, flow_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_visitor ON public.chat_sessions(visitor_token);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

-- Public (anon) can create and read/update their own sessions for active flows
CREATE POLICY "Anon can insert chat sessions for active flows"
  ON public.chat_sessions FOR INSERT TO anon
  WITH CHECK (
    is_tenant_id_active(tenant_id)
    AND EXISTS (SELECT 1 FROM public.chatbot_flows f WHERE f.id = flow_id AND f.tenant_id = chat_sessions.tenant_id)
  );

CREATE POLICY "Anon can read own chat sessions"
  ON public.chat_sessions FOR SELECT TO anon
  USING (true);

CREATE POLICY "Anon can update own chat sessions"
  ON public.chat_sessions FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Tenant users can view their own sessions
CREATE POLICY "Tenant users can view own chat sessions"
  ON public.chat_sessions FOR SELECT TO authenticated
  USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Tenant users can delete own chat sessions"
  ON public.chat_sessions FOR DELETE TO authenticated
  USING (is_user_tenant(tenant_id) OR is_super_admin());

-- Service role
CREATE POLICY "Service role full access on chat_sessions"
  ON public.chat_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();