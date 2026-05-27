
-- Stronger normalization: lowercase + strip everything but alphanumerics.
-- "Brake Pad", "brake-pad", "BRAKE  PAD." all normalize to "brakepad".

ALTER TABLE public.parts_suggestion_library
  DROP CONSTRAINT IF EXISTS parts_suggestion_library_tenant_id_part_name_normalized_key;

ALTER TABLE public.parts_suggestion_library
  DROP COLUMN IF EXISTS part_name_normalized;

ALTER TABLE public.parts_suggestion_library
  ADD COLUMN part_name_normalized text
  GENERATED ALWAYS AS (regexp_replace(lower(btrim(part_name)), '[^a-z0-9]+', '', 'g')) STORED;

-- Collapse any pre-existing near-duplicates that now collide under the new normalization.
WITH ranked AS (
  SELECT id, tenant_id, part_name_normalized,
         SUM(usage_count) OVER (PARTITION BY tenant_id, part_name_normalized) AS total_usage,
         MAX(last_used_at) OVER (PARTITION BY tenant_id, part_name_normalized) AS max_last,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, part_name_normalized
           ORDER BY usage_count DESC, last_used_at DESC, created_at ASC
         ) AS rn
  FROM public.parts_suggestion_library
)
UPDATE public.parts_suggestion_library p
   SET usage_count = r.total_usage,
       last_used_at = r.max_last
  FROM ranked r
 WHERE p.id = r.id AND r.rn = 1;

DELETE FROM public.parts_suggestion_library p
USING (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY tenant_id, part_name_normalized
      ORDER BY usage_count DESC, last_used_at DESC, created_at ASC
    ) AS rn
    FROM public.parts_suggestion_library
  ) s WHERE s.rn > 1
) dups
WHERE p.id = dups.id;

ALTER TABLE public.parts_suggestion_library
  ADD CONSTRAINT parts_suggestion_library_tenant_id_part_name_normalized_key
  UNIQUE (tenant_id, part_name_normalized);

-- Upsert helper: insert new or increment usage_count + refresh last_used_at.
CREATE OR REPLACE FUNCTION public.upsert_part_suggestion(_tenant_id uuid, _part_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _trimmed text := btrim(COALESCE(_part_name, ''));
  _norm text := regexp_replace(lower(_trimmed), '[^a-z0-9]+', '', 'g');
BEGIN
  IF _trimmed = '' OR _norm = '' OR length(_trimmed) > 80 THEN
    RETURN;
  END IF;

  INSERT INTO public.parts_suggestion_library (tenant_id, part_name, usage_count, last_used_at)
  VALUES (_tenant_id, _trimmed, 1, now())
  ON CONFLICT (tenant_id, part_name_normalized)
  DO UPDATE SET
    usage_count = public.parts_suggestion_library.usage_count + 1,
    last_used_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_part_suggestion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_part_suggestion(uuid, text) TO authenticated, service_role;
