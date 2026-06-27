import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthUser } from "@/hooks/use-auth-user";
import { updateProfile } from "@/lib/users.functions";
import { supabase } from "@/integrations/supabase/client";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  ssr: false,
  head: () => ({ meta: [{ title: "Profilo · Oltremani" }] }),
  component: ProfilePage,
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", superuser: "Superuser", coordinator: "Coordinatore", volunteer: "Volontario",
};

function ProfilePage() {
  const { profile, user, refresh } = useAuthUser();
  const nav = useNavigate();
  const [name, setName] = useState(profile?.name ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { setName(profile?.name ?? ""); }, [profile?.name]);

  async function saveName() {
    setLoading(true);
    try {
      await updateProfile({ data: { name } });
      await refresh();
      toast.success("Profilo aggiornato");
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
    setLoading(false);
  }

  async function changePassword() {
    if (password.length < 8) return toast.error("Minimo 8 caratteri");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) toast.error(error.message); else { toast.success("Password aggiornata"); setPassword(""); }
  }

  async function logout() {
    await supabase.auth.signOut();
    nav({ to: "/auth" });
  }

  return (
    <AppShell title="Profilo" subtitle="Gestisci il tuo account">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-6 rounded-2xl border-0 shadow-sm space-y-4">
          <div>
            <h3 className="font-serif text-lg">Informazioni</h3>
            <p className="text-sm text-muted-foreground">Email: {user?.email}</p>
            <p className="text-sm text-muted-foreground">Ruolo: <Badge className="rounded-full ml-1">{ROLE_LABEL[profile?.role ?? ""] ?? profile?.role}</Badge></p>
          </div>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
            <Button onClick={saveName} disabled={loading}>Salva nome</Button>
          </div>
        </Card>

        <Card className="p-6 rounded-2xl border-0 shadow-sm space-y-4">
          <h3 className="font-serif text-lg">Sicurezza</h3>
          <div className="space-y-2">
            <Label>Nuova password</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Almeno 8 caratteri" />
            <Button variant="outline" onClick={changePassword}>Cambia password</Button>
          </div>
          <div className="pt-4 border-t border-border/40">
            <Button variant="destructive" onClick={logout}><LogOut className="h-4 w-4 mr-2" />Esci</Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
