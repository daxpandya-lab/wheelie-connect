import type { FlowNode, FlowNodeOption, NodeType } from "@/types/chatbot-flow";
import { NODE_TYPE_CONFIG } from "@/types/chatbot-flow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Plus, Trash2 } from "lucide-react";

interface NodePropertiesProps {
  node: FlowNode;
  allNodes: FlowNode[];
  onChange: (updated: FlowNode) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
  language: string;
}

const DATA_FIELDS = [
  "customer_name", "phone_number", "email", "vehicle_type", "vehicle_model",
  "registration_number", "kms_driven", "service_type", "issue_description",
  "preferred_date", "preferred_time", "pickup_required",
];

export default function NodeProperties({ node, allNodes, onChange, onDelete, onClose, language }: NodePropertiesProps) {
  const config = NODE_TYPE_CONFIG[node.type];
  const otherNodes = allNodes.filter((n) => n.id !== node.id);

  const updateMessage = (lang: string, text: string) => {
    onChange({ ...node, message: { ...node.message, [lang]: text } });
  };

  const updateOption = (idx: number, patch: Partial<FlowNodeOption>) => {
    const options = [...(node.options || [])];
    options[idx] = { ...options[idx], ...patch };
    onChange({ ...node, options });
  };

  const addOption = () => {
    const options = [...(node.options || []), { label: "New option", value: `opt_${Date.now().toString(36)}`, nextNodeId: "" }];
    onChange({ ...node, options });
  };

  const removeOption = (idx: number) => {
    const options = (node.options || []).filter((_, i) => i !== idx);
    onChange({ ...node, options });
  };

  const showOptions = node.type === "question" && node.validationType === "selection"
    || node.type === "confirmation"
    || node.type === "condition";

  return (
    <div className="w-80 border-l border-border bg-card h-full overflow-y-auto">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{config.icon}</span>
          <h3 className="font-semibold text-foreground text-sm">{config.label} Node</h3>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Label */}
        <div className="space-y-1.5">
          <Label className="text-xs">Label</Label>
          <Input
            value={node.label}
            onChange={(e) => onChange({ ...node, label: e.target.value })}
            className="h-8 text-sm"
          />
        </div>

        {/* Type changer */}
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select value={node.type} onValueChange={(v) => onChange({ ...node, type: v as NodeType })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(NODE_TYPE_CONFIG) as NodeType[]).map((t) => (
                <SelectItem key={t} value={t}>{NODE_TYPE_CONFIG[t].icon} {NODE_TYPE_CONFIG[t].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Message per language */}
        {["en", "hi", "ar"].map((lang) => (
          <div key={lang} className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              Message
              <Badge variant="outline" className="text-[10px] px-1 py-0">{lang.toUpperCase()}</Badge>
            </Label>
            <Textarea
              value={node.message[lang] || ""}
              onChange={(e) => updateMessage(lang, e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
        ))}

        {/* Data field */}
        {(node.type === "question" || node.type === "date_buttons" || node.type === "confirmation") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Maps to Data Field</Label>
            <Select value={node.dataField || ""} onValueChange={(v) => onChange({ ...node, dataField: v })}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select field" /></SelectTrigger>
              <SelectContent>
                {DATA_FIELDS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Validation */}
        {node.type === "question" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Validation Type</Label>
            <Select
              value={node.validationType || "text"}
              onValueChange={(v) => onChange({ ...node, validationType: v as FlowNode["validationType"] })}
            >
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="phone">Phone Number</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="date">Date (DD-MM-YYYY)</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="selection">Selection (Options)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Editable options */}
        {showOptions && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Options</Label>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={addOption}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {(node.options || []).map((opt, i) => (
                <div key={i} className="space-y-1 p-2 border border-border rounded-md">
                  <div className="flex items-center gap-1">
                    <Input
                      value={opt.label}
                      placeholder="Label"
                      onChange={(e) => updateOption(i, { label: e.target.value })}
                      className="h-7 text-xs"
                    />
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeOption(i)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                  <Input
                    value={opt.value}
                    placeholder="Value"
                    onChange={(e) => updateOption(i, { value: e.target.value })}
                    className="h-7 text-xs font-mono"
                  />
                  <Select value={opt.nextNodeId || ""} onValueChange={(v) => updateOption(i, { nextNodeId: v })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Next node →" /></SelectTrigger>
                    <SelectContent>
                      {otherNodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Next node (for non-option nodes) */}
        {!showOptions && node.type !== "end" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Next Node</Label>
            <Select value={node.nextNodeId || ""} onValueChange={(v) => onChange({ ...node, nextNodeId: v })}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select next" /></SelectTrigger>
              <SelectContent>
                {otherNodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Node ID */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Node ID</Label>
          <Input value={node.id} disabled className="h-8 text-xs font-mono" />
        </div>

        <div className="pt-2 border-t border-border">
          <Button variant="destructive" size="sm" className="w-full h-8" onClick={() => onDelete(node.id)}>
            <Trash2 className="w-3.5 h-3.5" /> Delete this block
          </Button>
        </div>
      </div>
    </div>
  );
}
