import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import {
  LayoutDashboard, Users, CreditCard, FolderTree, MapPin,
  ShieldCheck, User, HeartHandshake, Home, UserRound,
  BadgeCheck, FileText, Key,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/guida")({
  ssr: false,
  head: () => ({ meta: [{ title: "Guida · Oltremani" }] }),
  component: GuidaPage,
});

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6 rounded-2xl border-0 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-5 w-5 text-[#E8921E]" />
        <h2 className="font-serif text-lg font-semibold">{title}</h2>
      </div>
      <div className="space-y-1.5 text-sm text-foreground/80">
        {children}
      </div>
    </Card>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-[#E8921E] flex-shrink-0 mt-0.5 font-bold">·</span>
      <span>{children}</span>
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 pl-5">
      <span className="text-muted-foreground flex-shrink-0 mt-0.5">–</span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

function GuidaPage() {
  return (
    <AppShell title="Guida" subtitle="Come usare il CRM Oltremani">
      <div className="space-y-4">

        {/* Accesso */}
        <Section icon={Key} title="Accesso">
          <Li>Accedi con la tua email e password fornite dall'amministratore.</Li>
          <Li>Se hai dimenticato la password, clicca <strong>"Ho dimenticato la password"</strong> nella schermata di login — riceverai un link via email per reimpostarla.</Li>
          <Li>Per cambiare nome, email o password contatta un amministratore.</Li>
        </Section>

        {/* Dashboard */}
        <Section icon={LayoutDashboard} title="Dashboard">
          <Li><strong>Contatori in alto</strong>: totale contatti, nuovi, attivi, tessere attive dell'anno corrente.</Li>
          <Li><strong>Grafico Attivisti e Cittadini</strong>: distribuzione per tipo — passa il mouse su ogni fetta per vedere la suddivisione per stato (nuovo/attivo/rifiutato/inattivo).</Li>
          <Li><strong>Grafico Cittadini per gruppo</strong>: quanti cittadini appartengono a ciascun gruppo territoriale.</Li>
          <Li><strong>Form ricevuti</strong>: ultimi contatti arrivati dal form pubblico del sito.</Li>
          <Li><strong>Attività recente</strong>: le ultime modifiche ai dati (visibile agli admin).</Li>
        </Section>

        {/* Contatti */}
        <Section icon={Users} title="Contatti">
          <Li><strong>Cerca</strong>: usa la barra di ricerca in cima alla lista. Filtra per tipo (Attivista / Cittadino / Non specificato) e per stato.</Li>
          <Li><strong>Ordine lista</strong>: Nuovi → Attivi → Rifiutati → Inattivi.</Li>
          <Li><strong>Nuovo contatto</strong>: clicca il pulsante <strong>"Nuovo contatto"</strong> in alto a destra.</Li>
          <Li><strong>Scheda contatto</strong>: clicca sul nome per aprire la scheda. Contiene 4 tab:</Li>
          <Sub><strong>Dati</strong>: anagrafica, tipo, stato, città, gruppi, note. Scegli sempre tipo e stato prima di salvare.</Sub>
          <Sub><strong>Tessere</strong>: storico tesseramenti, pulsante "Emetti nuova tessera", revoca tessera attiva.</Sub>
          <Sub><strong>Consensi</strong>: storico consensi Privacy Policy. Aggiungi un nuovo consenso specificando canale e data.</Sub>
          <Sub><strong>Cronologia</strong>: log di ogni modifica al contatto (solo admin).</Sub>
          <Li><strong>Tipo contatto</strong>:</Li>
          <Sub><HeartHandshake className="h-3.5 w-3.5 inline mr-1 text-[#E8921E]" />Attivista — volontario attivo nell'associazione.</Sub>
          <Sub><Home className="h-3.5 w-3.5 inline mr-1 text-[#1E3271]" />Cittadino — cittadino del territorio seguito.</Sub>
          <Sub><UserRound className="h-3.5 w-3.5 inline mr-1 text-muted-foreground" />Non specificato — tipo non ancora classificato.</Sub>
          <Li><strong>Stato contatto</strong>: Nuovo (appena inserito) → Attivo (membro a tutti gli effetti) → Rifiutato (ha declinato) → Inattivo (uscito).</Li>
          <Li><strong>Telefono</strong>: inserisci sempre il prefisso internazionale (es. +39 per l'Italia). Usa il campo <em>Telefono alternativo</em> per un secondo numero.</Li>
          <Li><strong>Assegnazione gruppo</strong>: nella scheda Dati, seleziona i gruppi territoriali a cui il contatto appartiene cliccando i badge. Un contatto senza gruppo è segnalato con un avviso arancione.</Li>
          <Li><strong>CSV export</strong>: pulsante <strong>"Esporta CSV"</strong> disponibile solo per gli admin.</Li>
        </Section>

        {/* Tessere */}
        <Section icon={CreditCard} title="Tessere (Tesseramenti)">
          <Li>Dalla lista <strong>Tesseramenti</strong> puoi vedere tutte le tessere dell'anno corrente con stato e numero.</Li>
          <Li><strong>Emettere una tessera</strong>: apri la scheda del contatto → tab Tessere → "Emetti nuova tessera". Seleziona l'anno.</Li>
          <Sub>Il numero viene assegnato automaticamente nel formato <strong>YYXXXXX</strong> (anno + progressivo).</Sub>
          <Li><strong>Revocare una tessera</strong>: clicca il pulsante <strong>Revoca</strong> a sinistra del badge. L'operazione è irreversibile.</Li>
          <Li>Un contatto può avere una sola tessera attiva per anno. Dopo la revoca è possibile emetterne una nuova.</Li>
          <Li>Badge colori: <strong className="text-emerald-700">TESSERATO</strong> (verde), <strong className="text-destructive">REVOCATO</strong> (rosso), <strong>INATTIVO</strong> (grigio).</Li>
        </Section>

        {/* Gruppi */}
        <Section icon={FolderTree} title="Gruppi territoriali">
          <Li>I gruppi sono organizzati ad <strong>albero</strong>: un gruppo può avere sottogruppi figli.</Li>
          <Li>Accanto al nome del gruppo sono indicati il numero di <span className="text-[#E8921E] font-medium">attivisti</span> e di <span className="text-[#1E3271] font-medium">cittadini</span> assegnati.</Li>
          <Li><strong>Nuovo gruppo</strong>: clicca "Nuovo gruppo" in alto a destra. Puoi scegliere il gruppo padre.</Li>
          <Li><strong>Modificare un gruppo</strong>: hover sul nome → "Modifica". Puoi cambiare nome, stato, gruppo padre, presidente (cercato tra i contatti censiti), dati di contatto e IBAN.</Li>
          <Li><strong>Aggiungere un figlio</strong>: hover sul nome del gruppo padre → "+ figlio".</Li>
          <Li><strong>Eliminare un gruppo</strong>: hover → "Elimina". I contatti assegnati restano, perdono solo l'assegnazione a quel gruppo.</Li>
        </Section>

        {/* Città */}
        <Section icon={MapPin} title="Città">
          <Li>Elenco dei comuni italiani (pre-caricato). Cerca per nome nella barra in cima.</Li>
          <Li><strong>Assegnare un comune a un gruppo</strong>: nella colonna <em>Gruppo</em>, seleziona il gruppo dal menu a tendina.</Li>
          <Sub>L'assegnazione città–gruppo è informativa: determina a quale gruppo appartengono i contatti di quella città.</Sub>
          <Li>La modifica è disponibile solo per admin e superuser.</Li>
        </Section>

        {/* Utenti */}
        <Section icon={ShieldCheck} title="Utenti (Amministrazione)">
          <Li>Visibile a coordinatori, superuser e admin.</Li>
          <Li><strong>Ruoli disponibili</strong>:</Li>
          <Sub><strong>Admin</strong>: accesso completo, incluso audit log e export CSV.</Sub>
          <Sub><strong>Superuser</strong>: gestione contatti, tessere, gruppi, città e utenti.</Sub>
          <Sub><strong>Coordinatore</strong>: gestione contatti e tessere del proprio gruppo.</Sub>
          <Sub><strong>Volontario</strong>: consultazione e inserimento contatti base.</Sub>
          <Li><strong>Nuovo utente</strong>: clicca "Nuovo utente". L'email deve essere valida (con @). L'utente riceverà un'email per impostare la password.</Li>
          <Li>Non puoi modificare o eliminare il tuo stesso account dalla lista utenti.</Li>
        </Section>

        {/* Profilo */}
        <Section icon={User} title="Profilo">
          <Li>Clicca <strong>Profilo</strong> nel menu in basso a sinistra per vedere il tuo nome, email e ruolo.</Li>
          <Li>Per uscire dall'applicazione clicca il pulsante <strong>"Esci"</strong>.</Li>
          <Li>Password dimenticata? Usa il link "Ho dimenticato la password" nella pagina di login.</Li>
        </Section>

        {/* Glossario */}
        <Section icon={FileText} title="Glossario rapido">
          <Li><strong>Attivista</strong>: volontario attivo nell'associazione.</Li>
          <Li><strong>Cittadino</strong>: residente/cittadino del territorio seguito dall'associazione.</Li>
          <Li><strong>Nuovo</strong>: contatto appena inserito, non ancora classificato.</Li>
          <Li><strong>Attivo</strong>: membro confermato e partecipante.</Li>
          <Li><strong>Rifiutato</strong>: ha rifiutato di far parte o di essere contattato.</Li>
          <Li><strong>Inattivo</strong>: era attivo ma non lo è più (storico).</Li>
          <Li><strong>TESSERATO</strong>: ha la tessera associativa attiva per l'anno corrente.</Li>
          <Li><strong>Prefisso internazionale</strong>: es. +39 (Italia), +33 (Francia), +44 (UK). Va inserito prima del numero di telefono.</Li>
          <Li><strong>Audit log / Cronologia</strong>: registro di tutte le modifiche ai dati, con utente e timestamp.</Li>
        </Section>

      </div>
    </AppShell>
  );
}
