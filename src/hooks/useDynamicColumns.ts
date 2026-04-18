import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ReportKey = "leads" | "service_bookings" | "test_drive_bookings";

export interface ColumnPref {
  key: string;       // metadata key OR fixed-column key prefixed "fixed:"
  visible: boolean;
}

export interface FixedColumn {
  key: string;       // unique
  label: string;
}

const STORAGE_NAMESPACE = "report_columns";

function settingsKey(report: ReportKey) {
  return `${STORAGE_NAMESPACE}.${report}`;
}

/**
 * Discovers metadata keys actually present in the table for the tenant,
 * merges them with fixed columns, and persists per-tenant visibility/order
 * inside tenants.settings JSONB.
 */
export function useDynamicColumns(
  report: ReportKey,
  fixedColumns: FixedColumn[],
  rows: Array<{ metadata?: Record<string, unknown> | null }>,
) {
  const { tenantId } = useAuth();
  const [prefs, setPrefs] = useState<ColumnPref[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 1. Discover metadata keys present in current rows
  const discoveredKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const md = r.metadata;
      if (md && typeof md === "object") {
        for (const k of Object.keys(md)) {
          if (k === "flow_id" || k === "captured_at") continue;
          set.add(k);
        }
      }
    }
    return Array.from(set).sort();
  }, [rows]);

  // 2. Load saved prefs from tenants.settings
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenantId) return;
      const { data } = await supabase
        .from("tenants")
        .select("settings")
        .eq("id", tenantId)
        .single();
      if (cancelled) return;
      const saved = (data?.settings as any)?.[settingsKey(report)] as ColumnPref[] | undefined;
      setPrefs(saved || null);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [tenantId, report]);

  // 3. Merged columns: prefs (if exist) preserve order; new keys appended visible
  const columns = useMemo(() => {
    const fixedKeys = fixedColumns.map((c) => `fixed:${c.key}`);
    const allKeys = [...fixedKeys, ...discoveredKeys];
    const labelOf = (k: string) => {
      if (k.startsWith("fixed:")) {
        const found = fixedColumns.find((f) => `fixed:${f.key}` === k);
        return found?.label || k;
      }
      // humanise: snake_case -> Title Case
      return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    };

    if (!prefs) {
      return allKeys.map((k) => ({ key: k, label: labelOf(k), visible: true }));
    }
    const byKey = new Map(prefs.map((p) => [p.key, p]));
    const ordered: { key: string; label: string; visible: boolean }[] = [];
    // Preserve user's order for known keys
    for (const p of prefs) {
      if (allKeys.includes(p.key)) {
        ordered.push({ key: p.key, label: labelOf(p.key), visible: p.visible });
      }
    }
    // Append new keys not in prefs (default visible)
    for (const k of allKeys) {
      if (!byKey.has(k)) ordered.push({ key: k, label: labelOf(k), visible: true });
    }
    return ordered;
  }, [discoveredKeys, fixedColumns, prefs]);

  const savePrefs = useCallback(
    async (next: { key: string; visible: boolean }[]) => {
      if (!tenantId) return;
      setPrefs(next.map((c) => ({ key: c.key, visible: c.visible })));
      const { data: t } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
      const settings = ((t?.settings as Record<string, unknown>) || {});
      settings[settingsKey(report)] = next.map((c) => ({ key: c.key, visible: c.visible }));
      await supabase.from("tenants").update({ settings }).eq("id", tenantId);
    },
    [tenantId, report],
  );

  return { columns, savePrefs, loaded };
}

export function getCellValue(
  row: { metadata?: Record<string, unknown> | null; [k: string]: unknown },
  colKey: string,
): string {
  if (colKey.startsWith("fixed:")) {
    const k = colKey.replace("fixed:", "");
    const v = row[k];
    if (v == null || v === "") return "—";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  }
  const md = row.metadata || {};
  const v = (md as Record<string, unknown>)[colKey];
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
