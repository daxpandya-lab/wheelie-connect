import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import FlowCanvas from "@/components/chatbot/FlowCanvas";
import NodeProperties from "@/components/chatbot/NodeProperties";
import ChatPreview from "@/components/chatbot/ChatPreview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Save, Play, ZoomIn, ZoomOut, Maximize2,
  MessageSquare, Car, Loader2, Plus, ChevronLeft,
  ArrowUp, ArrowDown, Trash2, Copy,
} from "lucide-react";
import { toast } from "sonner";
import type { FlowData, FlowNode, NodeType } from "@/types/chatbot-flow";
import { SERVICE_BOOKING_FLOW, TEST_DRIVE_FLOW, NODE_TYPE_CONFIG, createBlankNode } from "@/types/chatbot-flow";

type FlowRecord = {
  id: string;
  name: string;
  description: string | null;
  flow_data: FlowData;
  is_active: boolean;
  language: string;
  channel: string;
};

export default function FlowBuilderPage() {
  const { tenantId } = useAuth();
  const navigate = useNavigate();

  const [flows, setFlows] = useState<FlowRecord[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [flowData, setFlowData] = useState<FlowData>(SERVICE_BOOKING_FLOW);
  const [flowName, setFlowName] = useState("Service Booking");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [language, setLanguage] = useState("en");
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 50, y: 20 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listView, setListView] = useState(true);

  // Fetch flows
  const fetchFlows = async () => {
    if (!tenantId) { setLoading(false); return; }
    const { data } = await supabase
      .from("chatbot_flows")
      .select("id, name, description, flow_data, is_active, language, channel")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (data) setFlows(data.map((f) => ({ ...f, flow_data: f.flow_data as unknown as FlowData })));
    setLoading(false);
  };

  useEffect(() => { fetchFlows(); }, [tenantId]);

  // Seed default flows
  const seedFlows = async () => {
    if (!tenantId) return;
    setSaving(true);
    const seeds = [
      { name: "Service Booking", description: "14-step vehicle service booking chatbot", flow_data: SERVICE_BOOKING_FLOW, channel: "both" as const, language: "en" },
      { name: "Test Drive", description: "Test drive booking chatbot with lead capture", flow_data: TEST_DRIVE_FLOW, channel: "both" as const, language: "en" },
    ];
    for (const s of seeds) {
      await supabase.from("chatbot_flows").insert({
        tenant_id: tenantId,
        name: s.name,
        description: s.description,
        flow_data: JSON.parse(JSON.stringify(s.flow_data)),
        is_active: false,
        language: s.language,
        channel: s.channel,
      } as any);
    }
    setSaving(false);
    toast.success("Default flows created!");
    fetchFlows();
  };

  // Create a new flow — blank or a duplicate of an existing one
  const createNewFlow = async (sourceFlow?: FlowRecord) => {
    if (!tenantId) return;
    setSaving(true);
    const blank: FlowData = {
      version: 1,
      startNodeId: "start",
      nodes: [{
        id: "start", type: "greeting", label: "Greeting",
        message: { en: "👋 Hello! How can I help you today?", hi: "", ar: "" },
        position: { x: 400, y: 50 },
      }],
      connections: [],
    };
    const newFlowData = sourceFlow
      ? JSON.parse(JSON.stringify(sourceFlow.flow_data))
      : JSON.parse(JSON.stringify(blank));
    const name = sourceFlow ? `${sourceFlow.name} (Copy)` : "Untitled Flow";
    const { data, error } = await supabase.from("chatbot_flows").insert({
      tenant_id: tenantId, name, description: sourceFlow?.description || null,
      flow_data: newFlowData, is_active: false, language: "en", channel: "both",
    } as any).select("id, name, description, flow_data, is_active, language, channel").single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("New flow created");
    await fetchFlows();
    if (data) openFlow({ ...data, flow_data: data.flow_data as unknown as FlowData });
  };

  const openFlow = (flow: FlowRecord) => {
    setActiveFlowId(flow.id);
    setFlowData(flow.flow_data);
    setFlowName(flow.name);
    setListView(false);
    setSelectedNodeId(null);
  };

  const saveFlow = async () => {
    if (!activeFlowId) return;
    setSaving(true);
    const refreshed: FlowData = { ...flowData, connections: rebuildConnections(flowData.nodes) };
    const { error } = await supabase.from("chatbot_flows")
      .update({ flow_data: JSON.parse(JSON.stringify(refreshed)), name: flowName, updated_at: new Date().toISOString() } as any)
      .eq("id", activeFlowId);
    setSaving(false);
    if (error) toast.error(error.message);
    else { setFlowData(refreshed); toast.success("Flow saved!"); fetchFlows(); }
  };

  const toggleActive = async (flowId: string, isActive: boolean) => {
    await supabase.from("chatbot_flows").update({ is_active: !isActive }).eq("id", flowId);
    fetchFlows();
  };

  const handleNodeChange = (updated: FlowNode) => {
    setFlowData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === updated.id ? updated : n)),
    }));
  };

  // Recompute connections from nodes' nextNodeId/options
  const rebuildConnections = (nodes: FlowNode[]): FlowData["connections"] => {
    const conns: FlowData["connections"] = [];
    nodes.forEach((n) => {
      if (n.options && n.options.length) {
        n.options.forEach((o, i) => {
          if (o.nextNodeId) conns.push({ id: `${n.id}_opt${i}`, sourceId: n.id, targetId: o.nextNodeId, label: o.label });
        });
      } else if (n.nextNodeId) {
        conns.push({ id: `${n.id}_next`, sourceId: n.id, targetId: n.nextNodeId });
      }
    });
    return conns;
  };

  const addNode = (type: NodeType) => {
    const lastNode = flowData.nodes[flowData.nodes.length - 1];
    const position = { x: 400, y: (lastNode?.position.y || 0) + 100 };
    const newNode = createBlankNode(type, position);
    // Wire previous tail node to point at new node
    const updatedNodes = flowData.nodes.map((n, i) => {
      if (i === flowData.nodes.length - 1 && !n.options?.length && !n.nextNodeId && n.type !== "end") {
        return { ...n, nextNodeId: newNode.id };
      }
      return n;
    });
    const nodes = [...updatedNodes, newNode];
    setFlowData({ ...flowData, nodes, connections: rebuildConnections(nodes) });
    setSelectedNodeId(newNode.id);
    toast.success(`Added ${NODE_TYPE_CONFIG[type].label} block`);
  };

  const deleteNode = (nodeId: string) => {
    if (nodeId === flowData.startNodeId) { toast.error("Cannot delete the start node"); return; }
    const nodes = flowData.nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => ({
        ...n,
        nextNodeId: n.nextNodeId === nodeId ? undefined : n.nextNodeId,
        options: n.options?.map((o) => o.nextNodeId === nodeId ? { ...o, nextNodeId: "" } : o),
      }));
    setFlowData({ ...flowData, nodes, connections: rebuildConnections(nodes) });
    setSelectedNodeId(null);
    toast.success("Block deleted");
  };

  const moveNode = (nodeId: string, dir: -1 | 1) => {
    const idx = flowData.nodes.findIndex((n) => n.id === nodeId);
    const newIdx = idx + dir;
    if (idx < 0 || newIdx < 0 || newIdx >= flowData.nodes.length) return;
    const nodes = [...flowData.nodes];
    [nodes[idx], nodes[newIdx]] = [nodes[newIdx], nodes[idx]];
    // Reposition vertically based on order
    nodes.forEach((n, i) => { n.position = { x: 400, y: 50 + i * 100 }; });
    setFlowData({ ...flowData, nodes });
  };

  const selectedNode = flowData.nodes.find((n) => n.id === selectedNodeId);

  // LIST VIEW
  if (listView) {
    return (
      <>
        <TopBar title="Chatbot Flow Builder" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Chatbot Flows</h2>
                <p className="text-sm text-muted-foreground">Build and manage your automated conversation flows</p>
              </div>
              <div className="flex items-center gap-2">
                {flows.length === 0 && !loading && (
                  <Button variant="outline" onClick={seedFlows} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create Default Flows
                  </Button>
                )}
                <Button onClick={() => createNewFlow()} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create New Flow
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : flows.length === 0 ? (
              <div className="text-center py-16 glass-card rounded-xl">
                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No flows yet. Create default flows to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {flows.map((f) => (
                  <div key={f.id} className="glass-card rounded-xl p-5 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      {f.name.includes("Test") ? <Car className="w-5 h-5 text-primary" /> : <MessageSquare className="w-5 h-5 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{f.name}</p>
                        <Badge variant={f.is_active ? "default" : "secondary"} className="text-xs">
                          {f.is_active ? "Active" : "Inactive"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{f.channel}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{f.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {(f.flow_data as FlowData).nodes?.length || 0} nodes
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => toggleActive(f.id, f.is_active)}>
                        {f.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button size="sm" onClick={() => openFlow(f)}>
                        Edit Flow
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // BUILDER VIEW
  return (
    <>
      <TopBar title={`Flow Builder — ${flowName}`} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="h-12 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setListView(true)} className="h-8">
              <ChevronLeft className="w-4 h-4" /> Flows
            </Button>
            <div className="w-px h-5 bg-border" />
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">Hindi</SelectItem>
                <SelectItem value="ar">Arabic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} className="h-8 w-8 p-0">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="h-8 w-8 p-0">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setZoom(0.85); setPan({ x: 50, y: 20 }); }} className="h-8 w-8 p-0">
              <Maximize2 className="w-4 h-4" />
            </Button>
            <div className="w-px h-5 bg-border mx-1" />
            <Button
              variant={showPreview ? "default" : "outline"}
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              className="h-8"
            >
              <Play className="w-3.5 h-3.5" /> Preview
            </Button>
            <Button size="sm" onClick={saveFlow} disabled={saving} className="h-8">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </Button>
          </div>
        </div>

        {/* Canvas + Panels */}
        <div className="flex-1 flex overflow-hidden">
          {/* Block list (left rail) */}
          <div className="w-64 border-r border-border bg-card overflow-y-auto shrink-0">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Blocks ({flowData.nodes.length})</h3>
              <Select onValueChange={(v) => addNode(v as NodeType)}>
                <SelectTrigger className="h-7 w-24 text-xs">
                  <Plus className="w-3 h-3" />
                  <span>Add</span>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(NODE_TYPE_CONFIG) as NodeType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {NODE_TYPE_CONFIG[t].icon} {NODE_TYPE_CONFIG[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="p-2 space-y-1">
              {flowData.nodes.map((n, i) => (
                <div
                  key={n.id}
                  onClick={() => setSelectedNodeId(n.id)}
                  className={`group p-2 rounded-md cursor-pointer text-xs flex items-center gap-2 ${
                    selectedNodeId === n.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted border border-transparent"
                  }`}
                >
                  <span className="text-base">{NODE_TYPE_CONFIG[n.type].icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-foreground">{n.label}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{n.type}</p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveNode(n.id, -1); }}
                      disabled={i === 0}
                      className="p-1 hover:bg-background rounded disabled:opacity-30"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveNode(n.id, 1); }}
                      disabled={i === flowData.nodes.length - 1}
                      className="p-1 hover:bg-background rounded disabled:opacity-30"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }}
                      className="p-1 hover:bg-background rounded"
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 relative">
            <FlowCanvas
              flow={flowData}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              zoom={zoom}
              pan={pan}
            />
            <div className="absolute bottom-3 left-3 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-1.5 text-xs text-muted-foreground">
              {flowData.nodes.length} nodes · {flowData.connections.length} connections
            </div>
          </div>

          {/* Properties Panel */}
          {selectedNode && !showPreview && (
            <NodeProperties
              node={selectedNode}
              allNodes={flowData.nodes}
              onChange={handleNodeChange}
              onDelete={deleteNode}
              onClose={() => setSelectedNodeId(null)}
              language={language}
            />
          )}

          {/* Chat Preview */}
          {showPreview && (
            <div className="w-80 shrink-0">
              <ChatPreview flow={flowData} language={language} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
