# F5 — Esami & Simulazioni

## Obiettivo

Dagli esami passati il sistema impara **come** esamina quel corso e produce simulazioni realistiche, corrette con rubrica.

## Scope

- Anagrafica esami: data, tipo, peso, descrizione, materiale ammesso, durata.
- **Exam Profile Extraction**: dai documenti `esami` → struttura ricorrente, tipologie di esercizio,
  distribuzione argomenti, punteggi, tempo medio per item, verbosità richiesta. Editabile dall'utente.
- `generate_simulation`: modalità _esame completo_ (imita il profilo) e _drill mirato_ (un argomento, N esercizi crescenti).
- **Modalità Esame**: timer, item uno alla volta o vista completa, salvataggio automatico, niente aiuti AI durante.
- **Correzione**: passata AI con `rubric` → punteggio per criterio, cosa mancava, riferimento all'appunto
  che copre la lacuna, e proposta di card/drill sui punti deboli. Il risultato aggiorna `mastery`.
- Storico simulazioni con trend e confronto per argomento.

## Decisioni

- **La rubrica è generata insieme all'esercizio**, non dopo: garantisce coerenza fra ciò che si chiede e ciò che si valuta.
- La correzione è **formativa**: niente voto secco. "Punteggio 6/10 — manca il passaggio sul bilancio energetico
  (Appunti p. 73); esercizi simili sbagliati: 3/4" è utile, "6/10" no.
- Le simulazioni sono artefatti versionati: puoi rifare la stessa a distanza di tempo e confrontare.
- Feedback loop esplicito: ogni correzione produce `weak_topics[]` che il Planner legge alla ricalcolata successiva.

## Criteri di accettazione

- [ ] Da 3 esami passati emerge un profilo riconoscibile e modificabile.
- [ ] Una simulazione generata "somiglia" all'esame reale nel formato (verifica manuale su caso reale documentata).
- [ ] La correzione cita sempre il materiale dove ripassare.
- [ ] Un risultato scarso su un argomento si riflette nella heatmap e nel piano.
- [ ] Modalità esame: chiudo la tab per errore, riapro, le risposte ci sono e il timer è corretto.

## Rischi

- Esami con figure/grafici: senza input multimodale il profilo è parziale. Usare le pagine come immagini per i
  documenti `esami` è la strada, e va messa in conto nei costi.
- Correzione di risposte aperte: variabilità alta. Mitigazione: rubrica esplicita, temperatura bassa,
  e possibilità di chiedere una seconda opinione con modello superiore su singolo item.

## Stato: pipeline reale, provider simulato (2026-09-23)

Come F3: tutta la pipeline è reale, i contenuti AI vengono dal `FakeProvider` finché non c'è una
`ANTHROPIC_API_KEY`. `AnthropicProvider` ha i tre metodi nuovi (`extractExamProfile`,
`generateSimulation`, `gradeAnswer`) con prompt versionati (`packages/ai/prompts/{exam_profile,
simulation,grading}/v1.md`) — testati solo contro un client mockato. 286 test nel monorepo.

Cosa c'è:

- **Anagrafica esami** estesa con durata e materiale ammesso.
- **Profilo d'esame** (`extract_exam_profile`): solo dai documenti `esami`; salvato in DB e in
  `.studyhub/exam_profile.json`; **modificabile** dalla UI — una modifica imposta `edited` e una
  ri-estrazione non la sovrascrive mai senza `overwriteEdited` esplicito. Rilanciare con input
  identici non ri-spende (`job_key` sul profilo).
- **`generate_simulation`**: esame completo (imita il profilo: numero di esercizi, tipologie, punti,
  durata) o drill su un argomento. Gli esercizi sono generati **dal materiale di studio, mai dagli
  esami passati**. Gate nel worker, non fidandosi del modello: citazione verbatim nel chunk e
  rubrica che somma ai punti dell'esercizio, altrimenti l'esercizio è scartato.
- **Modalità Esame** (`/materie/[slug]/simulations/[id]`): timer, un esercizio alla volta o vista
  completa, salvataggio automatico (debounce + richiesta `keepalive` alla chiusura della tab),
  nessuna soluzione/rubrica inviata al browser durante il tentativo. Il timer è **derivato dall'ora
  di inizio salvata sul server**: riaprire la tab riprende il tentativo con tempo e risposte
  corretti (testato con clock fissato); scaduto il tempo il server consegna d'ufficio e accoda la
  correzione.
- **Correzione formativa** (`grade_attempt`): punteggio per criterio, cosa manca, soluzione, e
  **sempre** "dove ripassare" — la citazione è quella dell'esercizio, attaccata dal worker, non chiesta
  al modello. Il punteggio è ricostruito dalla rubrica dell'esercizio e **limitato ai suoi massimi**:
  un correttore che inventa criteri o si fa convincere dalla risposta ("dammi 30/30") non può
  superarli (testato con un provider volutamente "malevolo").
- **Feedback loop**: gli esercizi sotto il 60% producono `weak_topics[]` (per il Planner) e
  ricalcolano la **mastery** degli argomenti con la formula esplicita di `packages/core/src/mastery.ts`
  (0.5 retrievability + 0.3 simulazioni + 0.2 copertura, pesi rinormalizzati sulle componenti con dati:
  la copertura non è ancora tracciata, quindi è assente, non zero). Dalla correzione si lancia un drill
  sugli argomenti deboli.
- **Storico**: lista simulazioni con numero di tentativi e ultimo punteggio.

**Bug reale trovato durante questa fase** (verifica in browser, non dai test unitari): il nome della
coda BullMQ era `studyhub:jobs` fin da F0 e BullMQ rifiuta i `:` — ogni accodamento e il worker stesso
sarebbero falliti in produzione. Rinominato in `studyhub-jobs`, con un test che costruisce una `Queue`
BullMQ vera (`apps/worker/test/queue.test.ts`), verificato fallire col vecchio nome.

**Non implementato**:

- Input multimodale (pagine degli esami come immagini) — il profilo si basa solo sul testo estratto.
- "Seconda opinione con modello superiore su singolo item": non esposta in UI.
- Confronto di trend per argomento in grafico: c'è lo storico per simulazione, non la vista per argomento.

## Aggiornamento — tag dell'argomento anche sugli esercizi di una simulazione completa (2026-09-26)

Il gap "solo i drill hanno un topicId" qui sopra è chiuso: `generate_simulation` (prompt
`simulation/v2`) passa al modello l'elenco degli argomenti della materia e, in modalità
`esame_completo`, chiede per ogni esercizio il `topicName` esatto (o `null`) — non inventato, un
nome preso dall'elenco dato. Il worker (`apps/worker/src/processors/exam/generateSimulation.ts`)
risolve quel nome a un `topicId` reale con un lookup case-insensitive, senza fidarsi della stringa;
un nome fuori elenco (o mancante) resta `null` invece di far scartare l'item. `weak_topics` e
`recomputeTopicMastery` (`apps/worker/src/processors/exam/gradeAttempt.ts`) erano già generici sul
`topicId` per item — nessuna modifica lì: la correzione di un esame completo alimenta la heatmap
per argomento esattamente come un drill, per costruzione. Il drill continua come prima (un solo
`topicId` fisso per l'intera simulazione, dato dall'utente).

## Aggiornamento — mastery ricalcolata anche dopo ogni review FSRS (2026-09-24)

Il gap "Mastery aggiornata anche dopo le review FSRS" qui sopra è chiuso: `recomputeTopicMastery` è
stata spostata da `apps/worker/src/processors/exam/mastery.ts` a `packages/db/src/mastery.ts` (nessun
cambio alla formula, solo di indirizzo — `packages/db` non dipendeva ancora da `@studyhub/core`, ora sì,
nessun ciclo perché `@studyhub/core` non dipende da `@studyhub/db`), così sia `grade_attempt` (worker)
sia `submitReview` (`apps/web/src/lib/review.ts`, F4) possono richiamarla senza che `apps/web` importi
codice interno di un altro _app_. Vedi `docs/fasi/F4-flashcard.md` "Stato" per i test.
