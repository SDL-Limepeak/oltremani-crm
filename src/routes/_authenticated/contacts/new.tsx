import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ContactForm } from "@/components/contact-form";

export const Route = createFileRoute("/_authenticated/contacts/new")({
  ssr: false,
  head: () => ({ meta: [{ title: "Nuovo contatto · Oltremani" }] }),
  component: NewContactPage,
});

function NewContactPage() {
  const nav = useNavigate();
  return (
    <AppShell title="Nuovo contatto" subtitle="Aggiungi un contatto alla rubrica">
      <ContactForm onSaved={(id: string) => nav({ to: "/contacts/$id", params: { id } })} />
    </AppShell>
  );
}
