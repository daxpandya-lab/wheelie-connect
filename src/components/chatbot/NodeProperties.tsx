import type { FlowNode, NodeType } from "@/types/chatbot-flow";
import { NODE_TYPE_CONFIG } from "@/types/chatbot-flow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface NodePropertiesProps {
  node: FlowNode;
  onChange: (updated: FlowNode) => void;
  onClose: () => void;
  language: string;
}

export default function NodeProperties({ node, onChange, onClose, language }: NodePropertiesProps) {
  const config = NODE_TYPE_CONFIG[node.type];

  const updateMessage = (lang: string, text: string) => {
    onChange({ ...node, message: { ...node.message, [lang]: text } });
  };

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

        {/* Message per language */}
        {["en", "hi", "ar"].map((lang) => (
          <div key={lang} className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              Message
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                {lang.toUpperCase()}
              </Badge>
            </Label>
            <Textarea
              value={node.message[lang] || ""}
              onChange={(e) => updateMessage(lang, e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
        ))}

        {/* Data field mapping */}
        {(node.type === "question" || node.type === "confirmation") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Maps to Data Field</Label>
            <Select
              value={node.dataField || ""}
              onValueChange={(v) => onChange({ ...node, dataField: v })}
            >
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select field" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer_name">customer_name</SelectItem>
                <SelectItem value="phone_number">phone_number</SelectItem>
                <SelectItem value="vehicle_type">vehicle_type</SelectItem>
                <SelectItem value="vehicle_model">vehicle_model</SelectItem>
                <SelectItem value="registration_number">registration_number</SelectItem>
                <SelectItem value="kms_driven">kms_driven</SelectItem>
                <SelectItem value="service_type">service_type</SelectItem>
                <SelectItem value="issue_description">issue_description</SelectItem>
                <SelectItem value="preferred_date">preferred_date</SelectItem>
                <SelectItem value="preferred_time">preferred_time</SelectItem>
                <SelectItem value="pickup_required">pickup_required</SelectItem>
                <SelectItem value="email">email</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Validation type */}
        {node.type === "question" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Validation Type</Label>
            <Select
              value={node.validationType || "text"}
              onValueChange={(v) => onChange({ ...node, validationType: v as any })}
            >
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="phone">Phone Number</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="selection">Selection (Options)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Options */}
        {node.options && node.options.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Options</Label>
            <div className="space-y-1">
              {node.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-foreground">{opt.label}</span>
                  <span className="text-muted-foreground">→ {opt.nextNodeId}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Node ID (read-only) */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Node ID</Label>
          <Input value={node.id} disabled className="h-8 text-xs font-mono" />
        </div>

        {/* Next node */}
        {node.nextNodeId && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Next Node</Label>
            <Input value={node.nextNodeId} disabled className="h-8 text-xs font-mono" />
          </div>
        )}
      </div>
    </div>
  );
}
