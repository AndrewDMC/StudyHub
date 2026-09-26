# F1 — Ingest & Gestione Materiali

## Obiettivo

Carico N file, li assegno a una materia, li marco per tipo, il sistema ne estrae il testo e li rende cercabili.

## Scope

- Upload multiplo (drag&drop + picker + cartella intera), chunked, con progress per file, resume su refresh.
- Dedup per `sha256` (avvisa: "già presente come X").
- **Pagina di Triage** (il cuore della fase): griglia dei documenti appena caricati con anteprima,
  assegnazione tipo in bulk (selezione multipla + scorciatoie `1/2/3/4`), materia, e — importante —
  **pre-classificazione AI del tipo** già suggerita, che l'utente conferma o corregge.
- Pipeline: estrazione testo → OCR fallback → normalizzazione → chunking → embeddings → topic extraction.
- Ricerca ibrida (FTS italiano + vettoriale, fusione RRF) su tutti i documenti.
- Visualizzatore documento con testo estratto affiancato al PDF e deep-link per pagina.

## Decisioni

- **Immutabilità dei sorgenti**: mai riscrivere un file caricato. Le correzioni vivono in `derived/`.
- **Chunking**: rispetta heading e blocchi formula; ogni chunk porta `page_from/page_to` — senza questo,
  le citazioni delle flashcard non sono verificabili e P3 cade.
- **OCR opt-in per documento**, non automatico: è lento e l'utente deve sapere che sta accadendo.
- Coda separata `ingest` con concorrenza limitata (CPU-bound) rispetto alla coda `ai` (IO-bound).

## Criteri di accettazione

- [ ] 30 PDF (500 MB totali) caricati senza bloccare la UI; posso navigare altrove e tornare.
- [ ] Un PDF scansionato senza layer testo viene riconosciuto e propone OCR.
- [ ] Cerco "entropia" e trovo il chunk con pagina esatta, aprendo il PDF a quella pagina.
- [ ] Riassegno il tipo a 10 documenti in 3 click.
- [ ] Un ingest fallito è riprovabile e mostra l'errore reale (non "qualcosa è andato storto").

## Rischi

- PDF corrotti/protetti/enormi: timeout per file, isolamento del processo, fallimento singolo ≠ fallimento batch.
- Formule matematiche: l'estrazione testo le distrugge. Mitigazione: conservare l'immagine della regione
  e, per i documenti marcati "matematici", passare le **pagine come immagini** al modello multimodale.

---

## Aggiornamento F1 — Markdown canonico e verifica schemi

Questa fase assorbe la normalizzazione in Markdown (`docs/07-markdown-layer.md`), che ne diventa il
deliverable principale. Lo scope cresce: valutare uno split in **F1a (ingest + markdown a stampa)** e
**F1b (vision, schemi a mano, verifica)** se la fase supera i 7 giorni.

### Scope aggiuntivo

- Job `normalize_markdown` (rami: PDF testuale, vision, office, audio) e `transcribe_schema`.
- Preprocessing immagini: deskew, dewarp, contrasto, upscale, tiling con overlap per pagine dense.
- Vocabolario di contesto dagli appunti già indicizzati (retrieval, nessun costo LLM).
- `handwriting-profile.md` per materia + globale, alimentato da `distill_handwriting_profile`.
- **Schermata di verifica trascrizione**: immagine con bounding box a sinistra, markdown/grafo a destra,
  navigazione `Tab` solo fra i nodi dubbi.
- Editor correttivo del `content.md` con stickiness e risoluzione conflitti al re-ingest.
- Export `.canvas` (JSON Canvas) e render Mermaid del grafo.
- Il chunking opera **sul markdown**, non più sul PDF.

### Criteri di accettazione aggiuntivi

- [ ] Foto storta e in ombra di uno schema a mano: dopo preprocessing viene trascritta in modo leggibile.
- [ ] Il grafo prodotto ha nodi, archi tipizzati dalla tassonomia chiusa e ritagli allineati alle regioni.
- [ ] Verifico uno schema da 42 nodi con 3 incerti in meno di 60 secondi.
- [ ] Un nodo non verificato non genera flashcard (test automatico, non solo UI).
- [ ] Correggo `content.md`, rilancio l'ingest: la mia versione sopravvive, il conflitto è mostrato.
- [ ] Dopo 5 schemi corretti il profilo di grafia contiene regole sensate e le incertezze calano.
- [ ] Il `.canvas` esportato si apre in Obsidian con la struttura corretta.

## Stato: slice deterministica implementata (2026-09-22), poi completata (2026-09-26)

> Questa sezione era superata già prima dell'aggiornamento del 2026-09-26: un commit intermedio
> (`f9d1c18`) aveva già aggiunto una pipeline vision reale per gli schemi (`transcribe_schema`,
> `schema_blocks`, schermata di verifica a lista piatta) dopo che questo paragrafo era stato scritto.
> Il paragrafo originale sotto resta per la cronologia — vedi "Aggiornamento 2026-09-26" per lo
> stato vero.

Implementata solo la parte di F1 che non richiede un provider AI o un modello di embedding —
in pratica un F1a ridotto. **Non implementato** (richiede una decisione su provider/costo che
spetta all'utente, non a questa sessione): OCR, trascrizione vision degli schemi a mano,
pre-classificazione AI del tipo documento, `handwriting-profile.md`, grafo nodi/archi,
schermata di verifica, export `.canvas`, embeddings/ricerca vettoriale, topic extraction.

Cosa c'è, con test reali (112 test totali nel monorepo, `pnpm turbo run test`):

- **Upload** (`POST /api/subjects/:slug/documents`): sniffing del MIME dai byte reali (mai
  dall'estensione dichiarata — `packages/core/src/documents.ts`), allowlist PDF/JPEG/PNG/WEBP,
  limite dimensione, dedup per sha256 **per materia**, rinomina in `<uuid>.<ext>`.
- **Estrazione testo** (job `extract_text`, `apps/worker/src/processors/extractText.ts`): solo
  per PDF col layer di testo, via `pdfjs-dist`. Scrive `derived/<docId>/{content.md,content.orig.md}`
  (un `## Pagina N` per pagina, **non** la pulizia Markdown AI di `docs/07-markdown-layer.md`) e un
  chunk DB per pagina. Un file non-PDF fa fallire il job con un messaggio reale che nomina il motivo
  (OCR/vision non collegati), non un errore generico — verificato da test automatico, non solo UI.
- **Schema DB**: tabelle `documents` e `chunks` (migrazione `0001_documents.sql`), indice GIN
  `to_tsvector('italian', text)` su `chunks.text` — la metà FTS della ricerca ibrida è pronta e
  testata (`packages/db/test/migrations.test.ts`); manca solo la metà vettoriale (colonna
  `embedding vector(1024)`, rimandata insieme al modello di embedding).
- **UI**: pagina materia (`/materie/[slug]`) con form di upload multiplo e lista documenti con stato
  (badge colorato per `uploaded|parsing|parsed|failed|missing`), stati empty/loading/error reali.

Decisioni prese _davvero_ durante l'implementazione:

- **Refactor dei test DB** (`packages/db/src/testDb.ts`): non più una DDL scritta a mano, ma le
  vere migrazioni applicate via `drizzle-orm/pglite/migrator` — elimina il rischio di disallineamento
  fra schema testato e schema reale via via che le fasi aggiungono tabelle.
- **`sources/altro/`** aggiunta allo scaffold di F0 (`packages/core/src/scaffold.ts`): il tipo
  documento `altro` esiste in `docs/02-filesystem-e-dati.md` ma la cartella non era nello scaffold.
- **Verifica in browser reale** (non solo test automatici): avviato `next dev` e navigato
  `/materie` con un `DATABASE_URL` volutamente non raggiungibile, per controllare lo stato di errore
  vero. Ha trovato due bug reali, corretti nella stessa sessione: (1) `GET /api/subjects` non aveva
  `try/catch` e restituiva un 500 non strutturato; (2) un `AggregateError` di Postgres (es.
  `ECONNREFUSED`) ha `.message` vuoto a livello top — `err.message` da solo violava "mostra l'errore
  reale"; risolto con `apps/web/src/lib/errors.ts` (`formatError`, che scende in `err.errors[]`).
  Promemoria per le fasi successive: **testare in browser**, non fidarsi solo dei test unitari per
  i percorsi di errore — questa classe di bug non l'avrebbe presa nessun test con mock puliti.

## Aggiornamento 2026-09-26 — OCR, grafo schemi, embeddings, editor

Completati i quattro blocchi rimasti aperti (provider: `ClaudeCliProvider`; embedding: locale
gratuito, `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers`). Scope-down dichiarati rispetto
alla visione completa di `docs/07-markdown-layer.md`: trascrizione schemi a **singolo passaggio**
(non due-pass §5.4c), nessun preprocessing immagine (deskew/dewarp/tiling), vocabolario di
contesto per keyword-frequency (non per embedding). La pagina di Triage con selezione multipla e
scorciatoie `1/2/3/4` resta fuori scope (solo pre-classificazione per singolo documento).

- **Embeddings + ricerca ibrida**: `chunks.embedding vector(384)` (migrazione `0011`, pgvector
  abilitato con `CREATE EXTENSION vector`), job `embed_chunks` (chiamato in-process da
  `extract_text`, non come job separato in coda — evita una race sull'ordine con i chunk appena
  scritti). `apps/web/src/lib/search.ts`: FTS (`websearch_to_tsquery`) + similarità coseno
  (`<=>`), fusione **RRF** (k=60), fallback a solo-FTS se il modello non è disponibile. UI: campo
  di ricerca in `SubjectDetailClient` con risultati che aprono il documento alla pagina citata.
- **OCR**: `AiProvider.ocrText` (stesso pattern I/O di `transcribeSchema`). `extractText.ts` ora
  gestisce immagini (jpeg/png/webp, OCR diretto) e pagine PDF scansionate (rese in PNG via
  `@napi-rs/canvas` + `pdfjs-dist`, poi OCR pagina per pagina) — le pagine col layer testo restano
  invariate, zero chiamate AI per quelle.
- **Pre-classificazione tipo documento**: `AiProvider.classifyDocumentType`, job
  `classify_document_type` enqueued dopo ogni upload. Scrive `documents.typeSuggested`/
  `typeConfidence`, **mai** sovrascrive `type` — la UI mostra "AI: schemi (86%)" con
  conferma/ignora a un click (`DocumentList.tsx`).
- **Grafo schemi a mano**: nuove tabelle `schema_nodes`/`schema_edges`/`schema_groups`/
  `transcription_corrections` (migrazione `0011`), **accanto** a `schema_blocks` (non sostituita:
  i documenti già trascritti col vecchio formato restano leggibili finché non vengono
  ritrascritti). `transcribeSchema.ts` v2 produce un grafo con tassonomia chiusa
  (`node.kind`/`edge.type` da `docs/07-markdown-layer.md` §5.2), scrive `content.md` con
  front-matter YAML generato deterministicamente dai dati strutturati (mai markdown grezzo dal
  modello). `VerifySchemaClient.tsx` riscritta: overlay dei bounding box (crop normalizzato 0..1)
  sull'immagine, click per selezionare un nodo, "Prossimo incerto", select vincolata alla
  tassonomia chiusa, export `.canvas` (JSON Canvas, via `packages/core/src/schemaGraphRender.ts`,
  condiviso worker/web) e Mermaid (route dedicata, non ancora renderizzato graficamente in UI —
  solo la stringa `graph TD`, l'integrazione della libreria `mermaid` client-side resta da fare).
- **Profilo di grafia**: `AiProvider.distillHandwritingProfile` (modello haiku), job
  `distill_handwriting_profile` enqueued dopo ogni correzione di label salvata (non in batch come
  da §5.4b — semplificazione: ogni chiamata rilegge le ultime 20 correzioni, idempotente ma non
  ottimale in costo se l'utente corregge molti nodi di fila). Scrive
  `subjects/<slug>/.studyhub/handwriting-profile.md`, letto e passato come contesto extra alla
  trascrizione successiva.
- **Editor `content.md` con stickiness**: nuova pagina `/materie/[slug]/documenti/[documentId]`
  (viewer + editor), `documents.mdEdited`/`mdConflict` (quest'ultima nuova). Un re-ingest con
  `mdEdited=true` scrive `content.new.md` invece di sovrascrivere — mai silenzioso — e la UI
  mostra un diff riga-per-riga (libreria `diff`) con "mantieni la mia versione"/"usa la nuova".
  `content.orig.md` ora è scritto **una sola volta** (prima veniva sovrascritto a ogni re-ingest,
  vanificando il suo scopo di base per il diff) — corretto sia in `extractText.ts` che nel
  processor grafo, tramite l'helper condiviso `writeCanonicalMarkdown.ts`.

**Scoperta seria durante la verifica Docker reale** (non l'avrebbe presa nessun test automatico,
che gira su pglite/Node nudo, non nell'immagine di produzione): `onnxruntime-node` (dipendenza di
`@xenova/transformers`) ships un binario nativo linkato contro **glibc** — nessuna build musl
esiste a monte. Sotto Alpine, anche con `apk add libc6-compat`, **va in segfault**
(`Ort::Exception`, exit 139) al primo caricamento del modello — lo shim copre lookup di simboli
semplici, non un addon nativo di queste dimensioni. Risolto passando `docker/Dockerfile.worker` e
`docker/Dockerfile.web` da `node:22-alpine` a `node:22-bookworm-slim` (Debian, glibc reale) —
verificato che sia `@xenova/transformers` sia `@napi-rs/canvas` funzionano davvero nell'immagine
risultante, non solo che l'immagine builda. Trovato anche un secondo problema nello stesso punto:
il build Next.js di `apps/web` tentava di impacchettare il binario nativo di `onnxruntime-node` nel
bundle webpack di qualunque route che importasse anche solo `resolveProvider` da `@studyhub/ai`
(via il barrel `index.ts`), con `Module parse failed: Unexpected character`. `serverExternalPackages`
non bastava (verificato: continuava a seguire l'import). Risolto isolando `embeddings.ts` dal
barrel principale (subpath dedicato `@studyhub/ai/embeddings`) e importandolo in
`apps/web/src/lib/search.ts` con `import(/* webpackIgnore: true */ ...)`, l'unico punto del pacchetto
web che ne ha davvero bisogno.

Verificato end-to-end su stack Docker reale (Postgres+pgvector, Redis, provider `FakeProvider` —
nessuna `ANTHROPIC_API_KEY`/sessione `claude` disponibile in questo ambiente): upload PDF → OCR
non necessario (layer testo presente) → embedding calcolato → ricerca "entropia" trova il chunk
con la pagina esatta; upload immagine come `schemi` → `classify_document_type` e
`transcribe_schema` completano senza errori (grafo con un nodo `unreadable` e messaggio onesto,
essendo `FakeProvider` — corretto, non può leggere pixel); editor `content.md` e export
`.canvas`/Mermaid rispondono con dati reali. **Non verificato dal vivo** in questa sessione (nessuna
sessione `claude` autenticata né chiave Anthropic disponibili): la qualità reale della trascrizione
vision (nodi/archi/confidenza plausibili su una foto vera di uno schema a mano), il costo/tempo
reale di una sessione di verifica completa, e se il vocabolario di contesto migliora davvero le
trascrizioni successive.

`pnpm turbo run test`: 61 test `@studyhub/ai`, 90 `@studyhub/worker`, 178 `@studyhub/web`, oltre a
`@studyhub/db`/`@studyhub/core`/`@studyhub/contracts`/`@studyhub/cli` — tutti verdi (eseguiti con
`--concurrency=2`; con la concorrenza di default di turbo la macchina di sviluppo va OOM eseguendo
tutte le build+test in parallelo, non è un problema del codice).
