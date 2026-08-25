import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UserRole = "admin" | "user" | null;

export function useUserRole() {
  const [role, setRole] = useState<UserRole>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Mulai dengan loading=true, jangan pernah anggap "tidak login" sebelum cek selesai
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchRole(uid: string) {
      try {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid)
          .limit(1)
          .single();
        if (!mounted) return;
        setRole((data?.role as UserRole) ?? null);
      } catch {
        if (mounted) setRole(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    // onAuthStateChange fires immediately dengan session yang ada (INITIAL_SESSION event)
    // Ini lebih reliable daripada getSession() yang bisa race condition
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUserId(session.user.id);
        fetchRole(session.user.id);
      } else {
        setRole(null);
        setUserId(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { role, userId, loading };
}
