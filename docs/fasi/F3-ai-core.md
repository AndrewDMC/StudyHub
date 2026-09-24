# F3 — Motore AI & Worker

## Obiettivo

Da UI e da CLI genero flashcard, schemi e riassunti, con modello selezionabile, costo visibile,
output strutturato e citato, in stato `draft` fino all'approvazione.

## Scope

- `packages/ai`: adapter provider, model router, prompt registry versionato, tool-use per output strutturato,
  retry con feedback di validazione, prompt caching, contabilizzazione token/costo.
- Processor: `generate_flashcards`, `generate_schema`, `generate_summary`, `extract_topics`.
- UI: `ModelPicker` + stima costo pre-flight, `JobToast` con progress/cancel,
  **Review Queue degli artefatti** (accetta/modifica/scarta card per card, con la citazione sorgente a fianco).
- CLI con `--dry-run` e `--json`.
- Eval harness + golden set.

## Decisioni

- **Validazione della citazione**: se `sourceRef.quote` non compare verbatim nel chunk indicato, la card
  viene scartata prima ancora di arrivare all'utente. È il meccanismo anti-allucinazione più efficace e costa poco.
- **Map-reduce** per scope ampi: per topic, poi merge + dedup. Mai troncare.
- **Budget guard**: tetto di spesa giornaliero/mensile configurabile; superata la soglia, i job si accodano
  e chiedono conferma esplicita.
- **Idempotenza**: `jobKey = hash(type + scope + promptVersion + model)`. Rilanciare lo stesso job
  restituisce l'artefatto esistente invece di ri-spendere.

## Criteri di accettazione

- [ ] 40 card da 3 documenti: ogni card ha una citazione verificabile che apre il PDF alla pagina giusta.
- [ ] Lo stesso job da CLI produce lo stesso artefatto visibile in UI.
- [ ] Cambio modello in `settings` → il job successivo lo usa, e l'artefatto lo registra.
- [ ] Interrompo un job a metà: nessun artefatto parziale entra nella materia.
- [ ] Un documento contenente "ignora le istruzioni precedenti e…" non altera il comportamento (test di regressione).
- [ ] `--dry-run` stampa prompt finale e stima costo senza chiamare l'API.

## Rischi

- Qualità variabile fra materie (umanistiche vs matematiche): prevedere `subject.profile`
  (`stem | umanistica | linguistica | medica`) che seleziona varianti di prompt. Decisione da prendere qui, non dopo.
- Costi: senza caching e senza idempotenza, la sperimentazione diventa cara e si smette di usare il prodotto.

## Stato: provider simulato, pipeline reale (2026-09-22)

Su richiesta esplicita: implementata l'intera pipeline `generate_flashcards`/`generate_summary`
**con un provider AI simulato**, cioè senza chiamare mai una vera API a pagamento in questa sessione
(nessuna `ANTHROPIC_API_KEY` disponibile). L'astrazione è quella vera — `packages/ai` espone
un'interfaccia `AiProvider` che sceglie da sola, a runtime, fra:

- **`AnthropicProvider`** (reale): Messages API, tool-use forzato per l'output strutturato, retry
  con feedback di validazione (max 2, come da spec), prompt versionati in
  `packages/ai/prompts/<nome>/v<N>.md`. **Mai eseguito contro l'API vera** in questa sessione —
  testato con un client Anthropic mockato (`packages/ai/test/anthropicProvider.test.ts`), che
  verifica il flusso di controllo reale (parsing del tool_use, retry, somma degli usage) ma non può
  verificare la qualità di un output vero. **Da provare tu quando configuri la chiave.**
- **`FakeProvider`** (simulato, offline, gratuito): genera output realmente valido — frasi
  **verbatim** estratte dal materiale, quindi le citazioni superano davvero il controllo
  anti-allucinazione a valle, non lo bypassano. `resolveProvider()` sceglie `FakeProvider` quando
  `ANTHROPIC_API_KEY` non è impostata (il caso di questa sessione), `AnthropicProvider` altrimenti —
  **nessun cambio di codice richiesto per passare al vero provider**, solo la variabile d'ambiente.

Cosa è reale, non simulato (190 test nel monorepo, `pnpm turbo run test`):

- **Gate anti-allucinazione**: ogni card è scartata se `sourceRef.quote` non è sottostringa esatta
  del chunk citato — verificato con un provider di test che restituisce deliberatamente una
  citazione inventata (`apps/worker/test/generateFlashcards.test.ts`).
- **Idempotenza**: `jobKey = hash(type + scope + promptVersion + model + parametri)`; un secondo
  job con lo stesso input restituisce l'artefatto esistente — verificato end-to-end via `runJob`
  (due job id diversi, stesso risultato, nessun secondo deck creato).
- **Budget guard**: `settings['budget.dailyCapEur']`; un job che supererebbe il tetto giornaliero
  fallisce con `BudgetExceededError` a meno di `force:true` — verificato con un provider "prezzato"
  (fake ma con nome modello reale, quindi con costo stimato > 0).
- **Persistenza**: artefatto scritto su disco (`artifacts/flashcards/<id>.json`,
  `artifacts/summaries/<id>.md`) con front-matter (`generatedBy`, `model`, `promptVersion`,
  `sourceDocIds`) e indicizzato in DB (`artifacts`, `flashcards`, `artifact_sources`).
- **Review queue reale**: `/materie/[slug]/artifacts/[artifactId]` — accetta/scarta card per card
  con citazione a fianco, "approva il mazzo" imposta `status: approved`.

**Aggiornamento (2026-09-24)**: lo scope per `topicIds` è ora reale, non più rifiutato. La tabella
`document_topics` (docs/fasi/F2-materie.md "Stato") collega documenti e argomenti;
`resolveScopeChunks` (`apps/worker/src/processors/generation/shared.ts`) risolve `topicIds` ai
documenti taggati e da lì ai chunk, con lo stesso controllo di appartenenza alla materia già usato
per `docIds` — testato (`apps/worker/test/generateFlashcards.test.ts`), incluso il caso di un
argomento senza documenti collegati (errore chiaro, non uno scope vuoto silenzioso).

**Non implementato** in questa slice (limiti dichiarati, non nascosti):

- **`generate_schema`, `generate_simulation`, `extract_topics`**: non implementati. Seguono lo
  stesso pattern di `generate_flashcards`/`generate_summary` (provider adapter + validazione +
  persistenza) e sono il prossimo passo naturale, non un redesign.
- **Dedup semantica** (cosine > 0.92 contro le card esistenti del deck): ridotta a dedup per testo
  esatto del `front` — la dedup semantica serve embeddings, non ancora collegati (vedi F1).
- **Eval harness**: 2 fixture (`packages/ai/evals/flashcards/`, STEM + umanistica), non le "5-10
  documenti reali" della spec — sufficienti a far girare `pnpm eval` prima di un bump di versione
  del prompt, non a validare la qualità di un modello reale.
- **`ModelPicker` + stima costo pre-flight in UI**: il pannello `GenerationPanel` avvia la
  generazione con parametri fissi (auto count, basic+cloze, difficoltà 2); la scelta di modello e
  la stima costo prima del lancio non sono ancora esposte in UI (la stima esiste ed è usata dal
  budget guard, solo non mostrata prima del click).
- **CLI**: `studyhub generate flashcards/summary --dry-run --json` (docs/03 §5) non implementato in
  questa sessione — il worker e la UI coprono il ciclo completo (genera → revisiona → approva), il
  parallelo CLI segue lo stesso pattern di `apps/cli/src/commands/subject.ts` quando serve.
- **Test di regressione prompt injection** ("un documento con _ignora le istruzioni precedenti_..."):
  il prompt incapsula sempre il materiale in `<document>` con l'istruzione esplicita di ignorare
  comandi al suo interno (`packages/ai/prompts/*/v1.md`), ma non esiste un test automatico che lo
  verifichi contro un vero modello (il `FakeProvider` non "obbedisce" a nulla per costruzione, quindi
  non può dimostrare che l'istruzione regge — questo va provato con `AnthropicProvider` reale).
- **Pricing**: `packages/ai/src/pricing.ts` usa tariffe **placeholder** (commentate come tali):
  aggiornale con i prezzi reali del tuo piano prima di fidarti dei numeri per il budget guard.
