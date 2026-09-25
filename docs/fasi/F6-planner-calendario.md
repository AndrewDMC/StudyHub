# F6 — Planner & Calendario

## Obiettivo

Da `materiale + data d'esame` a task giornaliere azionabili, visibili in calendario e in dashboard.
Spec funzionale completa: `docs/04-planner.md`.

## Scope

- **Wizard Piano** (4 step): obiettivo ed esame → disponibilità settimanale → copertura materiale e intensità →
  **anteprima del piano prima di confermare** (carico per settimana, argomenti coperti, fattibilità, costo del job).
- Motore ibrido AI/algoritmo (Fasi A/B/C).
- Materializzazione in `tasks`; ogni task ha un'azione eseguibile in un click.
- **Calendario**: viste Mese/Settimana/Agenda; esami come milestone con countdown; task drag&drop con
  re-schedule deterministico dei vincoli; blackout dates; overlay multi-materia con colori identità.
- Ricalcolo adattivo + **diff leggibile** del piano ("cosa è cambiato e perché").
- Export **ICS** (feed sottoscrivibile) + import ICS per conoscere gli impegni esistenti.
- Sezione Daily Task riusabile (stesso componente in Dashboard e in Materia).

## Decisioni

- **Il re-schedule non chiama l'LLM.** Spostare una task deve essere istantaneo e gratuito, altrimenti l'utente
  smette di usare il calendario. Solo un cambiamento di _scope_ (nuovo materiale, nuova data) rilancia la Fase A.
- **Nessuna task senza payload eseguibile.** Se il Planner non sa dire con quale materiale si fa una task, non la crea.
- Il piano è **proposta**: l'utente può bloccare (`pin`) task che non devono muoversi nei ricalcoli.
- Task non completate: il giorno dopo non si accumulano silenziosamente — appaiono in "Debito" con l'opzione
  _rimanda / riassorbi nel piano / archivia_. L'accumulo invisibile è ciò che uccide ogni to-do app.

## Criteri di accettazione

- [ ] Piano a 30 giorni generato in <60s; fase B ricalcolata in <500ms. (Fase B è nell'ordine dei ms —
      vedi `schedule.test.ts` — ma non misurato end-to-end con Fase A reale, mai eseguita dal vivo.)
- [ ] Tempo insufficiente → il wizard lo dichiara **prima** di generare e propone 3 strategie. (Le 3
      strategie esistono e si vedono nella bozza — vedi "Stato" sotto — ma solo _dopo_ aver generato, non
      prima come anteprima.)
- [x] Sposto una task di 2 giorni: il piano si riadatta senza violare i vincoli duri e senza chiamate AI.
- [x] Due esami ravvicinati: nessun giorno supera i minuti disponibili (con la materia che genera per
      seconda che rispetta i minuti già occupati dalla prima — non un solver congiunto, vedi "Stato").
- [ ] Il feed ICS si apre correttamente in Google Calendar e si aggiorna. (Il feed esiste ed è
      strutturalmente valido RFC 5545 — testato contro la spec, non contro un vero Google
      Calendar/Apple Calendar in questo ambiente: vedi "Aggiornamento" in fondo al file.)
- [x] Salto 3 giorni: al rientro il sistema propone un ricalcolo, non una lista di 30 task arretrate.
      (`GET .../plan/drift` + banner nel pannello "Oggi" — vedi "Aggiornamento" in fondo al file. La
      soglia di `detectDrift` è ≥2 giorni interamente saltati o ≥30% di task scadute nell'ultima
      settimana, non esattamente "3 giorni" testuale, ma il comportamento richiesto c'è.)

## Rischi

- **La fase più complessa del progetto.** Mitigazione: la Fase B è codice puro e testabile con scenari fissati
  (snapshot test su 10 casi: poco tempo, tanto tempo, un argomento, 5 materie, zero materiale…). Scrivere quei test _prima_.
- Sovra-ingegnerizzazione dell'ottimizzatore: partire da greedy + local search. Se non basta, si valuta un solver.

---

## Aggiornamento F6 — Revisione e commit del piano

Spec completa in `docs/04-planner.md` §9. Il wizard non termina con la generazione: termina con il **commit**.

### Scope aggiuntivo

- Stato `proposed` per le task; un piano `draft` è invisibile a Dashboard, Calendario e Daily Task.
- **Schermata Revisione piano**: editing completo della bozza (titolo, durata, tipo, giorno, materiale),
  aggiunta di task manuali, `pin`, azioni bulk, con carico e fattibilità ricalcolati in tempo reale (Fase B).
- **Commit transazionale e idempotente** su `planId`: tasks `todo`, orari, `plans/<id>.json` su disco, feed ICS.
- **Vista diff** per i ricalcoli, con il motivo su ogni riga e rispetto delle task `pin`.
- `calendar_events` come vincoli in ingresso (esami, lezioni, ICS importato), distinti dalle task.
- Prerequisiti dedotti dagli archi `precede` / `dipende-da` dei grafi degli schemi, come input della Fase A.

### Criteri di accettazione aggiuntivi

- [x] Una bozza non produce alcun effetto fuori dalla schermata di revisione.
- [x] Le modifiche alla bozza sopravvivono alla chiusura del browser.
- [x] Commit di 40 task: transazione unica, nessun duplicato al rilancio.
- [x] Il diff di un ricalcolo e' leggibile, motivato e rispetta i `pin`.
- [x] Rifiutare il diff lascia il piano attivo immutato.

---

## Stato: motore reale, wizard/calendario a slice (2026-09-24)

Il motore di scheduling puro (Fase B, `packages/core/src/planner/schedule.ts` + `adapt.ts`) esisteva già
da una sessione precedente — scritto _prima_ del resto, come da "Rischi" sopra — ma non era collegato a
nulla: nessuna tabella, nessuna route, nessun export dal barrel di `@studyhub/core`. Questa sessione lo
mette in produzione end-to-end, inclusa la vista **Calendario** aggiunta a chiusura della stessa sessione
(361 test nel monorepo, `pnpm turbo run test`, tutti verdi):

Cosa c'è, con test reali:

- **Fase A reale (stima), non simulata nel senso di F3**: `packages/ai` espone `estimateTopics` sullo
  stesso `AiProvider` di F3/F5 — `AnthropicProvider` (mai eseguito contro l'API vera, testato solo con
  client mockato) e `FakeProvider` (deterministico: minuti da pagine, difficoltà da densità lessicale
  reale del testo, peso d'esame proporzionale alla lunghezza — non canned, ma nemmeno un giudizio vero).
  **Non esiste una Fase C**: i titoli/descrizioni delle task (`"Studia X — pp. 51–68"`) sono template
  stringa dentro `schedule.ts` stesso, non una chiamata AI separata come previsto da `docs/04-planner.md`
  §1 — la "narrazione" è più semplice di quanto la spec ipotizzasse, e non è mai stato un problema.
- **Aggiornamento (2026-09-24) — unità di pianificazione = argomenti taggati, quando esistono**: il
  Planner ora pianifica su `topics` reali quando i documenti sono taggati (`document_topics`, F2), e
  torna al fallback per-documento solo per i documenti non taggati (`buildPlanningUnits` in
  `generatePlan.ts`) — nessuna regressione per le materie che non taggano nulla, stesso comportamento
  di prima, testato esplicitamente. Un documento taggato con più argomenti conta per uno solo, il suo
  argomento _primario_ (l'argomento collegato con `orderIndex` più basso — l'ordine che l'utente vede
  già nel pannello Argomenti, non un criterio arbitrario nuovo): il materiale dei suoi documenti si
  somma sotto quell'unico argomento, mai duplicato su due. **Bonus non pianificato**: la `mastery` reale
  di un argomento (scritta da F5 dopo un drill) alimenta ora `PlannerTopic.mastery` per la prima volta
  — un argomento già padroneggiato riceve una prima lettura più breve (`learningMinutes` in
  `schedule.ts`, già scritto per questo in F6 ma senza mai un dato reale da consumare finora). 3 test
  nuovi: raggruppamento multi-documento, assegnazione al primario, riduzione minuti da mastery reale.
  Niente prerequisiti dedotti da grafi di schemi (§7-F1 "grafo nodi/archi" non esiste): `prerequisites`
  è sempre vuoto col `FakeProvider`.
- **Schema DB**: `study_plans` (`draft|active|superseded`) e `tasks` (`proposed|todo|doing|done|skipped|moved`),
  migrazione `0006_study_plans_tasks.sql` — verificata con le migrazioni reali via pglite
  (`packages/db/test/schema.test.ts`), non solo con una DDL scritta a mano.
- **Job `generate_plan`** (`apps/worker/src/processors/planner/generatePlan.ts`): Fase A + Fase B in un
  job — **non idempotente per design** (a differenza di `generate_flashcards`): rigenerare una bozza è
  un'azione attesa del wizard, non un doppio-click da deduplicare; una bozza rigenerata sostituisce quella
  precedente per la materia, mai le si accumula.
- **Precedenza assoluta delle FSRS** (`docs/04-planner.md` §4): `generate_plan` interroga
  `forecastDueCounts` (F4) sulle card della materia e le passa come `dueCardsByDate` — testato con un
  caso reale (card in scadenza il primo giorno del piano, task di ripasso generata prima di tutto).
- **Risorsa condivisa multi-materia** (§7, ridotto): i minuti già occupati da task `todo`/`doing` di
  _altre_ materie riducono la capacità del giorno — testato. Non implementata la vera allocazione
  proporzionale `(peso esame × urgenza × gap mastery)` descritta in §7: è un vincolo unidirezionale
  ("chi genera per primo occupa"), non un solver congiunto fra materie.
- **Revisione e commit** (`apps/web/src/lib/plan.ts`): pin/modifica/elimina task di bozza, task manuali,
  **commit transazionale e idempotente** su `planId` (supersede del piano attivo precedente, snapshot
  `plans/<planId>.json` su disco) — testato incluso il doppio-commit e il rifiuto di un piano `superseded`.
- **Sposta task** (`moveTaskInPlan`, riusa `adapt.ts::moveTask`): funziona sia in bozza sia sul piano
  attivo (il Calendario e la Revisione chiamano la stessa route) — istantaneo, nessuna chiamata AI,
  cascata dei conflitti testata.
- **Vista Calendario** (`/calendario`, `apps/web/src/components/CalendarClient.tsx`): mese, cross-materia
  — API `GET /api/calendar?start=&end=` (`apps/web/src/lib/calendar.ts`, testato: solo task di piani
  `active`, mai `draft`; range `[start, end)` esclusivo) unisce le task da _tutte_ le materie con colore
  identità ed esami come milestone. Selezioni un giorno → agenda con le task di quel giorno e un controllo
  di spostamento per ciascuna (campo data + bottone, non trascinamento del mouse). La nav non la marca più
  "Presto disponibile".
- **Diff di ricalcolo** (`getPlanDiff`, riusa `adapt.ts::diffPlans`): confronta piano attivo e bozza
  corrente, rispetta i `pin` — testato. `detectDrift` è ora collegato (vedi "Aggiornamento" in fondo
  a questo file): "al rientro il sistema propone un ricalcolo" è vero in pratica, non solo in libreria.
- **UI**: `/materie/[slug]/piano` (wizard a singola schermata, non i 4 step della spec; lista task
  raggruppata per giorno con carico/disponibilità, non un calendario) + pannello **Oggi**
  (`DailyTasksPanel`) sulla pagina materia. Verificato in browser reale (senza Postgres, come nelle fasi
  precedenti): nessun crash di render/hydration sul percorso di errore.

**Non implementato in questa slice** (limiti dichiarati):

- **Calendario: solo vista Mese**, niente Settimana/Agenda (senza `starts_at`/`ends_at` una vista
  Settimana non avrebbe comunque senso — vedi sotto). Niente drag&drop col mouse (lo spostamento è un
  campo data + bottone). Niente editing di blackout dates dalla UI (il campo esiste nel modello e nel
  wizard di generazione, non nel Calendario). Niente indicatore di fattibilità/sovraccarico sulla cella
  del giorno oltre al totale minuti.
- **Import ICS**: non iniziato (export sì, vedi "Aggiornamento" in fondo al file). `calendar_events`
  (per esami/lezioni/ICS importato come vincoli d'ingresso, distinti dalle task —
  `docs/04-planner.md` §9.4) non esiste come tabella.
- **Anteprima di fattibilità _prima_ di generare**: il wizard lancia sempre il job; il verdetto di
  fattibilità e le 3 strategie si vedono solo dopo, nella bozza generata — non prima di spendere la
  chiamata Fase A.
- **Azioni bulk** ("sposta la settimana di 2 giorni", "riduci il carico del 20%", "escludi argomento").
- **Schermata "Debito"** per le task scadute (rimanda/riassorbi/archivia): `getDailyTasks` include le
  task scadute nella lista piatta di "Oggi", senza le azioni di triage previste.
- **`starts_at`/`ends_at`** (fasce orarie): le task hanno una `date`, non un orario — nessuna vista
  Settimana avrebbe comunque senso senza questo.
- **CLI**: `studyhub plan generate`/`ls` esistono ora (vedi "Aggiornamento" in fondo al file) — manca
  ancora `studyhub plan commit` (il commit tocca il filesystem via `apps/web/src/lib/plan.ts`, non
  condiviso col worker come `processGeneratePlan`; per ora si commit solo dalla UI).
- **Dashboard (F7)**: il Daily Task esiste solo nella pagina materia, non ancora nella home.

## Aggiornamento — i task "read" completati alimentano la copertura di mastery (2026-09-24)

Ultima componente mancante della formula di mastery (`docs/02-filesystem-e-dati.md` §5): la
"copertura del materiale letto". `apps/web/src/lib/plan.ts::setTaskStatus` ora chiama
`recomputeTopicMastery` (`@studyhub/db`) quando un task `kind: 'read'` con `topicId` viene marcato
`done` — non su ogni cambio di stato, solo su quello che segnala materiale davvero letto.

`packages/db/src/mastery.ts::computeTopicCoverage` calcola la frazione: pagine coperte da task
`read` `done` (dal `payload.material`, clampate alle pagine del documento per evitare che
rigenerazioni di piano sovrapposte superino il 100%) diviso le pagine totali dei documenti il cui
**argomento primario** (stesso criterio del Planner: `orderIndex` più basso) è quell'argomento.
Assente, non zero, per un argomento senza alcun documento taggato.

La risoluzione dell'argomento primario per documento — finora scritta solo dentro
`generatePlan.ts::buildPlanningUnits` — è stata estratta in `packages/db/src/documentTopics.ts::
resolvePrimaryTopics`, condivisa ora da Planner e mastery: stessa regola, una sola implementazione.
5 test nuovi in `packages/db/test/mastery.test.ts` (parziale, non conta i task non `done`, clamp al
100% con piani rigenerati sovrapposti, solo l'argomento primario conta), 1 in
`apps/web/test/plan.test.ts` (`setTaskStatus('done')` su un task letto aggiorna la mastery).

## Aggiornamento — `detectDrift` collegato: "il piano è indietro" (2026-09-24)

L'ultimo pezzo scritto-ma-non-collegato di questa fase: `apps/web/src/lib/plan.ts::getPlanDrift`
chiama `detectDrift` (`packages/core`) contro le task del piano **attivo**, e la nuova route
`GET /api/subjects/:slug/plan/drift?date=YYYY-MM-DD` (default: oggi) la espone. `null` quando non
c'è un piano attivo — non "nessuno scostamento", semplicemente niente da controllare ancora.
`DailyTasksPanel.tsx` mostra un banner ambra con il motivo (`"2 giorni saltati"` o
`"NN% delle task... non svolte"`) e un link a `/materie/[slug]/piano` per rigenerare, quando
`shouldRecalculate` è vero.

Nessun cron: il controllo è lato client, a ogni caricamento del pannello "Oggi" — non un vero
"al rientro" proattivo (nessuna notifica push/email), ma il comportamento visibile richiesto dal
criterio di accettazione c'è. 3 test nuovi in `apps/web/test/plan.test.ts` (null senza piano attivo,
nessun drift con task tutte `done`, drift rilevato con 2 giorni interamente saltati).

## Aggiornamento — `studyhub plan generate`/`ls` (2026-09-24)

Primo comando CLI del Planner: `studyhub plan generate <slug> --start ... --target ... --weekly
0,120,120,120,120,120,0 [--session-length] [--intensity] [--exam] [--force]` chiama
`processGeneratePlan` **in-process**, esattamente come `reconcile` — nessun Redis/BullMQ richiesto,
stesso principio "apps/cli è lo stesso codice del worker invocato one-shot" (docs/01-architettura.md
§1). `studyhub plan ls <slug>` elenca i piani (draft/active/superseded) con conteggio task, più
recenti prima. Validazione di `--weekly` (deve avere esattamente 7 numeri) prima di toccare il DB.

`processGeneratePlan` è stato aggiunto a `apps/worker/src/lib.ts` (il barrel "reusable, side-effect-
free exports for apps/cli") perché non c'era ancora bisogno di esporlo da lì. Manca ancora `plan
commit`: il commit scrive anche su filesystem via `apps/web/src/lib/plan.ts`, non condiviso col
worker — resta un'azione solo-UI per ora. 3 test nuovi in `apps/cli/test/plan.test.ts` (genera una
bozza, errore chiaro per materia sconosciuta, `ls` in ordine e con conteggio task corretto).

## Aggiornamento — feed ICS (export) (2026-09-26)

Export ICS reale — metà dello scope "Export ICS + import ICS" (import resta non iniziato, vedi
"Non implementato"). `buildIcsCalendar` (`packages/core/src/ics.ts`) è uno scrittore RFC 5545
minimale, dipendenze zero: escaping di testo (`;`, `,`, `\`, newline), *line folding* a 75
caratteri con continuazione indentata, `\r\n` ovunque come richiesto dalla spec — testato contro
la spec stessa (`packages/core/test/ics.test.ts`, 7 casi), non contro un parser ICS di terze
parti. `getIcsFeed` (`apps/web/src/lib/calendar.ts`) riusa `getCalendarRange` — stessa query di
`/calendario`, così il feed non può disallinearsi da quel che il Calendario stesso mostra — con
una finestra `0001-01-01`..`9999-12-31` (tutto lo storico e il futuro in una chiamata: dataset
piccolo per un'app locale mono-utente, e un client calendario ripolla sempre lo stesso URL fisso,
niente parametri di query da variare). Un esame `cancelled` è escluso dal feed (fuorviante avere un
evento su un calendario per un esame annullato); una task porta minuti/tipo/stato in
`DESCRIPTION`, la materia in `CATEGORIES`. Esposto come `GET /api/calendar.ics`
(`text/calendar`, non JSON) e come link "Sottoscrivi" + pulsante copia-link in `/calendario`.

**Non verificato**: l'apertura reale in Google Calendar/Apple Calendar (nessun accesso di rete a
servizi esterni in questo ambiente) — solo la correttezza strutturale RFC 5545. **Non
implementato**: aggiornamento push del feed (un client calendario ripolla secondo il proprio
intervallo, tipicamente ore — nessun meccanismo per notificarlo prima); `CalendarExamDtoSchema` è
stato esteso con `status`/`location`/`description` (già letti dalla query esistente, solo non
esposti) per permettere questo filtro — cambio additivo, nessun consumer esistente rotto.
