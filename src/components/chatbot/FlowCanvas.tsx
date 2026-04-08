import { useRef, useEffect, useCallback } from "react";
import type { FlowData, FlowNode, FlowConnection, NODE_TYPE_CONFIG } from "@/types/chatbot-flow";
import { NODE_TYPE_CONFIG as nodeConfig } from "@/types/chatbot-flow";

interface FlowCanvasProps {
  flow: FlowData;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  zoom: number;
  pan: { x: number; y: number };
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;

export default function FlowCanvas({ flow, selectedNodeId, onSelectNode, zoom, pan }: FlowCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw connections
    flow.connections.forEach((conn) => {
      const source = flow.nodes.find((n) => n.id === conn.sourceId);
      const target = flow.nodes.find((n) => n.id === conn.targetId);
      if (!source || !target) return;

      const sx = source.position.x + NODE_WIDTH / 2;
      const sy = source.position.y + NODE_HEIGHT;
      const tx = target.position.x + NODE_WIDTH / 2;
      const ty = target.position.y;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      const midY = (sy + ty) / 2;
      ctx.bezierCurveTo(sx, midY, tx, midY, tx, ty);
      ctx.strokeStyle = "hsl(220, 13%, 75%)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Arrow
      const angle = Math.atan2(ty - midY, tx - tx);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 6, ty - 10);
      ctx.lineTo(tx + 6, ty - 10);
      ctx.closePath();
      ctx.fillStyle = "hsl(220, 13%, 75%)";
      ctx.fill();

      // Connection label
      if (conn.label) {
        const lx = (sx + tx) / 2;
        const ly = midY - 8;
        ctx.font = "11px Inter, sans-serif";
        ctx.fillStyle = "hsl(220, 10%, 46%)";
        ctx.textAlign = "center";
        ctx.fillText(conn.label, lx, ly);
      }
    });

    // Draw nodes
    flow.nodes.forEach((node) => {
      const config = nodeConfig[node.type];
      const isSelected = node.id === selectedNodeId;
      const x = node.position.x;
      const y = node.position.y;

      // Shadow
      ctx.shadowColor = isSelected ? "hsla(217, 91%, 50%, 0.3)" : "hsla(0, 0%, 0%, 0.08)";
      ctx.shadowBlur = isSelected ? 12 : 6;
      ctx.shadowOffsetY = 2;

      // Node body
      ctx.beginPath();
      ctx.roundRect(x, y, NODE_WIDTH, NODE_HEIGHT, 10);
      ctx.fillStyle = "hsl(0, 0%, 100%)";
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "hsl(217, 91%, 50%)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.strokeStyle = "hsl(220, 13%, 91%)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Type indicator bar
      ctx.beginPath();
      ctx.roundRect(x, y, 4, NODE_HEIGHT, [10, 0, 0, 10]);
      ctx.fillStyle = config.color;
      ctx.fill();

      // Icon + label
      ctx.font = "14px sans-serif";
      ctx.fillText(config.icon, x + 14, y + 25);

      ctx.font = "bold 12px Inter, sans-serif";
      ctx.fillStyle = "hsl(220, 30%, 10%)";
      ctx.textAlign = "left";
      ctx.fillText(node.label, x + 34, y + 25);

      // Subtitle
      ctx.font = "10px Inter, sans-serif";
      ctx.fillStyle = "hsl(220, 10%, 46%)";
      const subtitle = node.dataField ? `→ ${node.dataField}` : node.type;
      ctx.fillText(subtitle, x + 34, y + 42);
    });

    ctx.restore();
  }, [flow, selectedNodeId, zoom, pan]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - pan.x) / zoom;
    const my = (e.clientY - rect.top - pan.y) / zoom;

    const clicked = flow.nodes.find(
      (n) => mx >= n.position.x && mx <= n.position.x + NODE_WIDTH && my >= n.position.y && my <= n.position.y + NODE_HEIGHT
    );
    onSelectNode(clicked?.id ?? null);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className="w-full h-full cursor-crosshair"
      style={{ background: "hsl(var(--background))" }}
    />
  );
}
