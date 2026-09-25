# F2 — Materie & Materia Singola

## Obiettivo

La materia ha una pagina che è un vero centro di controllo: tutto raggiungibile, niente scroll infinito.

## Scope

**Pagina Materie**: griglia di card (nome, colore, prossimo esame + countdown, % mastery,
card in scadenza oggi, n. documenti, barra di copertura argomenti). Azioni: crea, modifica, archivia, elimina
(con conferma che dice **esattamente** cosa viene cancellato sul disco), riordina, filtra, ricerca.

**Pagina Materia Singola** — layout a 3 colonne:

- _Sinistra (240px)_: albero Argomenti con heatmap di mastery, filtro globale della pagina.
- _Centro_: tab `Panoramica | Appunti | Schemi | Esami | Flashcard | Simulazioni | Piano`.
  La Panoramica è la vista di default: prossimo esame, 3 azioni consigliate, attività recente, gap rilevati.
- _Destra (320px, collassabile)_: **pannello AI contestuale** — le azioni disponibili cambiano in base
  alla selezione corrente (selezioni 2 documenti → "genera flashcard da questi 2"; selezioni un argomento →
  "drill su questo argomento"). È qui che il prodotto diventa fluido: **l'azione AI segue la selezione**.

## Decisioni

- **Selezione come stato di prima classe**: un `SelectionContext` (documenti + argomenti) condiviso
  fra albero, tab e pannello AI. È il pattern che evita 12 modali diversi.
- **Argomenti editabili**: rinomina, unisci, sposta, elimina, crea a mano. L'AI propone, l'utente possiede la tassonomia.
- Eliminazione materia: default = archivia (nasconde, non tocca il disco). `Elimina definitivamente` sposta
  la cartella in `/data/.trash/` con timestamp, non `rm -rf`.

## Criteri di accettazione

- [ ] Da Materie a un argomento specifico in ≤2 click.
- [ ] Seleziono 3 documenti e il pannello destro offre le azioni giuste, con costo stimato.
      (Checkbox su ogni documento pronto in `DocumentList`, `GenerationPanel`/`TopicsPanel` si
      scopano alla selezione quando non è vuota — vedi "Aggiornamento" in fondo al file. Non
      spuntato: solo `tsc`/eslint puliti, nessuna verifica in browser reale né test automatico —
      questo repo non ha un setup per testare componenti React, coerente col resto del codice ma
      più debole delle altre verifiche "Stato" di questo file.)
- [x] Unisco due argomenti duplicati: flashcard e chunk si riattaccano correttamente.
- [ ] Archivio una materia: sparisce dalla dashboard, la cartella resta intatta.
- [ ] La pagina con 200 documenti e 2000 flashcard resta reattiva (virtualizzazione liste).

## Rischi

- Sovraccarico cognitivo: 7 tab + albero + pannello è tanto. Mitigazione: la Panoramica risponde da sola all'80%
  dei casi; le tab sono per il lavoro mirato. Testare con dati reali, non con 3 righe finte.

## Stato: slice non-AI implementata (2026-09-22)

Come per F1, implementata solo la parte che non dipende da un provider AI o da dati che non
esistono ancora (FSRS/F4, simulazioni/F5). **Non implementato**: mastery calcolata (resta `null`
finché F4/F5 non esistono), layout a 3 colonne virtualizzato per 200+ documenti/2000+ flashcard,
tab Flashcard/Simulazioni/Piano (F4/F5/F6). (Il merge argomenti è implementato — vedi
"Aggiornamento" in fondo al file; il pannello AI contestuale che segue la selezione anche.)

Cosa c'è, con test reali (144 test totali nel monorepo):

- **Tabelle `exams` e `topics`** (migrazione `0002_exams_topics.sql`), `topics.parent_id`
  auto-referenziato con `ON DELETE CASCADE` per l'albero.
- **Griglia Materie**: conteggio documenti e countdown del prossimo esame calcolati via
  aggregazione SQL (`apps/web/src/lib/subjects.ts::listSubjectSummaries`, con `filter (where
status = 'scheduled' and date > now())` per ignorare esami passati o annullati — testato).
  Le materie archiviate sono nascoste di default, toggle "Mostra archiviate".
- **Archiviazione**: reversibile, non tocca il filesystem (`archived_at` nullable).
- **Eliminazione definitiva**: sposta la cartella in `/data/.trash/<timestamp>-<slug>/`
  (mai `rm -rf`, `packages/core/src/trash.ts`), poi rimuove la riga DB — i cascade ripuliscono
  documents/chunks/exams/topics/jobs collegati. La UI mostra il path esatto prima di confermare
  (`SubjectActions.tsx`), come richiesto in "Decisioni".
- **Argomenti**: CRUD utente (crea/rinomina/riassegna genitore/elimina), sempre `source: 'user'`
  in questa fase — nessuna proposta AI. Pagina materia a 2 click da Materie (criterio di
  accettazione soddisfatto per la parte di navigazione, non per il merge).
- **Esami**: CRUD, ordinati per data, usati sia per il countdown in griglia sia in un pannello
  nella pagina materia.

Verificato in browser reale (senza Postgres, come in F1): nessun errore di render/hydration sulle
nuove pagine/componenti nel percorso di errore; il flusso funzionale completo (creare argomento,
esame, archiviare, eliminare) è coperto solo dai test automatici con pglite, non da un click reale
in browser — richiederebbe un Postgres raggiungibile che non è disponibile in questo ambiente.

## Aggiornamento — `document_topics` (2026-09-24)

Il collegamento documento→argomento, rimandato da questa fase fin dall'inizio, è ora implementato:
tabella `document_topics` (many-to-many, migrazione `0007_document_topics.sql`, cascade da entrambi
i lati — cancellare un documento o un argomento ripulisce solo i suoi link, non l'altra entità),
`apps/web/src/lib/documentTopics.ts::setDocumentTopics` (sostituisce l'intero set di tag di un
documento, valida che documento e argomenti appartengano alla materia), route
`PUT /api/subjects/:slug/documents/:documentId/topics`, e un tagger inline su ogni riga di
`DocumentList.tsx` (chip per argomento, toggle immediato). 10 test nuovi
(`apps/web/test/documentTopics.test.ts`) + 4 sullo schema (cascata, chiave composita, molti-a-molti).

Sblocca concretamente lo scope `topicIds` di F3 (vedi `docs/fasi/F3-ai-core.md` "Stato") — la
`ScopeNotSupportedError` menzionata sopra non esiste più. Sblocca anche il Planner (F6, aggiornato
nella stessa giornata): pianifica ora sugli argomenti taggati quando esistono, coi documenti non
taggati come fallback — vedi `docs/fasi/F6-planner-calendario.md` "Stato". Nessuna proposta AI di
tag: `document_topics.source` distingue già `'user'`/`'ai'` nello schema, ma solo l'utente può
crearli in questa slice.

## Aggiornamento — heatmap di mastery nell'albero Argomenti (2026-09-24)

Il criterio di accettazione "albero Argomenti con heatmap di mastery" era rimasto vuoto perché fino
ad ora `topics.mastery` era sempre `null` (nessun consumatore l'avesse mai scritto — vedi
`docs/fasi/F4-flashcard.md`/`F5-esami-simulazioni.md` "Stato": ora si ricalcola a ogni review FSRS
e a ogni simulazione corretta). `TopicsPanel.tsx` mostra ora un pallino colorato per argomento
(rosso <40%, ambra 40–70%, verde ≥70%, grigio se il dato è assente) con un tooltip che riporta sia
il valore sia la formula per esteso (`0.5·retrievability + 0.3·simulazioni + 0.2·copertura`,
docs/02-filesystem-e-dati.md §5 — "niente numeri magici"). Nessuna modifica a contratto/API: `mastery`
era già nel `TopicDto`, solo mai renderizzato. Non verificato in browser reale (stesso limite delle
altre fasi: nessun Postgres raggiungibile in questo ambiente); typecheck/lint puliti.

## Aggiornamento — merge argomenti (2026-09-24)

Ultimo pezzo dichiarato "non implementato" fin dalla slice originale: `apps/web/src/lib/topics.ts::
mergeTopics(db, subjectSlug, sourceTopicId, targetTopicId)` unisce due argomenti e cancella la
sorgente — `POST /api/subjects/:slug/topics/:topicId/merge` con body `{ intoTopicId }`, pulsante
"Unisci" (visibile in hover, accanto a "Elimina") in `TopicsPanel.tsx` con un piccolo selettore
dell'argomento di destinazione.

Tutto ciò che punta alla sorgente viene riassegnato **prima** di cancellarla, dentro una transazione,
così il cascade delete di `topics` non perde nulla per errore: `flashcards.topicId`,
`document_topics` (un documento già taggato a entrambi perde solo il duplicato, niente violazione
della chiave composita), `simulation_items.topicId`, `tasks.topicId`, e i figli della sorgente
nell'albero (riparentati alla destinazione — tranne la destinazione stessa se era un suo figlio
diretto, che sale al genitore della sorgente invece di diventare genitore di se stessa). A fine
merge la mastery della destinazione viene ricalcolata (`recomputeTopicMastery`), visto che ora ha
più card/simulazioni collegate.

6 test nuovi in `apps/web/test/topics.test.ts` (riattacco flashcard+document_topics, dedup su tag
duplicato, riparenting dei figli, promozione della destinazione quando era figlia diretta della
sorgente, rifiuto di unire un argomento a se stesso, `TopicNotFoundError` per id sconosciuti).
Chiude il criterio di accettazione "Unisco due argomenti duplicati: flashcard e chunk si
riattaccano correttamente" — i "chunk" del criterio non hanno un `topicId` proprio (appartengono a
un documento, che raggiunge l'argomento solo via `document_topics`), quindi riattaccare
`document_topics` è la parte "chunk" del criterio.

## Aggiornamento — selezione documenti che scopa il pannello destro (2026-09-26)

Il "pannello AI contestuale che segue la selezione" del criterio di accettazione non esisteva:
`GenerationPanel`/`TopicsPanel` includevano sempre *tutti* i documenti `parsed` della materia,
niente scelta di un sottoinsieme. Ora `DocumentList` mostra una checkbox su ogni documento pronto;
lo stato di selezione vive in `SubjectDetailClient` (un `Set<string>`, passato in giù) e, quando
non è vuoto, `GenerationPanel`/`TopicsPanel` lo intersecano con i propri documenti pronti invece di
usarli tutti — la stima costo del `ModelPicker` (vedi `docs/fasi/F3-ai-core.md` "Aggiornamento")
ne beneficia gratis, visto che dipende dagli stessi `docIds`. Selezione vuota = comportamento
precedente invariato, nessuna rottura per chi non tocca mai le checkbox.

**Non verificato in browser**: questo repo non ha un setup per testare componenti React (tutti i
test esistenti sono su `apps/web/src/lib/*`, mai su un componente) e in questo ambiente non è
disponibile un Postgres per far partire l'app — solo `tsc --noEmit` ed eslint puliti su ogni file
toccato. Più debole delle altre voci di questo "Stato", dichiarato qui invece che taciuto.
