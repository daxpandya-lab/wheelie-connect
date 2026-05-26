import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  tenantId: string | null;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

type Suggestion = { part_name: string };

/**
 * Parts Required autocomplete:
 * Comma/newline-separated tag entry. While typing the current (last) token,
 * shows a non-blocking dropdown of past parts for the tenant. Click to insert.
 */
export default function PartsAutocomplete({ tenantId, value, onChange, disabled, placeholder }: Props) {
  const [library, setLibrary] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    supabase
      .from("parts_suggestion_library")
      .select("part_name")
      .eq("tenant_id", tenantId)
      .order("last_used_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setLibrary((data as Suggestion[]) || []));
  }, [tenantId]);

  const currentToken = useMemo(() => {
    const tokens = value.split(/[,;\n]/);
    return (tokens[tokens.length - 1] || "").trim().toLowerCase();
  }, [value]);

  const matches = useMemo(() => {
    if (!currentToken) return library.slice(0, 8);
    return library
      .filter((p) => p.part_name.toLowerCase().includes(currentToken))
      .slice(0, 8);
  }, [library, currentToken]);

  const insertSuggestion = (part: string) => {
    const tokens = value.split(/([,;\n])/);
    // Replace the last non-separator token
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!/^[,;\n]$/.test(tokens[i])) {
        tokens[i] = (tokens[i].match(/^\s*/)?.[0] || "") + part;
        break;
      }
    }
    let next = tokens.join("");
    if (!/[,;\n]\s*$/.test(next)) next += ", ";
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => ref.current?.focus());
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || "e.g. Brake pads, Oil filter, Air filter"}
        rows={2}
        disabled={disabled}
      />
      {open && matches.length > 0 && !disabled && (
        <div className="absolute z-50 mt-1 left-0 right-0 max-h-44 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
            Saved parts
          </p>
          {matches.map((m) => (
            <button
              key={m.part_name}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertSuggestion(m.part_name); }}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              {m.part_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
