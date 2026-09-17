import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import {
  LayoutDashboard, Users, CreditCard, FolderTree, MapPin,
  ShieldCheck, User,
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
          <Li><strong>Grafico Contatti per ruolo</strong>: passa il mouse su ogni fetta per vedere la suddivisione per stato (nuovo/attivo/rifiutato/inattivo). Un contatto con più ruoli compare in più fette, quindi la somma supera il numero di contatti.</Li>
          <Li><strong>Grafico Contatti per gruppo</strong>: quanti contatti appartengono a ciascun gruppo territoriale.</Li>
          <Li><strong>Form ricevuti</strong>: ultimi contatti arrivati dal form pubblico del sito.</Li>
          <Li><strong>Attività recente</strong>: le ultime modifiche ai dati (visibile agli admin).</Li>
        </Section>

        {/* Contacts */}
        <Section icon={Users} title="Contatti">
          <Li><strong>Cerca</strong>: usa la barra di ricerca in cima alla lista. Filtra per <strong>ruolo</strong> (selezione multipla: scegliendone più di uno vedi i contatti che hanno almeno uno di quelli), stato, gruppo e tessera.</Li>
          <Li><strong>Ordine lista</strong>: Nuovi → Attivi → Rifiutati → Inattivi.</Li>
          <Li><strong>Nuovo contatto</strong>: clicca il pulsante <strong>"Nuovo contatto"</strong> in alto a destra.</Li>
          <Li><strong>Scheda contatto</strong>: clicca sul nome per aprire la scheda. Contiene 4 tab:</Li>
          <Sub><strong>Dati</strong>: anagrafica, stato, città, gruppi, ruoli, note.</Sub>
          <Sub><strong>Tessere</strong>: storico tesseramenti, pulsante "Emetti nuova tessera", revoca tessera attiva.</Sub>
          <Sub><strong>Consensi</strong>: storico dei consensi alla Privacy Policy. Aggiungi un nuovo consenso specificando esito e canale di raccolta.</Sub>
          <Sub>Si raccoglie <strong>solo la Privacy Policy</strong>: le due finalità aggiuntive (newsletter e marketing) non ci sono più, né nel form né qui. I consensi raccolti in passato restano registrati.</Sub>
          <Sub>Quando il consenso arriva dal form pubblico il canale è sempre <strong>Web</strong>, non è una scelta: quel form è il web.</Sub>
          <Sub><strong>Cronologia</strong>: log di ogni modifica al contatto (solo admin).</Sub>
          <Li><strong>Ruoli</strong> (sostituiscono il vecchio campo "Tipo"): se ne possono scegliere più di uno.</Li>
          <Sub>Attivista · Socio APS · Membro della comunità · Famiglia ospitante · Specialista di diritti sulle migrazioni e/o abitare</Sub>
          <Sub>Sono gli stessi che compaiono nel form pubblico. L'elenco si gestisce dal database, non è fisso nel codice.</Sub>
          <Li><strong>Colonna Tesserato</strong>: ultima colonna della lista. <strong className="text-emerald-700">✓ verde</strong> se il contatto ha una tessera attiva per l'anno in corso, <strong className="text-rose-700">✗ rosso</strong> altrimenti.</Li>
          <Li><strong>Stato contatto</strong>, nell'ordine in cui compare ovunque: <strong>Nuovo</strong> (appena inserito) → <strong>Attivo</strong> (membro a tutti gli effetti) → <strong>Inattivo</strong> (uscito) → <strong>Rifiutato</strong> (ha declinato). La lista contatti è ordinata così.</Li>
          <Sub>Mettendo un contatto su <strong>Inattivo</strong>, prima di salvare l'applicazione ti avvisa e — se confermi — disattiva anche le sue tessere attive. Il numero resta assegnato a lui.</Sub>
          <Li><strong>Telefono</strong>: inserisci sempre il prefisso internazionale (es. +39 per l'Italia). Usa il campo <em>Telefono alternativo</em> per un secondo numero.</Li>
          <Li><strong>Assegnazione gruppo</strong>: nella scheda Dati, seleziona i gruppi territoriali a cui il contatto appartiene cliccando i badge. Un contatto senza gruppo è segnalato con un avviso arancione.</Li>
          <Li><strong>Chi vede cosa</strong>: tutti gli utenti vedono e possono modificare tutti i contatti, indipendentemente dai gruppi. I gruppi restano un'informazione sul contatto, non un limite di visibilità.</Li>
          <Li><strong>Eliminare un contatto</strong>: solo admin e superuser, dal pulsante in alto nella scheda. Prima di procedere l'applicazione elenca cosa sparisce insieme a lui — tessere, consensi privacy, gruppi e ruoli. Non è annullabile.</Li>
          <Li><strong>CSV export</strong>: pulsante <strong>"Esporta CSV"</strong> disponibile ad admin, superuser e coordinatori. Esporta i contatti che stai vedendo, filtri compresi, con tutte le colonne della scheda: anagrafica, città, stato, gruppi, ruoli, tesserato sì/no per l'anno in corso, numero e anno della tessera, note e date.</Li>
        </Section>

        {/* Memberships */}
        <Section icon={CreditCard} title="Tessere (Tesseramenti)">
          <Li>Dalla lista <strong>Tesseramenti</strong> puoi vedere tutte le tessere dell'anno corrente con stato e numero.</Li>
          <Li><strong>Emettere una tessera</strong>: apri la scheda del contatto → tab Tessere → "Emetti nuova tessera". Seleziona l'anno.</Li>
          <Sub>Il <strong>numero lo scrivi tu</strong>: le tessere si compilano a mano, quindi il numero è quello stampato sulla tessera fisica. Se lasci il campo vuoto ne viene proposto uno nel formato <strong>YYXXXXX</strong> (anno + progressivo).</Sub>
          <Sub>Se il numero è già usato da un'altra tessera l'applicazione te lo dice, ma <strong>non ti blocca</strong>: puoi salvarlo lo stesso e resterà segnalato finché non lo correggi.</Sub>
          <Li><strong>Revocare una tessera</strong>: clicca il pulsante <strong>Revoca</strong> a sinistra del badge. L'operazione è irreversibile.</Li>
          <Li>Un contatto può avere <strong>una sola tessera attiva per anno</strong>. Dopo la revoca è possibile emetterne una nuova.</Li>
          <Li><strong>Triangolo giallo accanto allo stato</strong>: segnala le due situazioni da sistemare a mano — il numero è su più di una tessera, oppure lo stesso contatto ha due tessere attive per l'anno in corso. Passaci sopra il mouse per la spiegazione.</Li>
          <Li><strong>Scadenza</strong>: ogni notte le tessere attive con data di fine già passata diventano <strong>Scadute</strong> da sole. Non c'è niente da fare a mano.</Li>
          <Li>Badge colori: <strong className="text-emerald-700">TESSERATO</strong> (verde), <strong className="text-destructive">REVOCATA</strong> e <strong className="text-destructive">SCADUTA</strong> (rosso), <strong>NON ATTIVA</strong> (grigio).</Li>
        </Section>

        {/* Groups */}
        <Section icon={FolderTree} title="Gruppi territoriali">
          <Li>I gruppi sono organizzati ad <strong>albero</strong>: un gruppo può avere sottogruppi figli.</Li>
          <Li>Accanto al nome del gruppo è indicato il numero di contatti assegnati.</Li>
          <Li><strong>Nuovo gruppo</strong>: clicca "Nuovo gruppo" in alto a destra. Puoi scegliere il gruppo padre.</Li>
          <Li><strong>Modificare un gruppo</strong>: hover sul nome → "Modifica". Puoi cambiare nome, stato, gruppo padre, presidente (cercato tra i contatti censiti), dati di contatto e IBAN.</Li>
          <Li><strong>Aggiungere un figlio</strong>: hover sul nome del gruppo padre → "+ figlio".</Li>
          <Li><strong>Eliminare un gruppo</strong>: hover → "Elimina".</Li>
          <Sub>Se il gruppo ha dei contatti, <strong>devi scegliere in quale altro gruppo spostarli</strong> prima di poterlo eliminare: non si può cancellare lasciandoli senza.</Sub>
          <Sub>Se è vuoto, si elimina e basta.</Sub>
          <Sub>Gli eventuali sottogruppi non vengono eliminati: restano, senza gruppo padre.</Sub>
        </Section>

        {/* Città */}
        <Section icon={MapPin} title="Città">
          <Li>Elenco dei comuni italiani (pre-caricato). Cerca per nome nella barra in cima.</Li>
          <Li><strong>Assegnare un comune a un gruppo</strong>: nella colonna <em>Gruppo</em>, seleziona il gruppo dal menu a tendina.</Li>
          <Sub>L'assegnazione città–gruppo è informativa: determina a quale gruppo appartengono i contatti di quella città.</Sub>
          <Li>La modifica è disponibile solo per admin e superuser.</Li>
        </Section>

        {/* Users */}
        <Section icon={ShieldCheck} title="Utenti (Amministrazione)">
          <Li>Visibile a coordinatori, superuser e admin.</Li>
          <Li><strong>Profili disponibili</strong> (quello che prima si chiamava "ruolo" — i ruoli ora sono quelli dei contatti):</Li>
          <Sub><strong>Admin</strong>: accesso completo, incluso il registro attività. È l'unico che può eliminare utenti e contatti.</Sub>
          <Sub><strong>Superuser</strong>: contatti, tessere, gruppi, città, utenti. Export CSV. Può eliminare contatti.</Sub>
          <Sub><strong>Coordinatore</strong>: contatti e tessere. Export CSV.</Sub>
          <Sub><strong>Volontario</strong>: contatti in consultazione e inserimento. Niente tessere, niente export.</Sub>
          <Li><strong>Chi gestisce chi</strong>: puoi agire solo sugli utenti con un profilo <em>più basso</em> del tuo.</Li>
          <Sub>Un superuser gestisce coordinatori e volontari, ma non altri superuser.</Sub>
          <Sub>Un coordinatore gestisce i volontari.</Sub>
          <Sub>Un volontario non gestisce nessuno, nemmeno gli altri volontari.</Sub>
          <Sub>Gli admin non compaiono in questa lista e non si toccano dall'applicazione.</Sub>
          <Li><strong>Nuovo utente</strong>: clicca "Nuovo utente". L'email deve essere valida (con @). L'utente riceverà un'email per impostare la password. Puoi assegnare solo profili più bassi del tuo.</Li>
          <Li><strong>Disabilita</strong>: toglie l'accesso e ogni permesso, ma lascia l'account e la sua cronologia. È reversibile con <strong>Riabilita</strong>. È l'operazione che serve nel 99% dei casi.</Li>
          <Li><strong>Elimina</strong>: solo admin. Cancella l'account dal database insieme all'accesso e alle assegnazioni ai gruppi. Le voci del registro attività restano.</Li>
          <Li>Non puoi modificare, disabilitare o eliminare il tuo stesso account dalla lista utenti.</Li>
        </Section>

        {/* Profilo */}
        <Section icon={User} title="Profilo">
          <Li>Clicca <strong>Profilo</strong> nel menu in basso a sinistra per vedere il tuo nome, email e profilo.</Li>
          <Li>Per uscire dall'applicazione clicca il pulsante <strong>"Esci"</strong>.</Li>
          <Li>Password dimenticata? Usa il link "Ho dimenticato la password" nella pagina di login.</Li>
        </Section>

        {/* Glossario */}
        <Section icon={FileText} title="Glossario rapido">
          <Li><strong>Ruolo</strong>: cosa fa una persona nell'associazione (Attivista, Socio APS, Membro della comunità, Famiglia ospitante, Specialista di diritti). Un contatto può averne più di uno. Ha sostituito il vecchio campo "Tipo".</Li>
          <Li><strong>Profilo</strong>: cosa può fare un <em>utente</em> dentro l'applicazione (Admin, Superuser, Coordinatore, Volontario). Da non confondere con il ruolo, che riguarda i contatti.</Li>
          <Li><strong>Nuovo</strong>: contatto appena inserito, non ancora classificato.</Li>
          <Li><strong>Attivo</strong>: membro confermato e partecipante.</Li>
          <Li><strong>Rifiutato</strong>: ha rifiutato di far parte o di essere contattato.</Li>
          <Li><strong>Inattivo</strong>: era attivo ma non lo è più (storico).</Li>
          <Li><strong>TESSERATO</strong>: ha la tessera associativa attiva per l'anno corrente.</Li>
          <Li><strong>SCADUTA</strong>: tessera la cui data di fine è passata. Ci arriva da sola, ogni notte.</Li>
          <Li><strong>Prefisso internazionale</strong>: es. +39 (Italia), +33 (Francia), +44 (UK). Va inserito prima del numero di telefono.</Li>
          <Li><strong>Audit log / Cronologia</strong>: registro di tutte le modifiche ai dati, con utente e timestamp.</Li>
        </Section>

      </div>
    </AppShell>
  );
}
