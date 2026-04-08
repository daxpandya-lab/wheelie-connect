import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface ProtectedRouteProps {
  requiredRoles?: AppRole[];
  children?: React.ReactNode;
}

export default function ProtectedRoute({ requiredRoles, children }: ProtectedRouteProps) {
  const { user, roles, isLoading, isTenantSuspended, signOut } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (isTenantSuspended) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <Loader2 className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Account Suspended</h1>
          <p className="text-muted-foreground">Your dealer account has been suspended. Please contact support for assistance.</p>
          <button onClick={signOut} className="text-primary hover:underline text-sm">Sign out</button>
        </div>
      </div>
    );
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequired = requiredRoles.some((r) => roles.includes(r));
    if (!hasRequired) return <Navigate to="/" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
