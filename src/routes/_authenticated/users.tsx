import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { listUsers, upsertUser, deleteUser } from "@/lib/users.functions";
import { listCategories } from "@/lib/categories.functions";
import { UserDialog } from "@/components/user-dialog";
import { useAuthUser } from "@/hooks/use-auth-user";

export const Route = createFileRoute("/_authenticated/users")({
  ssr: false,
  head: () => ({ meta: [{ title: "Utenti · Oltremani" }] }),
  component: UsersPage,
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", superuser: "Superuser", coordinator: "Coordinatore", volunteer: "Volontario",
};

function UsersPage() {
  const { profile } = useAuthUser();
  const canManage = profile?.role === "admin" || profile?.role === "superuser" || profile?.role === "coordinator";
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });

  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  // Hide admin rows from UI (per spec)
  const rows = (users ?? []).filter((u: any) => u.role !== "admin");

  return (
    <AppShell
      title="Utenti"
      subtitle="Operatori del sistema"
      actions={canManage ? <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4 mr-2" />Nuovo utente</Button> : null}
    >
      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-4">Nome</th><th className="p-4">Email</th><th className="p-4">Ruolo</th><th className="p-4">Gruppi</th><th className="p-4">Stato</th><th /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-muted-foreground">Nessun utente.</td></tr>}
              {rows.map((u: any) => (
                <tr key={u.id} className="border-t border-border/40">
                  <td className="p-4 font-medium">{u.name}</td>
                  <td className="p-4 text-muted-foreground">{u.email}</td>
                  <td className="p-4">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      {u.res_user_category_rel?.map((r: any) => (
                        <Badge key={r.category_id} variant="secondary" className="rounded-full">{r.res_partner_category?.name}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-4"><Badge variant={u.status === "active" ? "default" : "secondary"} className="rounded-full">{u.status}</Badge></td>
                  <td className="p-4 text-right">
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(u); setOpen(true); }}>Modifica</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                          if (!confirm(`Eliminare "${u.name}"?`)) return;
                          try {
                            await deleteUser({ data: { id: u.id } });
                            toast.success("Utente eliminato");
                            qc.invalidateQueries({ queryKey: ["users"] });
                          } catch (e: any) { toast.error(e.message ?? "Errore"); }
                        }}>Elimina</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <UserDialog
        open={open}
        onOpenChange={setOpen}
        initial={editing}
        categories={cats ?? []}
        onSaved={async (vals) => {
          try {
            await upsertUser({ data: vals });
            toast.success("Salvato");
            qc.invalidateQueries({ queryKey: ["users"] });
            setOpen(false);
          } catch (e: any) {
            toast.error(e.message ?? "Errore");
          }
        }}
      />
    </AppShell>
  );
}
