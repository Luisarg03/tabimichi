"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "./supabase/client";

export interface UserProfile {
  display_name: string;
  role: "user" | "admin";
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Current profile (display name + role), fetched from /api/me. */
  profile: UserProfile | null;
  /** True when the user arrived via a password-recovery link. */
  recoveryMode: boolean;
  signUp: (
    email: string,
    password: string
  ) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
  /** Send a password-recovery email (redirects back to /settings). */
  resetPassword: (email: string) => Promise<{ error?: string }>;
  /** Set a new password (used from recovery mode and account settings). */
  updatePassword: (password: string) => Promise<{ error?: string }>;
  /** Request an email change (confirmation sent to the new address). */
  updateEmail: (email: string) => Promise<{ error?: string }>;
  /** Update the profile display name (via update_display_name RPC). */
  updateDisplayName: (name: string) => Promise<{ error?: string }>;
  /** Permanently delete the account (server route + admin API). */
  deleteAccount: () => Promise<{ error?: string }>;
  /** Re-fetch the profile from /api/me. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setProfile(null);
        return;
      }
      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        setProfile(null);
        return;
      }
      const data = (await res.json()) as { profile: UserProfile | null };
      setProfile(data.profile);
    } catch {
      setProfile(null);
    }
  }, [getToken]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session) refreshProfile();
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === "PASSWORD_RECOVERY") {
        // User clicked the "reset password" link in their email: they are now
        // authenticated with a recovery session — show the new-password form.
        setRecoveryMode(true);
        refreshProfile();
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        refreshProfile();
      }
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setRecoveryMode(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, refreshProfile]);

  const signUp = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: email.split("@")[0] } },
      });
      // When email confirmations are disabled (or already confirmed), signUp
      // returns an active session and the user is logged in immediately.
      return { error: error?.message, needsConfirmation: !data.session };
    },
    [supabase]
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);

  const resetPassword = useCallback(
    async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/settings`,
      });
      return { error: error?.message };
    },
    [supabase]
  );

  const updatePassword = useCallback(
    async (password: string) => {
      const { error } = await supabase.auth.updateUser({ password });
      if (!error) {
        // A successful change clears the recovery session claim.
        setRecoveryMode(false);
      }
      return { error: error?.message };
    },
    [supabase]
  );

  const updateEmail = useCallback(
    async (email: string) => {
      const { error } = await supabase.auth.updateUser({ email });
      return { error: error?.message };
    },
    [supabase]
  );

  const updateDisplayName = useCallback(
    async (name: string) => {
      const { error } = await supabase.rpc("update_display_name", { new_name: name });
      if (error) return { error: error.message };
      await refreshProfile();
      return {};
    },
    [supabase, refreshProfile]
  );

  const deleteAccount = useCallback(async () => {
    const token = await getToken();
    if (!token) return { error: "no active session" };
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        return { error: data.error ?? "could not delete account" };
      }
      await supabase.auth.signOut();
      return {};
    } catch {
      return { error: "could not delete account" };
    }
  }, [getToken, supabase]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        profile,
        recoveryMode,
        signUp,
        signIn,
        signOut,
        getToken,
        resetPassword,
        updatePassword,
        updateEmail,
        updateDisplayName,
        deleteAccount,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
