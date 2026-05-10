import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, Wrench, Phone } from "lucide-react";

type Booking = {
  id: string;
  customer_name: string;
  vehicle_model: string;
  estimate_amount: number | null;
  estimated_cost: number | null;
  work_notes: string | null;
  parts_required: string | null;
  approval_status: string | null;
  estimation_sent_at: string | null;
};

const formatINR = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

export default function EstimateApprovalPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!bookingId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("service_bookings")
      .select("id, customer_name, vehicle_model, estimate_amount, estimated_cost, work_notes, parts_required, approval_status, estimation_sent_at")
      .eq("id", bookingId)
      .maybeSingle();
    if (error || !data) setError("Estimate not found or no longer available.");
    else setBooking(data as Booking);
    setLoading(false);
  };

  useEffect(() => { load(); }, [bookingId]);

  // Realtime: pick up status changes (e.g. dealer cancels or another channel responds)
  useEffect(() => {
    if (!bookingId) return;
    const channel = supabase.channel(`estimate_${bookingId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "service_bookings", filter: `id=eq.${bookingId}` },
        (payload) => setBooking((prev) => prev ? { ...prev, ...(payload.new as Booking) } : prev))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [bookingId]);

  const respond = async (decision: "approved" | "rejected") => {
    if (!booking) return;
    setSubmitting(decision);
    const { error } = await supabase
      .from("service_bookings")
      .update({ approval_status: decision })
      .eq("id", booking.id);
    setSubmitting(null);
    if (error) {
      setError(error.message);
      return;
    }
    setBooking({ ...booking, approval_status: decision });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle>Unable to load estimate</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{error || "Estimate unavailable."}</p></CardContent>
        </Card>
      </div>
    );
  }

  const amount = booking.estimate_amount ?? booking.estimated_cost ?? 0;
  const status = booking.approval_status || "pending";
  const isPending = status === "pending";

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full shadow-lg">
        <CardHeader className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
            <Wrench className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-xl">Service Estimation</CardTitle>
          <p className="text-sm text-muted-foreground">Hi {booking.customer_name}, please review the estimate for your vehicle.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border divide-y divide-border">
            <div className="flex justify-between p-3 text-sm">
              <span className="text-muted-foreground">Vehicle</span>
              <span className="font-medium text-foreground">{booking.vehicle_model}</span>
            </div>
            <div className="flex justify-between p-3 text-sm">
              <span className="text-muted-foreground">Labor / Service</span>
              <span className="font-semibold text-primary text-base">{formatINR(amount)}</span>
            </div>
            {booking.work_notes && (
              <div className="p-3 text-sm">
                <p className="text-muted-foreground mb-1">Work Notes</p>
                <p className="text-foreground whitespace-pre-wrap">{booking.work_notes}</p>
              </div>
            )}
            {booking.parts_required && (
              <div className="p-3 text-sm">
                <p className="text-muted-foreground mb-1">Parts Required</p>
                <p className="text-foreground whitespace-pre-wrap">{booking.parts_required}</p>
              </div>
            )}
          </div>

          {isPending ? (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button
                onClick={() => respond("approved")}
                disabled={!!submitting}
                className="bg-success text-success-foreground hover:bg-success/90"
              >
                {submitting === "approved" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Approve Work
              </Button>
              <Button
                onClick={() => respond("rejected")}
                disabled={!!submitting}
                variant="destructive"
              >
                {submitting === "rejected" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                Reject / Call Me
              </Button>
            </div>
          ) : status === "approved" ? (
            <div className="rounded-lg bg-success/10 border border-success/30 p-4 text-center space-y-2">
              <CheckCircle className="w-8 h-8 text-success mx-auto" />
              <p className="text-sm font-medium text-success">Confirmed!</p>
              <p className="text-xs text-muted-foreground">We have started the work. You will be notified once the vehicle is ready.</p>
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">Approved</Badge>
            </div>
          ) : (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-center space-y-2">
              <XCircle className="w-8 h-8 text-destructive mx-auto" />
              <p className="text-sm font-medium text-destructive">Understood.</p>
              <p className="text-xs text-muted-foreground">Our service advisor will call you shortly to discuss the estimate.</p>
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Rejected</Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
