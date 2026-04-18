import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface ManagedColumn {
  key: string;
  label: string;
  visible: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  columns: ManagedColumn[];
  onSave: (next: ManagedColumn[]) => Promise<void> | void;
}

export default function ColumnManagerDialog({ open, onOpenChange, columns, onSave }: Props) {
  const [draft, setDraft] = useState<ManagedColumn[]>(columns);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setDraft(columns); }, [open, columns]);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...draft];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setDraft(next);
  };

  const toggle = (idx: number) => {
    const next = [...draft];
    next[idx] = { ...next[idx], visible: !next[idx].visible };
    setDraft(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success("Column preferences saved");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Columns</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No columns yet. They'll appear here as data flows in.
            </p>
          )}
          {draft.map((col, idx) => (
            <div
              key={col.key}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <Checkbox
                checked={col.visible}
                onCheckedChange={() => toggle(idx)}
                id={`col-${col.key}`}
              />
              <label
                htmlFor={`col-${col.key}`}
                className="flex-1 text-sm font-medium text-foreground cursor-pointer truncate"
              >
                {col.label}
              </label>
              {col.key.startsWith("fixed:") && (
                <span className="text-[10px] uppercase text-muted-foreground tracking-wide">core</span>
              )}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  aria-label="Move up"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  onClick={() => move(idx, 1)}
                  disabled={idx === draft.length - 1}
                  aria-label="Move down"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
