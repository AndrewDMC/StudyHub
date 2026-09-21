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
