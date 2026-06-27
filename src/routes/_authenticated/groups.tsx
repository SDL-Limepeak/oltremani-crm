import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, Plus } from "lucide-react";
import { listCategories, upsertCategory, deleteCategory } from "@/lib/categories.functions";
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

function TreeNode({ node, onEdit, onAddChild, onDelete, canManage }: any) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ml-2">
      <div className="flex items-center gap-2 py-2 group">
        {node.children.length ? (
          <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="font-medium">{node.name}</span>
        <Badge variant="secondary" className="rounded-full text-xs">{node.category_type}</Badge>
        {node.status === "inactive" && <Badge variant="outline" className="rounded-full text-xs">inattivo</Badge>}
        {canManage && (
          <div className="ml-auto opacity-0 group-hover:opacity-100 transition flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => onAddChild(node)}>+ figlio</Button>
            <Button size="sm" variant="ghost" onClick={() => onEdit(node)}>Modifica</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(node)}>Elimina</Button>
          </div>
        )}
      </div>
      {open && node.children.length > 0 && (
        <div className="border-l border-border/40 pl-3">
          {node.children.map((c: Node) => (
            <TreeNode key={c.id} node={c} onEdit={onEdit} onAddChild={onAddChild} onDelete={onDelete} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupsPage() {
  const qc = useQueryClient();
  const { profile } = useAuthUser();
  const canManage = profile?.role === "admin" || profile?.role === "superuser" || profile?.role === "coordinator";
  const { data } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const tree = useMemo(() => buildTree(data ?? []), [data]);

  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  function startAdd(parent?: any) {
    setEditing({ parent_id: parent?.id ?? null, category_type: "territorial", status: "active" });
    setOpen(true);
  }

  async function handleDelete(node: any) {
    if (!confirm(`Eliminare il gruppo "${node.name}"?`)) return;
    try {
      await deleteCategory({ data: { id: node.id } });
      toast.success("Gruppo eliminato");
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    }
  }

  return (
    <AppShell
      title="Gruppi"
      subtitle="Struttura territoriale e visibilità"
      actions={canManage ? <Button onClick={() => startAdd()}><Plus className="h-4 w-4 mr-2" />Nuovo gruppo</Button> : null}
    >
      <Card className="p-4 rounded-2xl border-0 shadow-sm">
        {tree.length === 0 && <p className="text-muted-foreground text-sm">Nessun gruppo definito.</p>}
        {tree.map(n => (
          <TreeNode key={n.id} node={n} onEdit={(node: any) => { setEditing(node); setOpen(true); }} onAddChild={startAdd} onDelete={handleDelete} canManage={canManage} />
        ))}
      </Card>
      <CategoryDialog
        open={open}
        onOpenChange={setOpen}
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
    </AppShell>
  );
}
