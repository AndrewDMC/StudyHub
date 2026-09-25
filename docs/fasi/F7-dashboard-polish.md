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
- [ ] La Dashboard risponde alla domanda "cosa faccio adesso" senza scroll. (La sezione "Oggi" con la
      next-action in evidenza è la prima cosa sotto le tile — non misurato su viewport reali, vedi "Stato".)
- [ ] Lighthouse ≥ 90 su performance e accessibilità nelle pagine principali. (Mai eseguito in questo ambiente.)
- [x] Backup e restore su macchina diversa: stato identico. (Testato con DB e cartella `/data` entrambi
      freschi, che è esattamente la condizione "macchina diversa" — vedi "Stato".)
- [ ] Nessuna chiave API raggiungibile dal client (verificato nel bundle). (Invariante ereditata da F3,
      non ri-verificata nel bundle in questa sessione.)

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

- **Tema light**: `apps/web/src/app/globals.css` ha solo il set di token dark — nessun `data-theme`,
  nessuna variante chiara.
- **3 densità** (comfortable/compact/dense): non esistono, né come token né come switch.
- **Audit a11y con axe**: mai eseguito.
- **Lighthouse**: mai eseguito in questo ambiente.
- **Onboarding guidato**: nessun flusso dedicato "primo avvio → materia → PDF → 10 card → prima task";
  il percorso esiste (le pagine ci sono tutte) ma non è cucito insieme con un wizard.
- **Immagini Docker pubblicate, `docker-compose.yml` one-liner, profilo `lite` SQLite**: nessun Docker
  daemon disponibile in questo ambiente per costruire/pubblicare immagini (stesso limite di F0).
- **Verifica bundle "nessuna chiave API lato client"**: non ri-eseguita in questa sessione.
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

**Non implementato**: nessuna cancellazione/retry di un singolo job dalla UI (solo lettura + il
reset indice complessivo); nessun filtro per tipo di job o per materia, solo per stato.
