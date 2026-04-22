DROP POLICY IF EXISTS "Anon can update own chat sessions" ON public.chat_sessions;

CREATE POLICY "Anon can update chat sessions for active flows"
  ON public.chat_sessions FOR UPDATE TO anon
  USING (
    is_tenant_id_active(tenant_id)
    AND EXISTS (SELECT 1 FROM public.chatbot_flows f WHERE f.id = flow_id AND f.tenant_id = chat_sessions.tenant_id)
  )
  WITH CHECK (
    is_tenant_id_active(tenant_id)
    AND EXISTS (SELECT 1 FROM public.chatbot_flows f WHERE f.id = flow_id AND f.tenant_id = chat_sessions.tenant_id)
  );