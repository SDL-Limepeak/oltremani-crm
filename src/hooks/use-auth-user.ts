import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type ResUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: "admin" | "superuser" | "coordinator" | "volunteer";
  status: "active" | "inactive";
};

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ResUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(currentUser: User | null) {
    if (!currentUser) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("res_users")
      .select("id, name, email, role, status")
      .eq("id", currentUser.id)
      .maybeSingle();
    setProfile((data as ResUser) ?? null);
    setLoading(false);
  }

  async function refresh() {
    const { data } = await supabase.auth.getUser();
    setUser(data.user);
    await loadProfile(data.user);
  }

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user);
      loadProfile(data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      loadProfile(session?.user ?? null);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  return { user, profile, loading, refresh };
}

