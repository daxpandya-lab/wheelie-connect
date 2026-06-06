// Scheduled cleanup of orphaned chat-media objects in the
// `service-intake-media` storage bucket.
//
// An object is considered orphaned when:
//   1. It is older than ORPHAN_AGE_HOURS (default 24h), AND
//   2. Its public URL does NOT appear in any service_bookings.media_attachments
//      row (i.e. it was never successfully associated to a booking message).
//
// Objects are also force-deleted (regardless of association) once they exceed
// HARD_EXPIRY_DAYS (default 90d) — a tenant-scoped retention ceiling.
//
// Object key layout: {tenant_id}/{session_id}/{filename}.
// We page through objects per tenant prefix so deletes are scoped + auditable.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "service-intake-media";
const ORPHAN_AGE_HOURS = Number(Deno.env.get("ORPHAN_AGE_HOURS") ?? 24);
const HARD_EXPIRY_DAYS = Number(Deno.env.get("HARD_EXPIRY_DAYS") ?? 90);
const PAGE_SIZE = 1000;

interface TenantReport {
  tenant_id: string;
  scanned: number;
  orphaned_deleted: number;
  expired_deleted: number;
  kept: number;
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = Date.now();
  const orphanCutoff = now - ORPHAN_AGE_HOURS * 3600 * 1000;
  const hardCutoff = now - HARD_EXPIRY_DAYS * 86400 * 1000;

  try {
    // Discover tenant prefixes (top-level folders in the bucket).
    const { data: tenantFolders, error: rootErr } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: PAGE_SIZE });
    if (rootErr) throw rootErr;

    const reports: TenantReport[] = [];

    for (const tenant of tenantFolders ?? []) {
      // Folder entries have a null `id` in supabase-js.
      if (!tenant.name || (tenant as { id?: string }).id) continue;

      const report: TenantReport = {
        tenant_id: tenant.name,
        scanned: 0,
        orphaned_deleted: 0,
        expired_deleted: 0,
        kept: 0,
        errors: [],
      };

      // Pull every media URL referenced by this tenant's bookings ONCE so the
      // per-object membership check is O(1).
      const referenced = new Set<string>();
      const { data: bookings, error: bErr } = await supabase
        .from("service_bookings")
        .select("media_attachments")
        .eq("tenant_id", tenant.name)
        .not("media_attachments", "is", null);
      if (bErr) {
        report.errors.push(`bookings query: ${bErr.message}`);
        reports.push(report);
        continue;
      }
      for (const row of bookings ?? []) {
        const arr = (row.media_attachments ?? []) as Array<{ url?: string }>;
        for (const a of arr) if (a?.url) referenced.add(a.url);
      }

      // Walk every session folder under this tenant.
      const { data: sessionFolders } = await supabase.storage
        .from(BUCKET)
        .list(tenant.name, { limit: PAGE_SIZE });

      for (const session of sessionFolders ?? []) {
        if (!session.name || (session as { id?: string }).id) continue;
        const prefix = `${tenant.name}/${session.name}`;

        const { data: objects, error: oErr } = await supabase.storage
          .from(BUCKET)
          .list(prefix, { limit: PAGE_SIZE });
        if (oErr) {
          report.errors.push(`list ${prefix}: ${oErr.message}`);
          continue;
        }

        const toDelete: string[] = [];
        for (const obj of objects ?? []) {
          if (!obj.name || !(obj as { id?: string }).id) continue;
          report.scanned++;
          const key = `${prefix}/${obj.name}`;
          const createdMs = obj.created_at
            ? new Date(obj.created_at).getTime()
            : now;
          const { data: pub } = supabase.storage
            .from(BUCKET)
            .getPublicUrl(key);
          const url = pub.publicUrl;
          const isReferenced = referenced.has(url);

          if (createdMs < hardCutoff) {
            toDelete.push(key);
            report.expired_deleted++;
          } else if (!isReferenced && createdMs < orphanCutoff) {
            toDelete.push(key);
            report.orphaned_deleted++;
          } else {
            report.kept++;
          }
        }

        if (toDelete.length) {
          const { error: dErr } = await supabase.storage
            .from(BUCKET)
            .remove(toDelete);
          if (dErr) report.errors.push(`delete ${prefix}: ${dErr.message}`);
        }
      }

      reports.push(report);
    }

    const summary = reports.reduce(
      (a, r) => ({
        scanned: a.scanned + r.scanned,
        orphaned_deleted: a.orphaned_deleted + r.orphaned_deleted,
        expired_deleted: a.expired_deleted + r.expired_deleted,
        kept: a.kept + r.kept,
      }),
      { scanned: 0, orphaned_deleted: 0, expired_deleted: 0, kept: 0 },
    );

    return new Response(
      JSON.stringify({
        ok: true,
        orphan_age_hours: ORPHAN_AGE_HOURS,
        hard_expiry_days: HARD_EXPIRY_DAYS,
        summary,
        tenants: reports,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
