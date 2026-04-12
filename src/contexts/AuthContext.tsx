import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Database["public"]["Tables"]["profiles"]["Row"] | null;
  roles: AppRole[];
  tenantId: string | null;
  isSuperAdmin: boolean;
  isTenantAdmin: boolean;
  isTenantSuspended: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Database["public"]["Tables"]["profiles"]["Row"] | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUserData = async (userId: string) => {
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

    if (profileRes.data) setProfile(profileRes.data);
    if (rolesRes.data) setRoles(rolesRes.data.map((r) => r.role));
  };

  useEffect(() => {
    // Safety timeout: if isLoading stays true for 10s, force resolve
    loadingTimeoutRef.current = setTimeout(async () => {
      setIsLoading((prev) => {
        if (prev) {
          // Clear stale session that may be causing the hang
          supabase.auth.signOut().catch(() => {});
          return false;
        }
        return prev;
      });
    }, 10000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setTimeout(() => fetchUserData(session.user.id), 0);
        } else {
          setProfile(null);
          setRoles([]);
        }
        setIsLoading(false);
      }
    );

    // Initial session check with error handling for stale tokens
    (async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          // Stale session / network error — clear it and let user re-login
          await supabase.auth.signOut().catch(() => {});
          setSession(null);
          setUser(null);
          setProfile(null);
          setRoles([]);
          setIsLoading(false);
          return;
        }
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchUserData(session.user.id);
        }
        setIsLoading(false);
      } catch {
        // Network completely down — clear stale state
        await supabase.auth.signOut().catch(() => {});
        setSession(null);
        setUser(null);
        setProfile(null);
        setRoles([]);
        setIsLoading(false);
      }
    })();

    return () => {
      subscription.unsubscribe();
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setRoles([]);
  };

  const isSuperAdmin = roles.includes("super_admin");
  const isTenantAdmin = roles.includes("tenant_admin");
  const tenantId = profile?.tenant_id ?? null;

  // Check if tenant is suspended (non-super-admins only)
  const [tenantStatus, setTenantStatus] = useState<string | null>(null);
  useEffect(() => {
    if (tenantId && !isSuperAdmin) {
      supabase.from("tenants").select("status").eq("id", tenantId).single()
        .then(({ data }) => { if (data) setTenantStatus(data.status); });
    }
  }, [tenantId, isSuperAdmin]);

  const isTenantSuspended = !isSuperAdmin && tenantStatus !== null && tenantStatus !== "active";

  return (
    <AuthContext.Provider
      value={{
        session, user, profile, roles, tenantId,
        isSuperAdmin, isTenantAdmin, isTenantSuspended, isLoading, signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
