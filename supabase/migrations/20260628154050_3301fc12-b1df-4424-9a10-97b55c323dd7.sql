
ALTER TABLE public.tenant_api_keys
  ADD COLUMN IF NOT EXISTS fully_revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS tenant_api_keys_pending_sweep_idx
  ON public.tenant_api_keys (revoked_at)
  WHERE revoked_at IS NOT NULL AND fully_revoked_at IS NULL;
