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

## Stato: slice deterministica implementata (2026-09-22)

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
