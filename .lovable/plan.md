

# Fix Login Reliability: Connection Retry and Error Handling

## Problem
The app gets stuck in an infinite refresh-token retry loop when the backend connection is temporarily unavailable. Every ~20 seconds, `supabase.auth.getSession()` or `onAuthStateChange` tries to refresh an expired/stale token, fails with "Failed to fetch", and retries forever -- producing a white screen or frozen login page.

## Root Cause
The browser has a stale session in localStorage with an expired refresh token. When the page loads, the Supabase client tries to refresh it, fails due to network issues, and the `isLoading` state never resolves properly, or the auth state keeps cycling.

## Plan

### 1. Add retry wrapper with network error detection (new file)
**File: `src/lib/auth-retry.ts`**

Create a utility function `signInWithRetry` that:
- Wraps `supabase.auth.signInWithPassword` 
- On "Failed to fetch" / network errors, retries up to 3 times with 2-second delays
- Shows a "Reconnecting..." toast on each retry
- Returns the final result or a clear error message like "Unable to connect. Please check your internet and try again."

### 2. Update AuthContext -- handle stale session gracefully
**File: `src/contexts/AuthContext.tsx`**

- Wrap the `getSession()` call in a try-catch
- If `getSession()` throws a fetch error, call `supabase.auth.signOut()` to clear the stale localStorage session, set `isLoading = false`, and let the user land on the login page cleanly
- Add a timeout: if `isLoading` stays true for more than 10 seconds, force it to false and clear the session (prevents permanent white screen)

### 3. Update LoginPage -- use retry logic and better UX
**File: `src/pages/LoginPage.tsx`**

- Use the new `signInWithRetry` utility instead of direct `signInWithPassword`
- The button is already disabled during `loading` state -- no change needed there
- Add specific error handling: if the error contains "fetch" or "network", show "Connection failed. Please check your internet and try again." instead of the raw error

### 4. Clear stale tokens on login page mount
**File: `src/pages/LoginPage.tsx`**

- On mount, call `supabase.auth.getSession()` and if it returns an error (stale token), call `supabase.auth.signOut()` to clear localStorage -- this breaks the infinite retry loop when users land on the published login URL with a dead session

## Technical Details

**auth-retry.ts core logic:**
```typescript
export async function signInWithRetry(email: string, password: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return { data, error: null };
    if (!isNetworkError(error) || attempt === maxRetries) return { data, error };
    toast.info(`Reconnecting... (attempt ${attempt}/${maxRetries})`);
    await new Promise(r => setTimeout(r, 2000));
  }
}
```

**AuthContext getSession fix:**
```typescript
try {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) { await supabase.auth.signOut(); }
  // ... existing logic
} catch {
  await supabase.auth.signOut();
  setIsLoading(false);
}
```

## Files Changed
- **New:** `src/lib/auth-retry.ts`
- **Edit:** `src/contexts/AuthContext.tsx`
- **Edit:** `src/pages/LoginPage.tsx`

