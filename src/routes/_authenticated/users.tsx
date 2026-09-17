import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { listUsers, upsertUser, deleteUser, setUserStatus } from "@/lib/users.functions";
import { listCategories } from "@/lib/categories.functions";
import { UserDialog } from "@/components/user-dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuthUser } from "@/hooks/use-auth-user";

export const Route = createFileRoute("/_authenticated/users")({
  ssr: false,
  head: () => ({ meta: [{ title: "Utenti · Oltremani" }] }),
  component: UsersPage,
});

// "Ruolo" is now called "Profilo" throughout user management: the contacts have roles
// too (res_partner_role) and the two were being read as the same thing.
const PROFILE_LABEL: Record<string, string> = {
  admin: "Admin", superuser: "Superuser", coordinator: "Coordinatore", volunteer: "Volontario",
};

/** Mirrors role_rank / can_manage_user in the database and in users.functions.ts. */
const PROFILE_RANK: Record<string, number> = {
  admin: 4, superuser: 3, coordinator: 2, volunteer: 1,
};

function UsersPage() {
  const { profile } = useAuthUser();
  // Who may create at all: anyone with something below them. A volunteer has nobody.
  const canCreate = profile?.role === "admin" || profile?.role === "superuser" || profile?.role === "coordinator";
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });

  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<any | null>(null);
  const [pendingStatus, setPendingStatus] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Only an admin deletes. Everyone else disables, which is reversible.
  const canDelete = profile?.role === "admin";

  /**
   * Whether the signed-in user may act on this row. Strictly-lower profile, or admin.
   * Admin rows are excluded for everybody: trg_protect_admin refuses the write anyway, so
   * offering the button would only produce an error.
   */
  function canActOn(u: any): boolean {
    if (!profile || u.id === profile.id || u.role === "admin") return false;
    if (profile.role === "admin") return true;
    return (PROFILE_RANK[profile.role] ?? 0) > (PROFILE_RANK[u.role] ?? 0);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteUser({ data: { id: pendingDelete.id } });
      toast.success("Utente eliminato");
      qc.invalidateQueries({ queryKey: ["users"] });
      setPendingDelete(null);
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setDeleting(false);
    }
  }

  async function confirmStatus() {
    if (!pendingStatus) return;
    const next = pendingStatus.status === "active" ? "inactive" : "active";
    setSwitching(true);
    try {
      await setUserStatus({ data: { id: pendingStatus.id, status: next } });
      toast.success(next === "inactive" ? "Utente disabilitato" : "Utente riabilitato");
      qc.invalidateQueries({ queryKey: ["users"] });
      setPendingStatus(null);
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setSwitching(false);
    }
  }

  // Admin rows stay out of this list: they cannot be edited, disabled or deleted from
  // the application at all.
  const rows = (users ?? []).filter((u: any) => u.role !== "admin");

  return (
    <AppShell
      title="Utenti"
      subtitle="Operatori del sistema"
      actions={canCreate ? <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4 mr-2" />Nuovo utente</Button> : null}
    >
      <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-4">Nome</th><th className="p-4">Email</th><th className="p-4">Profilo</th><th className="p-4">Gruppi</th><th className="p-4">Stato</th><th /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-muted-foreground">Nessun utente.</td></tr>}
              {rows.map((u: any) => (
                <tr key={u.id} className="border-t border-border/40">
                  <td className="p-4 font-medium">{u.name}</td>
                  <td className="p-4 text-muted-foreground">{u.email}</td>
                  <td className="p-4">{PROFILE_LABEL[u.role] ?? u.role}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap items-center gap-1">
                      {u.res_user_category_rel?.map((r: any) => (
                        <Badge key={r.category_id} variant="secondary" className="rounded-full">{r.res_partner_category?.name}</Badge>
                      ))}
                      {/* The "Nessun gruppo" warning was removed on 2026-09-17: groups
                          stopped limiting what a user can see, so an empty list is no
                          longer a problem to flag. */}
                      {!u.res_user_category_rel?.length && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <Badge variant={u.status === "active" ? "default" : "secondary"} className="rounded-full">
                      {u.status === "active" ? "Attivo" : "Disabilitato"}
                    </Badge>
                  </td>
                  <td className="p-4 text-right whitespace-nowrap">
                    {canActOn(u) && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(u); setOpen(true); }}>Modifica</Button>
                        <Button size="sm" variant="ghost" onClick={() => setPendingStatus(u)}>
                          {u.status === "active" ? "Disabilita" : "Riabilita"}
                        </Button>
                        {canDelete && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPendingDelete(u)}>Elimina</Button>
                        )}
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

      <AlertDialog open={!!pendingStatus} onOpenChange={(o) => { if (!o) setPendingStatus(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingStatus?.status === "active" ? "Disabilitare l'utente?" : "Riabilitare l'utente?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStatus?.status === "active" ? (
                <>
                  <strong>{pendingStatus?.name}</strong> ({pendingStatus?.email}) non potrà più
                  accedere e perderà ogni permesso, ma l'account e la sua cronologia restano.
                  Puoi riabilitarlo quando vuoi.
                </>
              ) : (
                <>
                  <strong>{pendingStatus?.name}</strong> ({pendingStatus?.email}) torna a poter
                  accedere con il profilo che aveva.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={switching}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmStatus(); }}
              disabled={switching}
            >
              {switching ? "Attendi…" : pendingStatus?.status === "active" ? "Disabilita" : "Riabilita"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare l'utente?</AlertDialogTitle>
            <AlertDialogDescription>
              Stai per rimuovere <strong>{pendingDelete?.name}</strong> ({pendingDelete?.email})
              dal database, insieme all'account di accesso e alle sue assegnazioni ai gruppi.
              L'operazione non è annullabile: se ti serve solo togliergli l'accesso, usa
              <strong> Disabilita</strong>. Le voci del registro attività restano.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminazione…" : "Elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
