# Filesystem, Data Model e Sincronizzazione

## 1. Layout su disco (fonte di verità)

```
/data/
├─ subjects/
│  └─ fisica-1/
│     ├─ subject.json           # manifest: id, nome, colore, docente, CFU, esami
│     ├─ sources/               # file originali, IMMUTABILI
│     │  ├─ appunti/
│     │  ├─ schemi/
│     │  ├─ esami/
│     │  └─ slide/
│     ├─ derived/               # estrazioni deterministiche (rigenerabili)
│     │  └─ <docId>/{text.md, pages/, meta.json, thumbs/}
│     ├─ artifacts/             # output AI (rigenerabili ma versionati)
│     │  ├─ flashcards/<deckId>.json
│     │  ├─ schemas/<id>.md
│     │  ├─ summaries/<id>.md
│     │  └─ simulations/<id>.json
│     ├─ plans/<planId>.json
│     └─ .studyhub/             # index locale, checksum, lock
├─ exports/
└─ tmp/
```

**Regole d'oro**
1. `sources/` non viene mai modificato né cancellato da un job. Solo dall'utente.
2. `derived/` e `artifacts/` sono ricostruibili: cancellarli non perde dati utente (perde solo tempo/token).
3. Ogni file in `artifacts/` ha front-matter con `generatedBy`, `model`, `promptVersion`, `sourceDocIds`, `approvedAt`.
4. Lo slug della cartella è stabile e non cambia se rinomini la materia (il nome vive in `subject.json`).

## 2. Sincronizzazione FS ↔ DB
Il DB è un **indice**. Un `reconcile` job:
- scansiona `subjects/`, calcola `sha256` dei file,
- inserisce documenti nuovi (drop-in da file manager = ingest automatico),
- marca `missing` quelli spariti senza cancellare i record,
- espone i conflitti in `/admin/sync`.

Trigger: all'avvio del worker, ogni 15 min, e on-demand. Watcher `chokidar` opzionale (`STUDYHUB_WATCH=1`).

## 3. Schema relazionale (essenziale)

```sql
subjects(id, slug, name, color, icon, professor, cfu, folder_path, archived_at, created_at)

exams(id, subject_id, title, kind /*scritto|orale|parziale|progetto*/,
      date, weight, description, location, status)

documents(id, subject_id, type /*appunti|schemi|esami|slide|altro*/,
          original_name, stored_path, mime, bytes, sha256, pages,
          status /*uploaded|parsing|parsed|failed|missing*/,
          lang, created_at, ingested_at)

topics(id, subject_id, parent_id, name, slug, order_index,
       confidence, source /*ai|user*/, mastery /*0..1, calcolato*/)

document_topics(document_id, topic_id, weight)

chunks(id, document_id, topic_id, page_from, page_to, ord,
       text, tokens, embedding vector(1024))

artifacts(id, subject_id, kind /*flashcard_deck|schema|summary|simulation|drill*/,
          title, path, status /*draft|approved|archived*/,
          model, prompt_version, cost_eur, created_at, approved_at)

artifact_sources(artifact_id, document_id)

flashcards(id, deck_id, topic_id, type /*basic|cloze|qa|formula*/,
           front, back, hint, source_ref jsonb /*{docId,page,quote}*/,
           -- FSRS state
           stability, difficulty, due_at, last_review_at, reps, lapses,
           state /*new|learning|review|relearning*/, suspended)

reviews(id, flashcard_id, rating /*1..4*/, elapsed_ms, reviewed_at,
        prev_stability, new_stability)

study_plans(id, subject_id, exam_id, target_date, strategy,
            status /*draft|active|superseded|done*/, params jsonb, created_at)

tasks(id, plan_id, subject_id, topic_id, date, slot /*morning|afternoon|evening*/,
      kind /*read|flashcards|schema|simulation|drill|rest|review*/,
      title, description, est_minutes, payload jsonb /*deckId, docIds, pages…*/,
      status /*todo|doing|done|skipped|moved*/, actual_minutes, completed_at)

sessions(id, task_id, subject_id, started_at, ended_at, focus_score, notes)

jobs(id, type, subject_id, status, input jsonb, output jsonb,
     model, progress, cost_eur, error jsonb, created_at, finished_at)

settings(key, value jsonb)   -- model routing, profili, preferenze
```

Indici: `chunks USING hnsw (embedding vector_cosine_ops)`, GIN su `to_tsvector('italian', text)`,
`tasks(date, status)`, `flashcards(due_at) WHERE NOT suspended`.

## 4. Modello di ripetizione spaziata
**FSRS-5** (non SM-2): migliore aderenza ai dati reali e, soprattutto, espone `retrievability(t)` —
serve al Planner per rispondere a *"quante card saranno dimenticate il giorno dell'esame?"*.
Implementazione: `ts-fsrs`. Parametri ottimizzabili dai `reviews` dell'utente dopo ~1000 recensioni.

## 5. Mastery per argomento
`mastery(topic) = 0.5·retrievability_media_card + 0.3·accuratezza_simulazioni + 0.2·copertura_materiale_letto`
Valore 0..1 usato per: heatmap in Dashboard, priorità del Planner, ordinamento della pagina Materia.
Formula esplicitata in `packages/core/mastery.ts` e **mostrata all'utente** in tooltip: niente numeri magici.

---

## 6. Aggiornamento: Markdown canonico, grafi degli schemi e stati del piano

Vedi `docs/07-markdown-layer.md` per la specifica completa.

### 6.1 Modifiche al layout su disco
`derived/<docId>/` ospita ora il **formato canonico** dell'applicazione:
```
derived/<docId>/
├─ content.md        # canonical markdown (l'unico input delle funzioni AI a valle)
├─ content.orig.md   # prima generazione, immutabile, per il diff
├─ assets/           # ritagli figure, regioni di schema
└─ meta.json
subjects/<slug>/.studyhub/handwriting-profile.md    # convenzioni di grafia apprese
subjects/<slug>/artifacts/maps/<id>.canvas          # export JSON Canvas (Obsidian)
```
`derived/` resta formalmente rigenerabile, **ma**: un `content.md` con `edited: true` contiene lavoro umano
e va incluso nei backup e trattato come dato utente a tutti gli effetti.

### 6.2 Modifiche allo schema relazionale

```sql
-- documents: stato e qualità della normalizzazione
ALTER TABLE documents ADD COLUMN md_path text;
ALTER TABLE documents ADD COLUMN md_edited boolean DEFAULT false;
ALTER TABLE documents ADD COLUMN md_confidence real;
ALTER TABLE documents ADD COLUMN verification_status text
      DEFAULT 'not_required';  -- not_required | pending | partial | verified
ALTER TABLE documents ADD COLUMN blocked_blocks int DEFAULT 0;

-- grafo degli schemi
schema_nodes(id, document_id, node_key /*n7*/, label, kind, crop jsonb /*{page,x,y,w,h}*/,
             confidence /*ok|uncertain|unreadable*/, verified_at, verified_by,
             topic_id, md_anchor)

schema_edges(id, document_id, from_node, to_node, type, label, confidence, verified_at)

schema_groups(id, document_id, group_key, label, node_keys text[])

-- correzioni: alimentano il profilo di grafia
transcription_corrections(id, document_id, node_key, before, after, kind, created_at)
```
Indici: `schema_nodes(document_id, confidence)` per la coda di verifica;
`schema_edges(from_node)`, `schema_edges(to_node)` per la navigazione del grafo.

```sql
-- tasks: stato "proposed" e materializzazione oraria
ALTER TABLE tasks ADD COLUMN starts_at timestamptz;   -- NULL = task del giorno senza orario
ALTER TABLE tasks ADD COLUMN ends_at   timestamptz;
ALTER TABLE tasks ADD COLUMN pinned    boolean DEFAULT false;
ALTER TABLE tasks ADD COLUMN origin    text DEFAULT 'planner';  -- planner | manual
-- tasks.status: proposed | todo | doing | done | skipped | moved
--   'proposed' = presente solo nella bozza di piano, invisibile al resto del sistema

-- eventi NON prodotti dal planner: vincoli in ingresso, non output
calendar_events(id, subject_id, kind /*esame|lezione|impegno|blackout*/,
                title, starts_at, ends_at, all_day, source /*manual|ics|exam*/,
                external_uid, blocks_study boolean)
```

**Le task sono gli eventi**: non esiste duplicazione fra `tasks` e `calendar_events`.
Motivazione in `docs/04-planner.md` §9.4.

### 6.3 Regola di qualità applicata a livello di query
Ogni job generativo (`flashcards`, `schema`, `summary`, `simulation`) filtra i blocchi sorgente con:
`confidence = 'ok' OR verified_at IS NOT NULL`.
Un documento con blocchi bloccati espone il conteggio in UI: *"12 blocchi esclusi, 3 nodi da verificare"*.
