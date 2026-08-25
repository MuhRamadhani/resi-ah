import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UserRole = "admin" | "user" | null;

async function fetchRoleForUser(uid: string): Promise<UserRole> {
  try {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .limit(1)
      .single();
    return (data?.role as UserRole) ?? null;
  } catch {
    return null;
  }
}

export function useUserRole() {
  const [role, setRole] = useState<UserRole>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 1. Cek session yang sudah ada dulu (sync-ish, tidak tunggu event)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        setUserId(session.user.id);
        const r = await fetchRoleForUser(session.user.id);
        if (!mounted) return;
        setRole(r);
      }
      // Selesai loading awal — baik ada session atau tidak
      setLoading(false);
    });

    // 2. Listen perubahan auth (login/logout setelah init)
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUserId(session.user.id);
        const r = await fetchRoleForUser(session.user.id);
        if (!mounted) return;
        setRole(r);
        setLoading(false);
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
