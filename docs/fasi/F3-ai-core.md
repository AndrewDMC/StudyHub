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

**Aggiornamento (2026-09-25)**: terzo provider, `ClaudeCliProvider`
(`packages/ai/src/claudeCliProvider.ts`) — stessa interfaccia `AiProvider`, stessa disciplina di
retry-con-feedback (max 2), ma invoca `claude --print --output-format json --json-schema ...` da
terminale (prompt su stdin, nessun tool/MCP abilitato) invece della Messages API. Su richiesta
esplicita: serve a far girare l'inferenza reale usando la subscription `claude` già loggata sulla
macchina, non una `ANTHROPIC_API_KEY` a consumo. `resolveProvider()` lo sceglie con
`AI_PROVIDER=claude-cli`; in Docker richiede l'override `docker/docker-compose.claude-cli.yml`, che
monta `~/.claude`/`~/.claude.json` dell'host nel container worker (vedi README "Provider AI via CLI
`claude`"). Le funzioni di rendering dei prompt (`documentsBlock`, `render*UserPrompt`) sono state
estratte in `packages/ai/src/promptRender.ts`, condivise da `AnthropicProvider` e
`ClaudeCliProvider` — stesso testo di prompt, stessa igiene anti-injection (tag `<document>`
neutralizzati), indipendentemente dal canale di invocazione. **Mai eseguito contro la CLI vera**
in questa sessione: la sessione OAuth locale era scaduta al momento del test (`claude --print`
restituisce `Failed to authenticate: OAuth session expired`, riprodotto e trattato come qualunque
altro `is_error` — un normale round di retry-con-feedback, non un crash); il controllo di flusso è
comunque testato contro un runner CLI mockato
(`packages/ai/test/claudeCliProvider.test.ts`, stesso pattern di `anthropicProvider.test.ts`: primo
tentativo valido, retry su schema non valido, retry su `is_error`, retry su stdout non-JSON,
fallimento dopo 3 tentativi). **Da provare tu** con una sessione `claude` valida.

**Aggiornamento (2026-09-24)**: lo scope per `topicIds` è ora reale, non più rifiutato. La tabella
`document_topics` (docs/fasi/F2-materie.md "Stato") collega documenti e argomenti;
`resolveScopeChunks` (`apps/worker/src/processors/generation/shared.ts`) risolve `topicIds` ai
documenti taggati e da lì ai chunk, con lo stesso controllo di appartenenza alla materia già usato
per `docIds` — testato (`apps/worker/test/generateFlashcards.test.ts`), incluso il caso di un
argomento senza documenti collegati (errore chiaro, non uno scope vuoto silenzioso).

**Aggiornamento (2026-09-25)**: `generate_schema` (§3.2) è ora reale, stesso pattern di
`generate_summary` — `packages/ai` espone `generateSchema` su tutti e tre i provider
(`FakeProvider`, `AnthropicProvider`, `ClaudeCliProvider`), con prompt versionato
(`packages/ai/prompts/schema/v1.md`) e lo stesso gate anti-allucinazione delle flashcard: ogni
nodo dello schema è scartato se il suo `sourceRef.quote` non è sottostringa esatta del chunk
citato (`apps/worker/src/processors/generation/generateSchema.ts`, testato incluso il caso di un
nodo con citazione inventata). Persistito come JSON (`artifacts/schemas/<id>.json`: markdown,
diagramma Mermaid opzionale, mapping nodo→sourceRef), non Markdown puro come il riassunto — la
citazione per nodo va validata come dato strutturato, non solo mostrata in prosa. Stessa
idempotenza (`jobKey`) e budget guard di `generate_summary`. Esposto in UI come terzo pulsante nel
`GenerationPanel` (`/materie/[slug]`), con parametri fissi (`depth: 2`, `style: 'gerarchico'`) come
già per flashcard/riassunto — nessun controllo di stile/profondità in UI ancora. **Non
implementato**: una pagina di revisione dedicata (lo schema compare nella lista artefatti ma senza
link, come il riassunto); il rendering del diagramma Mermaid in UI.

**Aggiornamento (2026-09-25)**: `extract_topics` (§1 "topic extraction → proposta tassonomia") è
ora reale — ultimo dei quattro processor dello scope F3. Diverso dagli altri tre: non produce un
artefatto `draft` da revisionare, applica direttamente la tassonomia proposta come righe
`topics`/`document_topics` con `source: 'ai'` e `confidence` — colonne che `packages/db/src/schema.ts`
portava già per questo, mai popolate finché non è arrivato questo job. Sicuro da applicare subito
perché additivo e idempotente: un nome proposto già esistente nella materia viene riusato (case
insensitive), mai duplicato, e `mergeTopics` (docs/fasi/F2-materie.md) resta lo strumento per
ripulire una proposta sbagliata a posteriori — non serve una coda di revisione dedicata. Stesso
gate anti-allucinazione delle flashcard, applicato ai `docId`: un `docId` proposto che non era fra
quelli richiesti viene scartato (`apps/worker/src/processors/generation/extractTopics.ts`, testato
incluso il caso di un `docId` inventato). Idempotenza via `jobKey` come gli altri tre, ma verificata
direttamente sulla tabella `jobs` (non c'è un `artifactId` da restituire). Modello di routing
`claude-haiku-4-5-20251001` ("haiku per estrarre", docs/03 §4). Esposto in UI come pulsante
"Suggerisci argomenti (AI)" in `TopicsPanel` (`/materie/[slug]`), sui documenti pronti (`status:
parsed`) della materia. **Non implementato**: raggruppamento gerarchico (ogni argomento proposto è
sempre alla radice, `parentId: null` — la tassonomia AI è piatta anche se il modello ricevesse un
`depth` come `generate_schema`, che qui non esiste come parametro).

**Aggiornamento (2026-09-26)**: `ModelPicker` + stima costo pre-flight (§4: "La UI mostra sempre
modello + costo stimato prima di lanciare il job") sono ora in UI, per i tre pulsanti di
`GenerationPanel` (flashcard/schema/riassunto — non per `generate_simulation`/`extract_topics`, che
hanno i loro pannelli separati). `ModelPicker` (`apps/web/src/components/ModelPicker.tsx`) sceglie
fra i tre modelli del model routing (haiku/sonnet/opus); ogni cambio di modello o di documenti
pronti ricalcola la stima via `POST /api/subjects/[slug]/artifacts/estimate`
(`estimateGenerationCost`, `apps/web/src/lib/generation.ts`), che conta i token di input dai chunk
già estratti (`estimateTokens`) e applica un **rapporto di compressione dichiarato, non nascosto**
(flashcard 0.3×, schema 0.25×, riassunto 0.3× l'input — una stima d'ordine di grandezza, non una
previsione esatta) prima di chiamare la stessa `estimateCostEur` del budget guard — mai una vera
chiamata al provider. Il modello scelto viaggia poi nel job stesso (`model` nel body delle tre
route esistenti), sostituendo il default fisso per quella generazione. **Non implementato**: la
stima non copre `generate_simulation`/`extract_topics`; nessun costo storico per confrontare stima
vs reale.

**Non implementato** in questa slice (limiti dichiarati, non nascosti):

- **Dedup semantica** (cosine > 0.92 contro le card esistenti del deck): ridotta a dedup per testo
  esatto del `front` — la dedup semantica serve embeddings, non ancora collegati (vedi F1).
- **Eval harness**: 2 fixture (`packages/ai/evals/flashcards/`, STEM + umanistica), non le "5-10
  documenti reali" della spec — sufficienti a far girare `pnpm eval` prima di un bump di versione
  del prompt, non a validare la qualità di un modello reale.
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
