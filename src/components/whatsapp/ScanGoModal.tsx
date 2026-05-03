import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, QrCode, CheckCircle2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ScanGoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  onConnected?: () => void;
}

export default function ScanGoModal({ open, onOpenChange, tenantId, onConnected }: ScanGoModalProps) {
  const [loading, setLoading] = useState(false);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [state, setState] = useState<string>("idle");
  const [connected, setConnected] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startScan = async () => {
    if (!tenantId) return;
    setLoading(true);
    setQrcode(null);
    setConnected(false);
    setState("requesting");

    const { data, error } = await supabase.functions.invoke("evolution-connect", {
      body: { action: "create_and_qr", tenant_id: tenantId },
    });
    setLoading(false);

    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Failed to start Evolution instance");
      setState("error");
      return;
    }
    setQrcode(data.qrcode || null);
    setState("waiting_scan");

    // Begin 5s polling
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      const { data: s } = await supabase.functions.invoke("evolution-connect", {
        body: { action: "status", tenant_id: tenantId },
      });
      if (s?.state) setState(s.state);
      if (s?.connected) {
        setConnected(true);
        stopPolling();
        toast.success("WhatsApp connected via Evolution!");
        onConnected?.();
        setTimeout(() => onOpenChange(false), 1500);
      }
    }, 5000);
  };

  useEffect(() => {
    if (!open) {
      stopPolling();
      setQrcode(null);
      setConnected(false);
      setState("idle");
    }
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5" /> Connect WhatsApp
          </DialogTitle>
          <DialogDescription>
            Scan the QR code with WhatsApp on your phone. Open WhatsApp → Settings → Linked Devices → Link a Device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {connected ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="w-16 h-16 text-success" />
              <p className="font-medium">Connected!</p>
              <p className="text-sm text-muted-foreground">Your WhatsApp is now linked.</p>
            </div>
          ) : qrcode ? (
            <>
              <div className="bg-white p-3 rounded-lg border">
                <img src={qrcode} alt="WhatsApp QR Code" className="w-64 h-64" />
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Waiting for scan… ({state})
              </p>
              <Button variant="ghost" size="sm" onClick={startScan}>
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh QR
              </Button>
            </>
          ) : (
            <>
              <div className="w-64 h-64 bg-muted/50 rounded-lg flex items-center justify-center">
                <QrCode className="w-16 h-16 text-muted-foreground/40" />
              </div>
              <Button onClick={startScan} disabled={loading || !tenantId} className="w-full">
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Scan QR Code
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
