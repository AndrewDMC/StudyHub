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

- [x] Da Materie a un argomento specifico in ≤2 click. (1: card materia da `/materie`; 2: clic
      sull'argomento nell'albero — lo seleziona, filtra la tab corrente e scopa il pannello AI su
      di esso. Verificato in browser reale, vedi "Aggiornamento" in fondo al file.)
- [x] Seleziono 3 documenti e il pannello destro offre le azioni giuste, con costo stimato.
      Checkbox su ogni documento pronto in `DocumentList`, `GenerationPanel` si scopa alla
      selezione quando non è vuota. Verificato con un vero e2e Playwright (3 documenti seminati
      direttamente in `parsed` via `@studyhub/db`, nessun worker necessario per lo scopo del
      test) — vedi "Aggiornamento" in fondo al file.
- [x] Unisco due argomenti duplicati: flashcard e chunk si riattaccano correttamente.
- [x] Archivio una materia: sparisce dalla dashboard, la cartella resta intatta. Anche questo ora
      coperto da un e2e Playwright, oltre ai test pglite.
- [x] La pagina con 200 documenti e 2000 flashcard resta reattiva (virtualizzazione liste).
      `DocumentList` e `FlashcardListPanel` virtualizzati con `@tanstack/react-virtual`; verificato
      con lo script di seed `packages/services/scripts/seed-load-test.ts` e in browser reale — solo
      ~11-16 righe montate nel DOM alla volta indipendentemente dal totale (67 documenti/2000
      flashcard). Vedi "Aggiornamento" in fondo al file.

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
`GenerationPanel`/`TopicsPanel` includevano sempre _tutti_ i documenti `parsed` della materia,
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

## Aggiornamento — tab Flashcard, virtualizzazione, e2e di chiusura (2026-09-28)

Chiude gli ultimi tre pezzi dello scope F2: la tab Flashcard aveva solo `StatsPanel` (nessuna
lista); niente era virtualizzato; i tre criteri di accettazione più complessi non erano mai stati
verificati con un vero browser contro un vero Postgres.

- **Tab Flashcard**: nuova `GET /api/subjects/:slug/flashcards` (`apps/web/src/lib/review.ts::
listFlashcards`, nuovo `FlashcardPageDto`/`ListFlashcardsQuerySchema` in
  `packages/contracts/src/review.ts`) — cursor-based su `(createdAt, id)` DESC, non offset: un
  deck può avere migliaia di card, e l'offset peggiora a ogni pagina in più. Filtri per
  `topicId`/`state`/`suspended`, componibili. `FlashcardListPanel.tsx` (sola lettura + il toggle
  sospendi/riattiva già esistente su `PATCH /flashcards/:cardId`) — **l'editor in blocco resta
  F4**, come dichiarato nel piano.
- **Virtualizzazione** (`@tanstack/react-virtual`, nuova dipendenza): sia `DocumentList.tsx` che
  `FlashcardListPanel.tsx` misurano ogni riga (`measureElement`, non un'altezza fissa) perché il
  contenuto varia — `TopicTagger` aperto/chiuso, testo più o meno lungo. `FlashcardListPanel`
  combina la virtualizzazione con la paginazione a cursore: una riga sentinella in fondo alla
  finestra virtuale innesca `fetchNextPage()` quando scorre in vista, così le pagine si caricano
  pigramente invece che tutte insieme.
- **Script di seed** `packages/services/scripts/seed-load-test.ts` (nuovo, `pnpm --filter
@studyhub/services exec tsx scripts/seed-load-test.ts`): 200 documenti `parsed` + 2000
  flashcard su una materia dedicata, per riprodurre il criterio di accettazione senza dover far
  girare OCR/worker.
- **e2e Playwright** (`apps/web/e2e/materie-f2.spec.ts`, nuovo): i tre criteri di accettazione più
  difficili da verificare a livello di libreria — navigazione in ≤2 click con selezione argomento,
  selezione di 3 documenti `parsed` (seminati via `@studyhub/db`, non attraverso il worker) con
  verifica del testo del pulsante "Genera flashcard (3 selezionati)", archiviazione che sparisce
  dalla dashboard con verifica che la materia resti recuperabile via API (cartella intatta).

**Verificato per davvero, non solo dichiarato**: ambiente usa-e-getta Postgres/Redis (`docker run`,
stesso pattern degli aggiornamenti precedenti), `next dev` locale, Playwright con Chromium
installato al volo in questo ambiente. **4/4 e2e passano** (i 3 nuovi + quello di F0 già
esistente). Seed di carico eseguito ed esplorato in browser: `document.querySelectorAll
('[data-index]').length` restava a 11–16 sia nella tab Appunti (67 documenti) sia nella tab
Flashcard (2000 card, prima pagina da 50), con il fetch automatico della pagina successiva
confermato in rete (`GET /flashcards?cursor=...`) scrollando fino in fondo. Filtro per stato e
sospensione di una card verificati con la relativa `PATCH` in rete. Nessun errore console in
tutta la sessione.

21 test nuovi con pglite (`apps/web/test/review.test.ts::listFlashcards`, 4 test — ordine,
filtri, cursore, materia sconosciuta) sommati ai test già esistenti di F2 (202 totali nel
package web prima di questo aggiornamento). `tsc`/eslint puliti su `contracts`/`services`/`web`.
Ambiente di verifica smontato a fine sessione.

## Aggiornamento — Panoramica vera: azioni consigliate, gap, attività recente (2026-09-28)

Chiude l'ultimo pezzo dello scope "Centro" rimasto sulla carta: la Panoramica mostrava solo "Oggi"
(`DailyTasksPanel`, già di F6) — nessuna azione consigliata, nessun gap, nessuna attività recente.

- **`GET /api/subjects/:slug/overview`** (`apps/web/src/lib/overview.ts::getSubjectOverview`,
  nuovo `SubjectOverviewDto` in `packages/contracts/src/overview.ts`): un'unica chiamata che
  calcola le tre sezioni, tutte con regole deterministiche — **niente AI**, come richiesto
  esplicitamente nel piano.
- **3 azioni consigliate**, in un ordine di priorità fisso (i primi 3 candidati che si applicano,
  troncato — testato con 5 candidati contemporaneamente presenti):
  1. **Ripassa** — ci sono card in scadenza oggi (stessa regola di `dashboard.ts::countDueCards`).
  2. **Drill** — l'argomento con la mastery più bassa sotto il 40% (link a
     `/review?topicId=...`, riusa lo stesso Drill introdotto nell'aggiornamento precedente).
  3. **Verifica** — somma di `documents.blockedBlocks` sui soli documenti `schemi` (gli altri tipi
     non hanno un concetto di "blocco da confermare").
  4. **Genera piano** — un esame futuro `scheduled` ma **nessun piano** (`active` o `draft`) per la
     materia — non lo stesso segnale di "piano indietro" (`detectDrift`, già coperto altrove).
  5. **Tagga** — il primo documento `parsed` senza alcun tag in `document_topics`.
- **Gap rilevati**: per ogni argomento, tre controlli indipendenti (un argomento può comparire fino
  a 3 volte) — nessun documento assegnato (`document_topics`), nessuna flashcard
  (`flashcards.topicId`), mastery sotto il 40%. **Deliberatamente fuori**: il drift del piano
  (`detectDrift`) — ha già la sua API (`/plan/drift`) ed è già un banner in cima a
  `DailyTasksPanel`, nella stessa tab; ripeterlo qui sarebbe lo stesso avviso due volte.
- **Attività recente**: job, review (valutazioni FSRS) e upload di documenti, ultimi 7 giorni,
  uniti e ordinati per timestamp decrescente, max 10 righe. La query scarta esplicitamente le altre
  materie (a differenza di `dashboard.ts::getRecentJobs`, che è cross-subject di proposito).
- **Un solo endpoint, tre componenti**: `SuggestedActionsPanel`/`GapsPanel`/`RecentActivityPanel`
  (`OverviewPanel.tsx`) condividono la stessa `queryKey` React Query (`['overview', slug]`) — una
  sola fetch di rete anche se montati insieme nella stessa tab, senza bisogno di un context
  dedicato.

11 test nuovi con pglite (`apps/web/test/overview.test.ts`): una per ciascuna delle 5 azioni
(incluso "non suggerire piano se già esiste"), il troncamento a 3 in ordine di priorità, i gap
indipendenti sullo stesso argomento, l'attività recente con isolamento fra materie e finestra dei
7 giorni. `tsc`/eslint puliti su `contracts`/`web`.

**Verificato in browser reale** (stesso setup usa-e-getta Postgres/Redis dell'aggiornamento
precedente): materia con un argomento a mastery 20% e un esame senza piano — compaiono
correttamente solo le 2 azioni applicabili ("Drill", "Genera piano", non forzate a 3), i gap
mostrano le tre righe attese per l'unico argomento, "Attività recente" mostra correttamente lo
stato vuoto. Nessun errore in console; richiesta di rete `/overview` a 200 OK.

## Aggiornamento — `SelectionContext` e layout a 3 colonne (2026-09-28)

Chiude lo scope "Pagina Materia Singola" rimasto indietro: prima l'albero Argomenti e il pannello
AI vivevano solo nella tab Panoramica (le altre tab avevano ciascuna il proprio riquadro
`GenerationPanel` duplicato, senza argomenti a fianco), e cliccare un argomento non faceva nulla —
era una lista, non una selezione.

- **`SelectionContext`** (`apps/web/src/lib/selection.tsx`): `{ docIds, topicIds }` condiviso da
  `SubjectDetailClient` in giù via `SelectionProvider`, sostituisce lo `useState` locale che
  esisteva solo per i documenti. Sopravvive al cambio tab (query-string `?tab=`), si azzera solo
  con una navigazione piena (F5 o link da fuori pagina) — scelta deliberata: persisterlo oltre la
  sessione di navigazione (localStorage) avrebbe potuto lasciare un argomento "bloccato" selezionato
  in una visita futura senza che l'utente ricordi perché.
- **Layout a 3 colonne persistente**: sinistra (`TopicsPanel`, 240px) e destra (`AiPanel.tsx`
  nuovo, 320px, **collassabile** — stato in `localStorage`, di default aperto) ora presenti su
  _ogni_ tab, non solo Panoramica. `DocumentTypeTab` (Appunti/Schemi/Esami) ha perso il proprio
  riquadro-aside duplicato: genera dal pannello unico a destra.
- **Clic su un argomento** (`TopicNode` in `TopicsPanel.tsx`) lo seleziona (evidenziato,
  `aria-pressed`) **e** filtra la lista documenti della tab corrente via `document_topics`
  (`doc.topicIds` — già presente sul DTO per il tagging, mai usato per filtrare prima d'ora).
  Deselezione con un secondo clic o il link "Deseleziona" in testata al pannello.
- **`AiPanel.tsx`** (nuovo, sostituisce l'uso diretto di `GenerationPanel` dentro ogni tab): la
  selezione guida lo scope — documenti selezionati vincono su un argomento selezionato (più
  specifico); con solo un argomento selezionato, `GenerationPanel` costruisce uno scope
  `{ topicIds }` invece di `{ docIds }` (`generate_flashcards`/`schema`/`summary` risolvono già
  questo scope via `document_topics`, docs/fasi/F3-ai-core.md "Stato" — nessun endpoint nuovo).
  Con **esattamente un** argomento selezionato compare anche "Drill: ripassa questo argomento", un
  link a `/materie/:slug/review?topicId=...`: `getReviewQueue` accettava già un `topicId`
  (docs/fasi/F4-flashcard.md) ma nessuna UI lo collegava — `ReviewSessionClient.tsx` ora legge
  `?topicId=` da `useSearchParams` e lo passa alla query. Con più argomenti selezionati lo scope
  di generazione copre entrambi, ma il link Drill resta nascosto (non esiste un concetto di
  "sessione di ripasso multi-argomento" da collegare).
- **Semplificazione dichiarata**: "drawer sotto `lg`" del piano originale è diventato un
  collassa/espandi che si applica a _ogni_ breakpoint (sotto `lg` la griglia è già a colonna
  singola, quindi collassare nasconde semplicemente la sezione impilata sotto la tab attiva
  invece di aprire un vero bottom-sheet). Scelta per restare proporzionati allo scope: un vero
  drawer overlay per mobile non aggiungeva nulla che il collasso non desse già.

**Verificato in browser reale** (non solo `tsc`/eslint, per la prima volta su questo file): con
Docker già disponibile in questo ambiente, avviate istanze usa-e-getta di Postgres/pgvector e
Redis (`docker run`, non i container del progetto), migrazioni applicate con
`packages/db/src/migrate.ts`, `next dev` locale puntato lì. Verificato dal vivo: navigazione
Materie → materia → clic argomento in ≤2 click con evidenziazione ed effetto di filtro; selezione
di un argomento che sopravvive al cambio tab (Appunti → Schemi); pannello AI che si scopa
sull'argomento ("Argomento: Meccanica", stima costo "gratis" col `FakeProvider`); collasso/espansione
del pannello con persistenza al reload; link Drill che naviga a `/review?topicId=...` e la request
di rete porta davvero quel `topicId`; dialog "Modifica" (dal punto 2) con salvataggio verificato via
`GET /api/subjects/fisica-1` dopo il `PATCH`; riordino (dal punto 2) verificato persistente dopo un
reload pieno. Nessun errore in console durante l'intera sessione. **Non verificato dal vivo**: lo
scoping su _documenti_ selezionati (serve un documento `parsed`, quindi il worker in esecuzione —
fuori dal perimetro di questa sessione di verifica), e il comportamento sotto `lg` (non testato il
resize del viewport).

## Aggiornamento — griglia Materie: modifica, riordino, filtro e ricerca (2026-09-28)

Chiude il resto della frase di scope rimasta indietro: "Azioni: crea, modifica, archivia, elimina
[...], riordina, filtra, ricerca" — prima c'erano solo crea/archivia/elimina.

- **Modifica**: `apps/web/src/lib/subjects.ts::updateSubject` sostituisce l'uso diretto di
  `setSubjectArchived` nella route `PATCH /api/subjects/:slug` — accetta ora qualunque
  sottoinsieme di `name`/`color`/`professor`/`cfu`/`archived` (`UpdateSubjectRequestSchema` esteso
  di conseguenza; `setSubjectArchived` resta come wrapper sottile, non rimosso, perché già usato
  altrove). **Non tocca mai `slug`/`folderPath`**: rinominare una materia non sposta né rinomina
  nulla su disco, come da "Decisioni" (`subjects table > renaming a subject does not change its
folder_path or slug`, test già esistente in `packages/db/test/schema.test.ts`, ora verificato
  anche end-to-end). `professor`/`cfu` accettano `null` per essere svuotati esplicitamente, mentre
  ometterli lascia il valore esistente intatto. Nuovo componente `EditSubjectForm.tsx`, montato in
  un dialog dietro un pulsante "Modifica" in `SubjectActions.tsx`.
- **Riordino**: nuova colonna `subjects.sort_order` (migrazione `0012_add_subjects_sort_order.sql`,
  intero, default 0), assegnata a `max(sort_order)+1` alla creazione
  (`packages/services/src/subjects.ts::createSubjectRow`) così una materia nuova non si inserisce
  mai in mezzo a un ordine già sistemato a mano. `listSubjectSummaries` ordina per
  `sort_order, name` invece che solo per nome. `reorderSubjects(db, slugs)` (transazionale)
  riassegna l'ordine per l'intera lista — **rifiuta** una lista parziale o che contenga una materia
  archiviata, per non lasciare materie interfogliate in un ordine confuso; route dedicata
  `PATCH /api/subjects/order`. UI: frecce ▲▼ su ogni card (visibili in hover), disabilitate ai
  bordi della lista e **nascoste del tutto quando la griglia è filtrata o mostra le archiviate** —
  riordinare un sottoinsieme non ha un mapping pulito sul contratto "lista completa" del backend.
- **Filtro e ricerca**: casella di ricerca (nome o docente, case-insensitive) e checkbox "Esame
  entro 30 giorni" in `MaterieClient.tsx`, entrambi lato client sulla lista già scaricata (nessuna
  nuova query: il dataset di una singola persona non giustifica un filtro server-side). Stato
  vuoto distinto per "nessuna materia" vs "nessuna materia corrisponde ai filtri".

18 test nuovi con pglite (`apps/web/test/subjects.test.ts`: `updateSubject` × 3, `reorderSubjects`
× 3, ordine di creazione/riordino in `listSubjectSummaries`). **Non verificato in browser reale**
per gli stessi motivi delle altre voci UI di questo file (nessun setup per testare componenti
React, nessun Postgres raggiungibile in questo ambiente) — solo `tsc --noEmit` ed eslint puliti su
ogni pacchetto toccato (`contracts`, `db`, `services`, `web`).

## Aggiornamento — un'archiviazione ora nasconde davvero tutto, non solo la card (2026-09-28)

Il criterio "Archivio una materia: sparisce dalla dashboard, la cartella resta intatta" era solo
parzialmente vero: `listSubjectSummaries` esclude di default le materie archiviate (da cui la card
sparisce dalla griglia Materie), ma `apps/web/src/lib/dashboard.ts::getDashboardSummary` interrogava
`exams`/`topics`/`flashcards` senza filtrare `subjects.archivedAt` — un esame, una card in scadenza
o la mastery di una materia archiviata continuavano a comparire nella dashboard (countdown prossimo
esame, conteggio card, media mastery). Stesso problema in
`apps/web/src/lib/calendar.ts::getCalendarRange`, da cui la dashboard riusa la fascia "impegni di
oggi"/i 14 giorni, e che è condivisa anche dalla pagina `/calendario` e dal feed ICS.

Corretto aggiungendo `isNull(subjects.archivedAt)` a `countDueCards`, `countDueCardsBySubject`,
`averageMastery`, `nextExam` (dashboard.ts) e alle query task/esami di `getCalendarRange`
(calendar.ts) — un join in più su `subjects` dove non c'era già. Scelta deliberata: il filtro vive
in `getCalendarRange` stesso, non solo nel percorso dashboard, perché archiviare una materia è
descritto come "metterla in pausa": non ha senso che i suoi task/esami restino visibili nel
Calendario generale o nel feed ICS mentre sono nascosti ovunque altrove. Gli eventi ICS importati
(`calendarEvents`) non sono legati a una materia, quindi non sono toccati.

2 test nuovi con pglite: `apps/web/test/dashboard.test.ts` (una materia archiviata con esame, card
in scadenza, mastery e task di oggi — tutto sparisce, la materia attiva resta) e
`apps/web/test/calendar.test.ts` (stesso scenario su `getCalendarRange` direttamente). Chiude per
davvero il criterio di accettazione "Archivio una materia" — prima verificato solo per la card
della griglia, non per il resto della dashboard.

## Aggiornamento — vista mobile di `/materie/[slug]`, slice 1 (2026-10-14)

Sotto 768 px (`md`) la pagina materia monta una vista dedicata invece del layout a 3 colonne
(`apps/web/src/components/subject-mobile/`). Il ramo è scelto da `useIsMobile`
(`apps/web/src/lib/useIsMobile.ts`): se ne monta uno solo, il desktop resta invariato.

- **Header**: indietro, titolo, cerca, kebab. L'header globale di `AppShell` è nascosto sotto `md` su questa pagina.
- **6 tab**: Panoramica, Materiale, Flashcard, Simulazioni, Lacune, Piano.
- **Panoramica**: card di stato con CTA, "Da fare adesso", task di oggi, argomenti con barre di mastery,
  attività recente.
- **FAB "Assistente"**: apre lo sheet "Azioni e AI" (generazione e azioni sulla materia), chiusura con swipe.
- **`?tab=` vecchi** (`appunti`, `schemi`, `esami`, `altro`): aprono Materiale con il filtro corrispondente
  (`apps/web/src/lib/subjectTabs.ts`).
- **Soglie di mastery** condivise in `apps/web/src/lib/mastery.ts`.
- Design di riferimento: `docs/design/materia-mobile/`.

Non ancora: ridisegno mobile di Materiale/Documento, Flashcard/Ripasso, Simulazioni/Esame, Lacune/Piano
e Sessione (slice 2-6). Nello sheet mancano il campo "Chiedi", il tile "Esercizi" e la selezione degli argomenti.

## Aggiornamento — vista mobile di `/materie/[slug]`, slice 2 (2026-10-15)

Sotto 768 px il tab "Materiale" e le schermate di documento passano alle viste dedicate in
[`apps/web/src/components/document-mobile/`](../../apps/web/src/components/document-mobile/).
Il desktop non cambia.

- **Materiale**: card "Aggiungi materiale" (Scatta / Scegli file), chip di filtro con conteggi, righe con
  pill di stato (Pronto, Estrazione, Da verificare, Errore — mappatura in
  [`apps/web/src/lib/documentStatus.ts`](../../apps/web/src/lib/documentStatus.ts)) che portano a Documento,
  Verifica o Originale. Modalità "Seleziona" per lo scope dell'Assistente. Sezione "Esami in programma" con sheet.
- **Documento**: header, switch Testo | Originale, pill degli argomenti, banner di conflitto, CTA
  "Genera flashcard" / "Studialo ora".
- **Originale**: viewer a schermo intero, tab bar nascosta. Pagina e zoom via frammenti `#page=&zoom=`;
  su iOS questi frammenti vengono ignorati.
- **Verifica**: progresso, stati Verificato / Incerto / Illeggibile, "Segna tutto verificato" con PATCH
  in sequenza.
- **Sheet generico** [`subject-mobile/BottomSheet.tsx`](../../apps/web/src/components/subject-mobile/BottomSheet.tsx),
  ora usato anche dall'Assistente (`AssistantSheet.tsx`).
- L'header globale di `AppShell` è nascosto anche su testo, originale e verifica del documento.

Non ancora: slice 3-6; il suggerimento AI del tipo di documento su mobile. Per i nodi Incerto/Illeggibile
ci sono ancora due PATCH, da ridurre a una dopo la PR #20.

## Aggiornamento — vista mobile di `/materie/[slug]`, slice 3 (2026-10-15)

Sotto 768 px la tab "Flashcard" passa alla vista dedicata
[`apps/web/src/components/flashcard-mobile/`](../../apps/web/src/components/flashcard-mobile/)
(`FlashcardMobile.tsx`). Il desktop non cambia: `FlashcardListPanel` e `StatsPanel` restano come erano.

- **Ripasso di oggi**: hero con CTA verso `/ripasso?materia=<slug>`; link ai mazzi in bozza da approvare;
  previsione dei prossimi 30 giorni; ritenzione reale a confronto con quella prevista, con frasi neutre.
- **Lista card**: ricerca, filtro per argomento, "Mostra altre". Il tap apre lo sheet di dettaglio con
  Modifica, Sospendi, Riattiva, Rimuovi segnalazione ed Elimina.
- **Strumenti del mazzo e calibrazione**: disclosure che monta i pannelli desktop così come sono.
- **Revisione mobile** su `/materie/[slug]/artifacts/[id]`
  ([`ArtifactReviewMobile.tsx`](../../apps/web/src/components/flashcard-mobile/ArtifactReviewMobile.tsx)):
  Tieni e Scarta sono segni locali; la card scartata viene eliminata solo all'approvazione del mazzo.
  Le card non marcate vengono approvate, come su desktop. Modifica salva subito. Le azioni sono
  disabilitate durante l'approvazione e su un mazzo già approvato.
- **Shell**: [`AppShell.tsx`](../../apps/web/src/components/AppShell.tsx) nasconde l'header globale anche su
  `/materie/[slug]/artifacts/[id]`.
- **Verifica**: [`VerifyMobile.tsx`](../../apps/web/src/components/document-mobile/VerifyMobile.tsx) fa una
  sola PATCH per Incerto/Illeggibile (chiude il punto aperto della slice 2, dopo la PR #20).
- **Ripasso** ([`quick-review/`](../../apps/web/src/components/quick-review/), riuso con `?materia=`):
  - link "Fonte" nella sessione;
  - con il deep link di materia, "Torna alla materia" porta a `/materie/<slug>?tab=flashcard`;
  - l'uscita attende lo svuotamento dell'outbox e resta su `/ripasso` se c'è un errore di invio;
  - alla chiusura si invalidano le query della materia.

Logica pura in [`apps/web/src/lib/flashcardMobile.ts`](../../apps/web/src/lib/flashcardMobile.ts).
Test: e2e [`materia-flashcard.mobile.spec.ts`](../../apps/web/e2e/materia-flashcard.mobile.spec.ts) (15 test),
[`materia-flashcard-desktop.spec.ts`](../../apps/web/e2e/materia-flashcard-desktop.spec.ts) (verifica che il
desktop non cambi), unit [`flashcardMobile.test.ts`](../../apps/web/test/flashcardMobile.test.ts).

Non ancora:

- stima "~14 min" nella lista (la scadenza per riga è fatta in slice A, vedi sotto);
- confidenza pre-risposta nel ripasso (chiusa in slice B, vedi sotto);
- il passo "Quanto sei sicuro?" del design (chiuso in slice B);
- slice 4-6 (Simulazioni/Esame, Lacune/Piano, Sessione).

## Aggiornamento — vista mobile di Simulazioni, slice 4 (2026-10-15)

Sotto 768 px le viste di simulazioni e tentativi passano ai componenti in
[`apps/web/src/components/simulation-mobile/`](../../apps/web/src/components/simulation-mobile/). Il desktop
non cambia; le route restano quelle di F5.

- **Tab Simulazioni**: profilo d'esame, lista simulazioni con sheet Inizia / Riprendi / Rifai / Vedi la
  correzione, generazione, andamento per argomento in disclosure.
- **Esame** (`/materie/[slug]/simulations/[id]`): una domanda alla volta, timer sticky, chip per saltare
  tra gli esercizi. Uscita e consegna passano da uno sheet di conferma; l'uscita usa `router.replace`.
- **Risultati** (`/materie/[slug]/attempts/[id]/results`): punteggio, dettaglio per esercizio, seconda
  opinione, drill sugli errori, stato "correzione in corso".
- **Shell**: [`AppShell.tsx`](../../apps/web/src/components/AppShell.tsx) nasconde l'header globale anche su
  queste due route.
- **Hook e logica**: [`useExamAttempt.ts`](../../apps/web/src/lib/useExamAttempt.ts) è chiamato una sola volta
  in `ExamModeClient`, così la rotazione dello schermo non riavvia il tentativo;
  [`useAttemptResults.ts`](../../apps/web/src/lib/useAttemptResults.ts) per la pagina risultati; le funzioni
  pure stanno in [`examAttemptLogic.ts`](../../apps/web/src/lib/examAttemptLogic.ts).
- **Contratto**: `SimulationSummaryDto` ha `openAttemptId` (tentativo in corso non scaduto) e
  `lastAttemptId` (ultimo consegnato o corretto; i tentativi scaduti contano come consegnati).

**Robustezza** (vale anche per il desktop):

- autosave fallito: il salvataggio torna in coda e l'uscita è bloccata con un errore;
- consegna con errore di rete: resta riprovabile, e a tempo scaduto viene ritentata ogni 5 s;
- timer calcolato dalla scadenza assoluta sul server, con flush del salvataggio su `visibilitychange`;
- la consegna attende il salvataggio in volo;
- `startOrResumeAttempt` è transazionale (`SELECT ... FOR UPDATE`), così due richieste concorrenti non
  creano due tentativi.

Verifica: e2e [`materia-simulazioni.mobile.spec.ts`](../../apps/web/e2e/materia-simulazioni.mobile.spec.ts)
(8 test), [`materia-simulazioni-desktop.spec.ts`](../../apps/web/e2e/materia-simulazioni-desktop.spec.ts)
(3 test; verifica che il desktop non cambi). Seed in
[`e2e/fixtures/simulazioni-seed.ts`](../../apps/web/e2e/fixtures/simulazioni-seed.ts): la correzione AI è
simulata scrivendo sul DB, perché il worker non gira negli e2e. Unit:
[`simulationMobile.test.ts`](../../apps/web/test/simulationMobile.test.ts),
[`examAttemptLogic.test.ts`](../../apps/web/test/examAttemptLogic.test.ts),
[`examPrep.test.ts`](../../apps/web/test/examPrep.test.ts).

Non ancora:

- foto del foglio: non implementata;
- verdetto "Sufficiente" sugli argomenti: non implementato;
- pill ×N sugli argomenti: il dato non è disponibile;
- lo stato "In generazione" è solo locale alla pagina, non persiste dopo il ricaricamento;
- slice 5-6 (Lacune/Piano, Sessione).

## Aggiornamento — vista mobile di Lacune e Piano, slice 5 (2026-10-15)

Sotto 768 px la tab Lacune passa a
[`apps/web/src/components/coverage-mobile/`](../../apps/web/src/components/coverage-mobile/), montata in
[`MobileTabContent.tsx`](../../apps/web/src/components/subject-mobile/MobileTabContent.tsx) al posto di
`CoveragePanel`. Il desktop resta invariato. Logica pura in
[`coverageMobile.ts`](../../apps/web/src/lib/coverageMobile.ts).

- **Da colmare per primo**: card in evidenza con l'argomento prioritario.
- **Filtri** Tutte / Deboli / Senza flashcard / Senza materiale, con conteggi.
- **Card argomento**: materiale, card, mastery, menzioni negli esami.
- **Azioni** verso flussi esistenti:
  - Carica materiale (`?tab=materiale`);
  - Genera flashcard (sheet con stima, scope sull'argomento);
  - Ripassa le card (`/ripasso?materia=&argomento=`);
  - Fai un drill: apre il `GenerateSheet` della slice 4 con l'argomento preselezionato tramite la nuova
    prop `initialTopicId` ([`GenerateSheet.tsx`](../../apps/web/src/components/simulation-mobile/GenerateSheet.tsx)).
- **Temi d'esame senza argomento**: disclosure separata.

Il Piano mobile è descritto in [F6](F6-planner-calendario.md) ("vista mobile del piano").

Test: unit [`coverageMobile.test.ts`](../../apps/web/test/coverageMobile.test.ts); e2e
[`materia-lacune-piano.mobile.spec.ts`](../../apps/web/e2e/materia-lacune-piano.mobile.spec.ts) e
[`materia-lacune-piano-desktop.spec.ts`](../../apps/web/e2e/materia-lacune-piano-desktop.spec.ts), con seed in
[`e2e/fixtures/lacune-piano-seed.ts`](../../apps/web/e2e/fixtures/lacune-piano-seed.ts).
`materia.mobile.spec.ts` ora usa `/review` come sottorotta con header globale.

Non ancora: ritmo e minuti del piano modificabili da mobile (si cambiano rigenerando la bozza); il fallimento del worker durante la generazione non è rilevabile (spinner fino a
60 s, come su desktop).

## Aggiornamento — vista mobile di `/materie/[slug]/sessione/[sessionId]`, slice 6 (2026-10-15)

Con questa slice il flusso materia mobile è completo (slice 1–6). Le voci "Sessione" nelle sezioni delle slice 1–5 sono
chiuse qui. Sotto 768 px la pagina di sessione monta
[`SessionMobile`](../../apps/web/src/components/session-mobile/) al posto di `SessionDesktop`; il desktop non cambia.
Logica pura in [`sessionMobile.ts`](../../apps/web/src/lib/sessionMobile.ts), fetcher in
[`sessionApi.ts`](../../apps/web/src/lib/sessionApi.ts).

- **Sessione**: header con indietro alla materia e tipo di task; striscia timer pomodoro; tab "Punti chiave ed esercizi" /
  "Chiedi all'AI"; punti chiave con fonti in sheet; esercizi con risposta, correzione AI, soluzione, autovalutazione;
  sheet Argomenti per le sessioni senza documenti; conferma prima di "Termina".
- **Chiusura**: minuti di studio, giusti / da rivedere, flashcard dai punti chiave, drill con gli esercizi sbagliati che
  hanno una fonte, "Alla materia", "Prossima task".
- **Shell**: [`AppShell.tsx`](../../apps/web/src/components/AppShell.tsx) nasconde l'header globale anche su `/sessione/[id]`.
- Test: e2e [`materia-sessione.mobile.spec.ts`](../../apps/web/e2e/materia-sessione.mobile.spec.ts) e
  [`materia-sessione-desktop.spec.ts`](../../apps/web/e2e/materia-sessione-desktop.spec.ts), seed in
  [`e2e/fixtures/sessione-seed.ts`](../../apps/web/e2e/fixtures/sessione-seed.ts); unit
  [`sessionMobile.test.ts`](../../apps/web/test/sessionMobile.test.ts). Con `AI_PROVIDER=fake` correzione, chat, flashcard
  e drill girano in-process.

Non ancora (mobile):

- mood "Com'è andata?" e selezione per-item delle flashcard (chiusi in slice B), modalità Libero / Salta e durate del timer, viewer del
  documento dentro la sessione. Selettore del modello della chat e trascrizione nella chiusura: fatti in slice A.

## Aggiornamento — residui mobile, slice A (2026-10-16)

Rifiniture della vista mobile della materia. Il desktop non cambia. Spec e piano in `.claude/work/materia-mobile-residui/`
(non versionati).

- **Sheet Azioni** ([`AssistantSheet.tsx`](../../apps/web/src/components/subject-mobile/AssistantSheet.tsx)): argomenti
  selezionabili, che restringono lo scope `topicIds` di generazione e stima. Se ci sono documenti selezionati, vincono:
  compaiono un avviso e una pill per toglierli.
- **Flashcard**: scadenza per riga ("oggi", "domani", "tra N g", "—") da `FlashcardDto.dueAt`, con il giorno UTC del
  server ([`flashcardMobile.ts`](../../apps/web/src/lib/flashcardMobile.ts), `formatCardDue`).
- **Esame**: "Salvato · HH:MM" nell'header, con l'ora dell'ultimo salvataggio riuscito
  ([`useExamAttempt.ts`](../../apps/web/src/lib/useExamAttempt.ts)).
- **Righe simulazione** ([`SimulationRow.tsx`](../../apps/web/src/components/simulation-mobile/SimulationRow.tsx)):
  "Corretta · ieri", "Corretta · 5 giorni fa" da `lastGradedAt`; punteggio dell'ultimo tentativo corretto.
- **Lacune** ([`TopicAction.tsx`](../../apps/web/src/components/coverage-mobile/TopicAction.tsx)): "Ripassa N card" per
  argomento da `ReviewOverviewTopicDto.due`. Con 0 card l'azione non c'è e la card dice "Niente da ripassare oggi.".
- **Piano**: kebab "Azioni della materia" nell'header, che apre lo sheet Azioni
  ([`AssistantHost.tsx`](../../apps/web/src/components/subject-mobile/AssistantHost.tsx)). La selezione è locale alla pagina Piano.
- **Chat sessione** ([`ChatMobile.tsx`](../../apps/web/src/components/session-mobile/ChatMobile.tsx)): select del modello,
  con le opzioni del desktop.
- **Chiusura** ([`ClosingMobile.tsx`](../../apps/web/src/components/session-mobile/ClosingMobile.tsx)): disclosure
  "Trascrizione della chat", non mostrata se la sessione non ha messaggi.
- **Verifica** ([`VerifyMobile.tsx`](../../apps/web/src/components/document-mobile/VerifyMobile.tsx)): "Prossimo incerto"
  porta lo scroll e il focus sul blocco incerto o illeggibile successivo, in ciclo.
- **Documento** ([`DocumentActionsSheet.tsx`](../../apps/web/src/components/document-mobile/DocumentActionsSheet.tsx)):
  "Esporta .canvas" nel menu, solo se il documento ha un grafo.

Contratto ([`generation.ts`](../../packages/contracts/src/generation.ts), [`simulation.ts`](../../packages/contracts/src/simulation.ts)):

- `FlashcardDto.dueAt: string | null`: ISO, `null` per card nuove o sospese. Assente nel JSON (cache vecchia) = trattino.
- `SimulationSummaryDto.lastGradedAt: string | null`: data della correzione dell'ultimo tentativo corretto.
- `SimulationSummaryDto.lastScoreRatio` è ora il punteggio dell'ultimo tentativo corretto, non più il migliore.
  Il campo duplicato `lastAttemptScoreRatio` è stato rimosso.

Test: unit `formatCardDue`, `simulationSubtitle`, `dueAt` in `generation`/`review`, `lastGradedAt`; e2e
[`materia-residui.mobile.spec.ts`](../../apps/web/e2e/materia-residui.mobile.spec.ts) (12 test). Le asserzioni su "Salvato"
in [`materia-simulazioni.mobile.spec.ts`](../../apps/web/e2e/materia-simulazioni.mobile.spec.ts) ora accettano "Salvato · HH:MM".

Non ancora:

- foto del foglio, verdetto "Sufficiente" e conteggi ×N degli argomenti: fatti in slice E (vedi sotto);
- modalità Pomodoro / Libero della sessione e suggerimento AI del tipo di documento su mobile: fatti in slice E (vedi sotto);
- "Cerca" nell'header del Piano: omesso, non è nel design;
- non richiesti: "Chiedi" ed "Esercizi" nello sheet Azioni; modifica del ritmo del piano attivo da mobile.
  Mood, selezione per-item, confidenza e stima minuti: chiusi in slice B.

## Aggiornamento — residui mobile, slice E (2026-10-16)

Chiude i residui delle slice 4 e 6 rimasti aperti dopo la slice A. Il desktop cambia solo nel verdetto
dei Risultati e nelle etichette dei modelli. Piano e decisioni in `.claude/work/materia-mobile-residui-e/`
(non versionati).

- **Verdetto dei Risultati** (mobile e desktop): "Sufficiente" da 60% dei punti, "Insufficiente" sotto.
  Soglia fissa `PASS_RATIO` e `isPassing` in [`scoring.ts`](../../packages/core/src/scoring.ts); le costanti 0.6
  duplicate la importano, senza cambiare comportamento. Tentativo non ancora corretto: nessun verdetto.
- **Argomenti ricorrenti del profilo d'esame**: pill con il conteggio, "Integrali ×6" (profilo `exam_profile/v2`).
  I profili salvati con stringhe restano validi, senza ×.
- **Foto del foglio nell'esame mobile**: "Scatta foto" / "Scegli dalla galleria", max 4 per esercizio. Foto
  compresse nel browser prima dell'invio. Dettagli server e OCR in [F5](F5-esami-simulazioni.md).
- **Sessione mobile**: sheet Timer con modalità Pomodoro / Libero, "Salta al riposo" e durate, come il desktop
  ([`TimerStrip.tsx`](../../apps/web/src/components/session-mobile/TimerStrip.tsx)).
- **Materiale mobile**: chip "Suggerito: … · Applica / Ignora" quando il tipo suggerito è diverso da quello attuale.
- **Etichette modelli**: "(default)" sul modello realmente usato di default in ogni contesto
  ([`ModelPicker.tsx`](../../apps/web/src/components/ModelPicker.tsx), prop `defaultId`). Nessun default cambiato.

Non ancora:

- il costo OCR di una run di correzione fallita non entra nel budget della run riuscita;
- per rifare l'OCR di una foto con trascrizione fallita bisogna toglierla e ricaricarla;
- le foto sono solo nell'esame mobile; HEIC non è accettato dal server (solo dove il browser lo converte in JPEG/PNG).

## Aggiornamento — residui mobile, slice B (2026-10-16)

Chiude i residui delle slice 3 e 6 su mood, flashcard dai punti chiave, stima e confidenza. Piano e spec in
`.claude/work/materia-mobile-residui-b/` (non versionati).

- **Chiusura, "Com'è andata?"** ([`MoodPicker.tsx`](../../apps/web/src/components/session-mobile/MoodPicker.tsx)):
  Faticosa / Così così / Bene, salvataggio immediato; un secondo tap deseleziona. Colonna `study_sessions.mood`
  (`'hard' | 'ok' | 'good'`, nullable, migrazione [`0025_session_mood.sql`](../../packages/db/drizzle/0025_session_mood.sql)),
  `EndSessionRequest.mood?` in [`session.ts`](../../packages/contracts/src/session.ts). Route
  `PATCH /api/subjects/[slug]/sessions/[sessionId]/mood`: 409 su sessione attiva, 404, 400.
- **Chiusura, flashcard dai punti chiave** ([`ClosingMobile.tsx`](../../apps/web/src/components/session-mobile/ClosingMobile.tsx)):
  checkbox per punto, tutte selezionate di default, bottone "Crea N flashcard". `POST .../sessions/[sessionId]/flashcards`
  accetta `{ itemIds }` (1..200; id estranei → 400). Senza body il comportamento è quello di prima (usato dal desktop).
  Se il mazzo esiste già non vengono aggiunte card.
- **Ripasso, "~ N min"** ([`ReviewHeroCard.tsx`](../../apps/web/src/components/flashcard-mobile/ReviewHeroCard.tsx)):
  stima dalla media dei tempi di ripasso, in [`reviewEstimate.ts`](../../packages/core/src/reviewEstimate.ts). Dettagli in
  [docs/09](../09-ripasso-mobile.md) §"Residui mobile, slice B".
- **Ripasso, "Quanto sei sicuro?"** ([`QuickReviewSession.tsx`](../../apps/web/src/components/quick-review/QuickReviewSession.tsx)):
  Non lo so / Forse / Lo so, inviata nel grade. Vale anche su desktop, dove `/ripasso` è lo stesso componente.

Non ancora:

- il per-item vale solo per la Chiusura mobile; il desktop continua a creare le flashcard di tutti i punti chiave;
- con meno di 10 review con tempo registrato la stima usa il default di 20 s per card.
