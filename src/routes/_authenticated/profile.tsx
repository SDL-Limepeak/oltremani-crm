import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthUser } from "@/hooks/use-auth-user";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, User, Mail, Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  ssr: false,
  head: () => ({ meta: [{ title: "Profilo · Oltremani" }] }),
  component: ProfilePage,
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", superuser: "Superuser", coordinator: "Coordinatore", volunteer: "Volontario",
};

function ProfilePage() {
  const { profile, user } = useAuthUser();
  const nav = useNavigate();

  async function logout() {
    await supabase.auth.signOut();
    nav({ to: "/auth" });
  }

  return (
    <AppShell title="Profilo" subtitle="Informazioni account">
      <div className="max-w-md">
        <Card className="p-6 rounded-2xl border-0 shadow-sm space-y-5">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Nome</p>
                <p className="text-sm font-medium">{profile?.name || "—"}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Email</p>
                <p className="text-sm font-medium">{user?.email || "—"}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Ruolo</p>
                <Badge className="rounded-full">{ROLE_LABEL[profile?.role ?? ""] ?? profile?.role ?? "—"}</Badge>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border/40 space-y-2">
            <p className="text-xs text-muted-foreground">
              Per modificare nome, email o password contatta un amministratore o usa{" "}
              <strong>"Ho dimenticato la password"</strong> nella pagina di accesso.
            </p>
            <Button variant="destructive" onClick={logout}>
              <LogOut className="h-4 w-4 mr-2" />Esci
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
