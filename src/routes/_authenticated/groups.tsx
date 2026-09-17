import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, Plus, Folder, FolderOpen, Circle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listCategories, upsertCategory, deleteCategory, categoryDeletionImpact } from "@/lib/categories.functions";
import { CategoryDialog } from "@/components/category-dialog";
import { useAuthUser } from "@/hooks/use-auth-user";

export const Route = createFileRoute("/_authenticated/groups")({
  ssr: false,
  head: () => ({ meta: [{ title: "Gruppi · Oltremani" }] }),
  component: GroupsPage,
});

type Node = any & { children: Node[] };

function buildTree(rows: any[]): Node[] {
  const map = new Map<string, Node>();
  rows.forEach(r => map.set(r.id, { ...r, children: [] }));
  const roots: Node[] = [];
  map.forEach(n => {
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.children.push(n);
    else roots.push(n);
  });
  return roots;
}

function TreeNode({ node, onEdit, onAddChild, onDelete, canManage, depth = 0 }: any) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const isRoot = depth === 0;

  return (
    <div>
      <div className={`flex items-center gap-2 py-2 px-2 rounded-lg group hover:bg-muted/50 transition-colors ${isRoot ? "mb-0.5" : ""}`}>
        <button
          onClick={() => hasChildren && setOpen(o => !o)}
          className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors ${hasChildren ? "cursor-pointer" : "cursor-default"}`}
        >
          {hasChildren
            ? (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)
            : <span className="w-4" />}
        </button>

        {hasChildren
          ? (open
            ? <FolderOpen className={`h-4 w-4 flex-shrink-0 ${isRoot ? "text-primary" : "text-amber-500"}`} />
            : <Folder className={`h-4 w-4 flex-shrink-0 ${isRoot ? "text-primary" : "text-amber-500"}`} />)
          : <Circle className="h-2 w-2 flex-shrink-0 text-muted-foreground/50 mx-1 fill-current" />}

        <span className={`flex-1 ${isRoot ? "text-sm font-semibold text-foreground" : "text-sm text-foreground/80"}`}>
          {node.name}
          {(node.activist > 0 || node.citizen > 0) && (
            <span className="ml-1.5 text-xs text-muted-foreground font-normal">
              {"("}
              {node.activist > 0 && <span className="text-[#E8921E]">{node.activist} att.</span>}
              {node.activist > 0 && node.citizen > 0 && ", "}
              {node.citizen > 0 && <span className="text-[#1E3271]">{node.citizen} cit.</span>}
              {")"}
            </span>
          )}
        </span>

        {node.status === "inactive" && (
          <Badge variant="outline" className="rounded-full text-xs">inattivo</Badge>
        )}

        {canManage && (
          <div className="ml-auto opacity-0 group-hover:opacity-100 transition flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onAddChild(node)}>+ figlio</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onEdit(node)}>Modifica</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => onDelete(node)}>Elimina</Button>
          </div>
        )}
      </div>

      {open && hasChildren && (
        <div className="ml-6 pl-3 border-l-2 border-border/30 mt-0.5 mb-1 space-y-0.5">
          {node.children.map((c: Node) => (
            <TreeNode key={c.id} node={c} onEdit={onEdit} onAddChild={onAddChild} onDelete={onDelete} canManage={canManage} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupsPage() {
  const qc = useQueryClient();
  const { profile } = useAuthUser();
  const canManage = profile?.role === "admin" || profile?.role === "superuser";

  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });

  const tree = useMemo(
    () => buildTree((data ?? []).filter(r => r.category_type === "territorial")),
    [data]
  );

  function startAdd(parent?: any) {
    setEditing({ parent_id: parent?.id ?? null, category_type: "territorial", status: "active" });
    setOpen(true);
  }

  const [pendingDelete, setPendingDelete] = useState<any | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  // Asked when the dialog opens, not on page load: it is one query per group and the
  // counts have to be the ones at the moment of asking.
  const { data: impact, isLoading: impactLoading } = useQuery({
    queryKey: ["category-deletion-impact", pendingDelete?.id],
    queryFn: () => categoryDeletionImpact({ data: { id: pendingDelete.id } }),
    enabled: !!pendingDelete,
  });

  // Every other territorial group. The one being deleted is excluded, obviously, but so
  // is Validation — parking contacts in the triage queue is not a destination.
  const moveTargets = (data ?? []).filter(
    (c: any) =>
      c.category_type === "territorial" &&
      c.id !== pendingDelete?.id &&
      c.name.toLowerCase() !== "validation",
  );

  const needsTarget = (impact?.contacts ?? 0) > 0;

  function handleDelete(node: any) {
    setMoveTo("");
    setPendingDelete(node);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await deleteCategory({
        data: { id: pendingDelete.id, reassign_to_id: needsTarget ? moveTo : null },
      });
      toast.success(
        res.reassigned
          ? `Gruppo eliminato, ${res.reassigned} ${res.reassigned === 1 ? "contatto spostato" : "contatti spostati"}`
          : "Gruppo eliminato",
      );
      qc.invalidateQueries({ queryKey: ["categories"] });
      setPendingDelete(null);
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell
      title="Gruppi"
      subtitle="Struttura territoriale"
      actions={
        canManage
          ? <Button onClick={() => startAdd()}><Plus className="h-4 w-4 mr-2" />Nuovo gruppo</Button>
          : null
      }
    >
      <Card className="p-4 rounded-2xl border-0 shadow-sm">
        {tree.length === 0
          ? <p className="text-muted-foreground text-sm">Nessun gruppo territoriale definito.</p>
          : tree.map(n => (
            <TreeNode
              key={n.id}
              node={n}
              onEdit={(node: any) => { setEditing(node); setOpen(true); }}
              onAddChild={startAdd}
              onDelete={handleDelete}
              canManage={canManage}
            />
          ))
        }
      </Card>

      <CategoryDialog
        open={open}
        onOpenChange={setOpen}
        categories={data ?? []}
        initial={editing}
        onSaved={async (vals) => {
          try {
            await upsertCategory({ data: vals });
            toast.success("Salvato");
            qc.invalidateQueries({ queryKey: ["categories"] });
            setOpen(false);
          } catch (e: any) {
            toast.error(e.message ?? "Errore");
          }
        }}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare il gruppo "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {impactLoading ? (
                  <p className="text-sm">Controllo chi c'è dentro…</p>
                ) : (
                  <>
                    {needsTarget ? (
                      <>
                        <p>
                          Ci sono <strong>{impact?.contacts}</strong>{" "}
                          {impact?.contacts === 1 ? "contatto" : "contatti"} in questo gruppo
                          {impact?.sample?.length ? <> ({impact.sample.join(", ")}{(impact.contacts ?? 0) > impact.sample.length ? ", …" : ""})</> : null}.
                          Scegli dove spostarli: il gruppo non si può eliminare lasciandoli senza.
                        </p>
                        <div className="pt-1">
                          <Select value={moveTo} onValueChange={setMoveTo}>
                            <SelectTrigger><SelectValue placeholder="Sposta i contatti in…" /></SelectTrigger>
                            <SelectContent>
                              {moveTargets.map((c: any) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : (
                      <p>Il gruppo è vuoto: non c'è nessun contatto da spostare.</p>
                    )}

                    {impact?.children?.length ? (
                      <p className="text-xs">
                        I sottogruppi <strong>{impact.children.join(", ")}</strong> non vengono
                        eliminati: restano, senza gruppo padre.
                      </p>
                    ) : null}
                    {impact?.users ? (
                      <p className="text-xs">
                        {impact.users} {impact.users === 1 ? "utente ha" : "utenti hanno"} questo
                        gruppo assegnato: l'assegnazione sparisce. Non cambia cosa vedono — la
                        visibilità dei contatti non dipende più dai gruppi.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || impactLoading || (needsTarget && !moveTo)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
            >
              {deleting ? "Eliminazione…" : needsTarget ? "Sposta ed elimina" : "Elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
