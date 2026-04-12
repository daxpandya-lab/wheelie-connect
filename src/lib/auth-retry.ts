import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AuthError } from "@supabase/supabase-js";

function isNetworkError(error: AuthError): boolean {
  const msg = error.message?.toLowerCase() || "";
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("err_connection")
  );
}

export function getFriendlyErrorMessage(error: AuthError): string {
  if (isNetworkError(error)) {
    return "Connection failed. Please check your internet and try again.";
  }
  return error.message;
}

export async function signInWithRetry(
  email: string,
  password: string,
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error) return { data, error: null };
      if (!isNetworkError(error) || attempt === maxRetries) {
        return { data, error };
      }
      toast.info(`Reconnecting... (attempt ${attempt}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, 2000));
    } catch {
      if (attempt === maxRetries) {
        return {
          data: { session: null, user: null },
          error: { message: "Unable to connect. Please check your internet and try again." } as AuthError,
        };
      }
      toast.info(`Reconnecting... (attempt ${attempt}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return {
    data: { session: null, user: null },
    error: { message: "Unable to connect after multiple attempts." } as AuthError,
  };
}
