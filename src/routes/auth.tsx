import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Accedi · Oltremani" },
      { name: "description", content: "Area riservata Oltremani" },
    ],
  }),
  component: AuthPage,
});


function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("Credenziali non valide");
      return;
    }
    navigate({ to: "/dashboard" });
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email) { toast.error("Inserisci la tua email"); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setResetSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo-color.png" alt="Oltremani" className="h-12 w-auto" />
        </div>

        <Card className="p-8 shadow-sm border-border">
          {resetMode ? (
            resetSent ? (
              <div className="text-center space-y-4">
                <p className="text-sm font-medium">Email inviata!</p>
                <p className="text-sm text-muted-foreground">
                  Controlla la tua casella di posta e segui il link per reimpostare la password.
                </p>
                <Button variant="ghost" className="w-full" onClick={() => { setResetMode(false); setResetSent(false); }}>
                  Torna al login
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-muted-foreground mb-6 text-center">
                  Inserisci la tua email e ti invieremo un link per reimpostare la password.
                </p>
                <form onSubmit={handleReset} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-email">Email</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="nome@esempio.it"
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full mt-2">
                    {loading ? "Invio in corso…" : "Invia link di reset"}
                  </Button>
                </form>
                <button
                  type="button"
                  onClick={() => setResetMode(false)}
                  className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Torna al login
                </button>
              </>
            )
          ) : (
            <>
              <p className="text-sm font-medium text-muted-foreground mb-6 text-center">
                Accedi all'area riservata
              </p>
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="nome@esempio.it"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full mt-2">
                  {loading ? "Accesso in corso…" : "Accedi"}
                </Button>
              </form>
              <button
                type="button"
                onClick={() => setResetMode(true)}
                className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Ho dimenticato la password
              </button>
            </>
          )}
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Per assistenza contatta l'amministratore
        </p>
      </div>
    </div>
  );
}
