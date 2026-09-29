# F7 — Dashboard, Polish & Distribuzione

## Obiettivo

Tutto converge nella home; il prodotto è installabile da terzi in 5 minuti.

## Scope — Dashboard (layout a 12 colonne)

1. **Riga stato** (4 tile): giorni al prossimo esame · minuti pianificati oggi · card in scadenza · mastery media.
2. **Oggi** (col. 1–7): le task del giorno, raggruppate per slot, ognuna con azione diretta ("Inizia ripasso",
   "Apri p. 51", "Genera schema"). In cima: **la singola next-action consigliata**, grande e inequivocabile.
3. **Flashcard per materia** (col. 8–12): barre impilate new/learning/review/rischio + forecast 7 giorni + CTA.
4. **Upload rapido** (col. 8–12): dropzone sempre presente → porta al Triage di F1.
5. **Calendario compatto** (col. 1–7, sotto): prossimi 14 giorni, esami evidenziati, carico giornaliero come barra.
6. **Attività** (footer): job recenti, artefatti da approvare, avvisi del Planner.

## Scope — Polish e distribuzione

- Stati empty/loading/error rifiniti su ogni schermata; skeleton coerenti.
- Command palette completa (`⌘K`) con azioni AI, navigazione e ricerca globale.
- Tema light completo; 3 densità; `prefers-reduced-motion`; audit a11y con axe.
- Onboarding: primo avvio → crea materia → carica un PDF → genera 10 card → vedi la prima task. In 5 minuti.
- **Backup/restore**: `studyhub backup` → archivio con `/data` + dump DB; `restore` verificato con test.
- Immagini pubblicate (`ghcr.io`), `docker-compose.yml` one-liner, README con quickstart, profilo `lite` SQLite.
- Pagina `/admin`: job, costi per mese, stato sync FS, log, reset indice.

## Criteri di accettazione

- [ ] Una persona che non conosce il progetto arriva alla prima flashcard in <5 minuti seguendo il README.
      (Quickstart e checklist "Per iniziare" esistono; **mai cronometrato con una persona vera**, e le
      immagini non sono pubblicate, quindi la prima build Docker pesa sul tempo.)
- [ ] La Dashboard risponde alla domanda "cosa faccio adesso" senza scroll. (La sezione "Oggi" con la
      next-action in evidenza è la prima cosa sotto le tile — non misurato su viewport reali, vedi "Stato".)
- [ ] Lighthouse ≥ 90 su performance e accessibilità nelle pagine principali. (Mai eseguito in questo ambiente.)
- [x] Backup e restore su macchina diversa: stato identico. (Testato con DB e cartella `/data` entrambi
      freschi, che è esattamente la condizione "macchina diversa" — vedi "Stato".)
- [x] Nessuna chiave API raggiungibile dal client (verificato nel bundle). (`pnpm check:bundle`, vedi
      "Completamento F7" — con il limite che il controllo sui _valori_ dipende dalle variabili d'ambiente
      presenti quando lo si lancia.)

---

## Stato: dashboard reale, backup/restore reali, resto a slice (2026-09-24)

Prima slice di F7, nella stessa sessione che ha completato F6. 394 test nel monorepo
(`pnpm turbo run test`), tutti verdi.

Cosa c'è, con test reali:

- **Dashboard** (`/`, `apps/web/src/components/DashboardClient.tsx`): le 4 tile di stato, la sezione
  **Oggi** con la next-action task in evidenza e "Fatta"/"Salta" in un click, la striscia dei prossimi
  14 giorni, "Flashcard per materia" e l'"Attività" (job recenti) sono tutte dati reali cross-materia,
  non mock — `apps/web/src/lib/dashboard.ts` aggrega `listSubjectSummaries`, `getCalendarRange`,
  `getRecentJobs` e due query dedicate (card in scadenza, prossimo esame), testato in
  `apps/web/test/dashboard.test.ts` con scenari reali (esame più vicino ignorando annullati/passati,
  minuti pianificati vs task ancora da fare, card sospese escluse dal conteggio).
  **`averageMastery` è quasi sempre `null`**: nessun codice applicativo scrive ancora `topics.mastery`
  (la formula in `packages/core/src/mastery.ts` esiste dalla F4 ma nessuno la chiama) — la tile mostra
  onestamente "N/D" invece di un numero inventato.
- **Calendario compatto** e **4 tile**: riusano `getCalendarRange` (F6) invece di nuove query — nessuna
  logica di aggregazione duplicata fra Dashboard e `/calendario`.
- **Upload rapido**: non una dropzone dedicata come da scope — un link a Materie. Una dropzone globale
  richiederebbe scegliere una materia prima di caricare, cosa che la UI di F1 già fa bene sulla pagina
  materia; duplicarla qui senza quel contesto avrebbe prodotto un componente peggiore, non uno migliore.
- **Command palette** (`⌘K`/`Ctrl+K`, `apps/web/src/components/CommandPalette.tsx`): naviga a Dashboard/
  Materie/Calendario, cerca per nome materia e salta diretto a Piano/Ripasso di una materia, filtro
  incrementale, frecce + invio. **Nessuna azione AI** ("genera flashcard da qui", ecc.) — solo
  navigazione e ricerca, come da scope minimo; le azioni AI restano sulle pagine materia.
- **`studyhub backup`/`studyhub restore`** (`apps/cli/src/backup.ts`): dump di tutte le 18 tabelle via
  Drizzle in un `backup.json` + copia ricorsiva di `/data`, nessuna dipendenza da `pg_dump` (non
  disponibile in questo ambiente senza Postgres reale — vedi F0 "Stato"). `restore` sostituisce lo stato
  esistente (non lo unisce): cancella e reinserisce, gestendo il self-reference di `topics.parentId` in
  due passate. Testato end-to-end con pglite: backup da un DB, restore su un secondo DB + cartella dati
  _entrambi vuoti_ (la condizione "macchina diversa" del criterio di accettazione), incluso un
  doppio-restore che non duplica righe.
- **Fix trasversale**: `apps/web/src/app/providers.tsx` ora crea il `QueryClient` con
  `networkMode: 'always'`. Scoperto verificando la Dashboard in browser: con l'impostazione di default
  (`'online'`), se il browser risulta "offline" per l'`onlineManager` di TanStack Query (osservato con
  `navigator.onLine` a `true` ma `fetchStatus` bloccato su `'paused'` nell'ambiente di test di questa
  sessione), **ogni pagina resterebbe bloccata su "Caricamento…" per sempre**, nessun errore mostrato —
  un'app locale non deve dipendere da un euristica pensata per l'internet pubblico. Non è stato
  possibile determinare la causa esatta del "paused" in questo ambiente (vedi limiti sotto).

**Non implementato in questa slice**:

- ~~Tema light~~ e ~~3 densità~~: chiusi, vedi "Completamento F7".
- **Audit a11y con axe**: mai eseguito.
- **Lighthouse**: mai eseguito in questo ambiente.
- ~~Onboarding guidato~~: chiuso come checklist, vedi "Completamento F7".
- **Immagini Docker pubblicate, `docker-compose.yml` one-liner, profilo `lite` SQLite**: nessun Docker
  daemon disponibile in questo ambiente per costruire/pubblicare immagini (stesso limite di F0).
- ~~Verifica bundle "nessuna chiave API lato client"~~: eseguita, vedi "Completamento F7".
- **Backup/restore reali contro Postgres**: testati solo con pglite (nessun Postgres/Docker disponibile
  — stesso limite dichiarato in ogni fase precedente). La logica è la stessa SQL via Drizzle, ma un
  primo giro contro un Postgres vero resta da fare prima di fidarsi in produzione.

## Aggiornamento (2026-09-26): pagina `/admin`

Costruita, ultimo pezzo dichiarato mancante nello scope originale. `apps/web/src/lib/admin.ts` +
tre route (`GET /api/admin/overview`, `GET /api/admin/jobs`, `POST /api/admin/reconcile`),
`AdminClient` (`/admin`), voce aggiunta a `AppShell` e `CommandPalette`. Testato in
`apps/web/test/admin.test.ts` (8 casi: ordinamento/paginazione/filtro per stato, aggregazione costi
per mese UTC, stato dell'ultimo `reconcile`, enqueue del reset indice).

- **Job**: elenco paginato (`limit`/`offset`), filtrabile per `status`, stessa forma di
  `RecentJobDto` già usata dalla Dashboard — nessuna duplicazione di schema.
- **Costi per mese**: sommati in JS da `jobs.cost` (jsonb, niente aggregazione SQL nativa qui, come
  già in `checkBudget` — dataset atteso piccolo per un'app locale mono-utente), raggruppati per
  `YYYY-MM` UTC.
- **Stato sync FS**: snapshot dell'ultimo job `reconcile` di qualunque scope (`imported`/
  `alreadyIndexed`/`skippedInvalid` dal suo `output`), non uno stato "live" del filesystem.
- **Reset indice**: rilancia lo stesso `reconcile` a scope pieno che gira già all'avvio del worker
  (`apps/worker/src/index.ts`) — idempotente, importa solo ciò che manca, non una cancellazione
  distruttiva dell'indice esistente.
- **"Log"**: nessuno store di log persistito oltre a `jobs.error` — il messaggio d'errore già
  visibile su ogni riga job è quello che questa slice chiama "log". Un log strutturato/persistito
  (oltre a pino su stdout) resta da fare.

**Bug preesistente scoperto e corretto qui**: `jobs.subject_id` non veniva mai impostato da
`apps/worker/src/jobRunner.ts::upsertJobRow` per i job scope-a-materia (`generate_flashcards` e
affini) — la colonna esiste ed è quella che sia questa pagina sia l'"Attività" della Dashboard
leggono per mostrare `subjectName`/`subjectSlug`, ma restava sempre `null` in pratica; i test la
impostavano a mano nell'insert di seed per poter verificare il join, cosa che il worker reale non
faceva mai. Corretto: `upsertJobRow` ora legge `subjectId` da `job.data` quando presente (la
maggioranza degli schemi di input in `packages/contracts` lo porta già) — con un fallback
esplicito se quel `subjectId` viola il vincolo di foreign key verso `subjects` (es. materia
cancellata fra l'enqueue e l'esecuzione): la riga job viene comunque creata, solo senza
attribuzione, invece di perdersi in un errore di constraint non gestito prima ancora che il
processor possa riportare il suo "subject not found". `reconcile`, `ping`, `extract_text`
(`documentId` soltanto) e `grade_attempt` (`attemptId` soltanto) restano correttamente senza
materia attribuita — non ne hanno una singola da dare senza una query aggiuntiva che questa
funzione non deve fare. Testato in `apps/worker/test/jobRunner.test.ts` (attribuzione reale,
nessuna attribuzione per un job senza `subjectId`, fallback per un `subjectId` inesistente).

**Non implementato**: nessuna cancellazione di un singolo job dalla UI; nessun filtro per tipo di
job o per materia, solo per stato.

## Aggiornamento (2026-09-26): retry di un singolo job

`POST /api/admin/jobs/:jobId/retry` (`apps/web/src/lib/admin.ts::retryJob`) rilancia un job
`failed` con lo stesso `type` e lo stesso `input` — persistito su `jobs.input` fin da quando il job
è stato accodato la prima volta, quindi nessun bisogno di ricostruirlo — sotto un nuovo id: un
nuovo tentativo, non una mutazione della riga fallita. Rifiuta un job non `failed`
(`JobNotRetryableError`) o inesistente (`JobNotFoundError`). Bottone "Rilancia" in `AdminClient`
solo sulle righe `failed`. Non copre ancora la cancellazione di un job.

## Completamento F7 (2026-09-29): aspetto, onboarding, verifica del bundle, build

- **Tema chiaro/scuro/sistema** (`apps/web/src/lib/appearance.ts`, `AppearanceMenu`, menu "Aspetto"
  nella top bar). Il tema chiaro ridefinisce **ogni** token, non solo le superfici, scurendo testo,
  accento e colori di stato: un test (`apps/web/test/appearance.test.ts`) legge `globals.css`, calcola
  il contrasto WCAG e richiede ≥ 4,5:1 per ogni colore di testo su ognuna delle 4 superfici e per il
  bianco sui pulsanti d'accento — contrasto misurato, non a occhio. "Sistema" segue l'OS dal vivo.
  Un piccolo script inline nel `<head>` (`NO_FLASH_SCRIPT`) applica la preferenza prima del primo
  paint; il test lo **esegue** contro gli helper tipizzati su tutte le combinazioni, così non
  divergono, e verifica che non lanci con lo storage bloccato. La preferenza sta in `localStorage`
  (per-browser), non nel DB.
- **Tre densità** (comoda/compatta/densa): scalano il `rem` di `<html>` (100% / 93,75% / 87,5%), quindi
  ogni utility Tailwind di spazio e testo le segue; il corpo è ora in `rem` invece di `14px` fissi.
  `prefers-reduced-motion` era già rispettato in `globals.css`.
- **Checklist "Per iniziare"** (`getOnboarding`, in `GET /api/dashboard`): 5 passi — materia, documento
  caricato, documento **pronto** (`parsed`), prime flashcard, piano **attivo** con task. Calcolata
  dallo stato reale (mai salvata), quindi non può divergere da ciò che l'utente ha fatto; una bozza di
  piano non conta, le materie archiviate nemmeno; si nasconde da sola a passi completati. Il passo
  successivo ha un link "Vai" diretto.
- **Verifica del bundle** (`pnpm check:bundle`, `scripts/check-bundle-secrets.mjs`): scansiona
  `.next/static` (solo ciò che va al browser) cercando la forma di chiavi note (Anthropic, OpenAI-style,
  AWS, chiavi private, URL Postgres con password) e i **valori** di `ANTHROPIC_API_KEY`/`DATABASE_URL`/
  `REDIS_URL`… se presenti nell'ambiente. Esce con errore se non ha scansionato nulla. Eseguito su una
  build vera: 111 file, nessuna fuga; provato anche con una chiave finta iniettata (rilevata, exit 1).
  **Limite**: senza quelle variabili nell'ambiente il controllo sui valori è vuoto e restano solo le
  forme note — per una verifica piena, lanciarlo con il `.env` caricato.
- **Bug trovato dalla build di produzione**: `next build` **falliva** — due commenti `eslint-disable`
  (`AttemptResultsClient.tsx`, `VerifySchemaClient.tsx`) citavano regole (`react-hooks/exhaustive-deps`,
  `@next/next/no-img-element`) che la config ESLint del repo non definisce, e Next le tratta come
  errori. Sostituiti da commenti normali. I test unitari non potevano accorgersene.
- **README**: sezione Quickstart (Docker, 3 comandi) e stato aggiornato.

**Ancora non fatto** (dichiarato): immagini pubblicate su `ghcr.io` e profilo `lite` SQLite (nessun
Docker daemon qui), audit **axe** e **Lighthouse** (servono l'app in esecuzione su Postgres), "prima
flashcard in <5 minuti" mai cronometrato con una persona vera, dropzone di upload globale, azioni AI
nella command palette (resta navigazione e ricerca), log strutturato persistito, verifica vera del
tema chiaro su tutte le pagine (verificato in browser solo lo shell e `/materie` — applicazione,
persistenza al reload e densità; il contrasto è calcolato dai token, non misurato sulle pagine
renderizzate; la Dashboard e le pagine con dati non erano raggiungibili senza Postgres).
