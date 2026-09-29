# F4 — Flashcard & Ripasso

## Obiettivo

Le card generate diventano un sistema di ripasso serio, con FSRS e statistiche che alimentano il Planner.

## Scope

- Integrazione `ts-fsrs`: stato per card, scheduling, `retrievability(t)`.
- **Modalità Review**: full-screen, zero cromo, tastiera (`Space` rivela, `1–4` valuta, `E` modifica,
  `S` sospendi, `F` apri fonte). Supporto cloze, formule KaTeX, immagini.
- Coda giornaliera con cap configurabile e mix new/review; modalità "solo argomento X" per lo studio mirato.
- Statistiche: card per stato, forecast dei prossimi 30 giorni, heatmap mastery per argomento,
  curva di ritenzione reale vs prevista, **"card a rischio per la data d'esame"** (la metrica che serve al Planner).
- Editor deck: crea/modifica/sposta/elimina card, merge di deck, tag.
- Export/import **Anki `.apkg`** (bidirezionale) e CSV.

## Decisioni

- **FSRS, non SM-2** — vedi `docs/02-filesystem-e-dati.md §4`. Il Planner ha bisogno di `retrievability`, SM-2 non la espone.
- **Ogni review è registrata** (rating + tempo di risposta): dataset per l'ottimizzazione dei parametri FSRS
  e segnale di difficoltà reale per il Planner.
- Le card restano legate al `topicId`: senza quel legame, mastery e piano non funzionano.

## Criteri di accettazione

- [x] 200 card in coda: la sessione scorre senza lag percepibile, nessun mouse necessario. (Misurato
      il 2026-09-28: coda di 204 card, 60 valutate solo da tastiera, `Space`+`3` → mediana 71 ms per
      card, p95 102 ms, contro un dev server Next su Postgres reale; dominata dal round-trip della
      `POST`, non dal rendering. Un picco isolato di 1,1 s, molto probabilmente la compilazione a
      freddo della route in dev. **Non** misurato su una build di produzione.)
- [x] Chiudo il browser a metà sessione: le risposte già date sono salvate. (Per costruzione: ogni
      valutazione è una `POST` separata. Non provato chiudendo davvero il browser.)
- [x] Export su Anki e reimport: nessuna perdita di stato di scheduling. (Verificato **contro il
      nostro stesso lettore**: `.apkg` esportato → reimportato in un'altra materia conserva
      stabilità, difficoltà, scadenza, ultima revisione, reps, lapses, stato e sospensione, al
      millisecondo — `apps/web/test/deckExchange.test.ts`. **Mai aperto in Anki desktop**: vedi
      "Aggiornamento — editor deck, `.apkg`…" per cosa non è verificato.)
- [x] Il forecast a 30 giorni combacia con lo scheduling effettivo (test deterministico con clock
      fissato). (`packages/core/test/forecast.test.ts`: 60 card prime-riviste a ore diverse con
      rating 1-4, ogni card deve cadere nel giorno in cui `isDue` la dà per la prima volta scaduta.)
- [x] Sospendo una card: sparisce dalla coda ma resta nel deck.

## Rischi

- Card di bassa qualità generate in massa = ripasso inutile. Mitigazione: la Review Queue di F3 è obbligatoria,
  e nella sessione esiste "segnala card scadente" → esclusa + raccolta per migliorare il prompt.

## Stato: F4 completa (aggiornato 2026-09-28)

FSRS-5 non è simulato: `ts-fsrs` gira per davvero (nessuna dipendenza da AI o rete). 230 test nel
monorepo dopo questa fase.

Cosa c'è, con test reali:

- **`packages/core/src/fsrs.ts`**: wrapper su `ts-fsrs` (`scheduleReview`, `retrievability`, `isDue`)
  dietro tipi propri — nessun altro modulo importa `ts-fsrs` direttamente. Testato per determinismo,
  progressione degli stati (`new → learning/review → relearning` su "Again"), decadimento della
  retrievability nel tempo.
- **`packages/core/src/forecast.ts`**: `forecastDueCounts` (30 giorni, bucket per giorno solare in
  UTC) e `cardsAtRiskForExam` (retrievability proiettata alla data d'esame). **Bug reale trovato dal
  proprio test suite e corretto in questa sessione**: il bucketing mescolava `Date` in ora locale
  (`setHours`) con chiavi in UTC (`toISOString()`), spostando di un giorno la card "di oggi" su
  qualunque macchina non a UTC+0 — ora tutto in UTC. Promemoria per le fasi successive (Planner, F6):
  qualunque bucketing per data va fatto in un solo fuso orario dall'inizio alla fine.
- **Coda giornaliera** (`GET .../review/queue`, `apps/web/src/lib/review.ts`): mix new/review con
  `cap`/`newLimit` configurabili, filtro `topicId`, esclude le card sospese.
  Correzione = criterio F4: una card "Easy" appena creata esce subito dalla coda odierna.
- **Sessione di ripasso reale**: `/materie/[slug]/review` a schermo intero — `Space` rivela,
  `1-4` valuta, `S` sospende. Ogni valutazione è una richiesta separata (`POST .../review/:cardId`)
  che aggiorna subito lo schedule e scrive una riga `reviews`: chiudere il browser a metà sessione
  non perde le risposte già date (criterio di accettazione soddisfatto per costruzione, non testato
  in browser reale — richiederebbe Postgres, non disponibile qui).
- **Statistiche**: conteggio per stato, forecast 30 giorni, "card a rischio" per il prossimo esame
  programmato (riusa `exams` di F2) — tutto in `StatsPanel.tsx` sulla pagina materia.

**Non implementato in quella slice** (elenco storico del 2026-09-22 — quasi tutto è stato colmato il
2026-09-28, vedi l'ultimo "Aggiornamento"):

- ~~Editor deck~~ → fatto. ~~Export/import `.apkg`~~ → fatto (import/export CSV e `.apkg`).
- ~~KaTeX/immagini nella sessione di ripasso~~ → fatto (immagini solo da URL consentiti, vedi sotto).
- ~~Test "forecast combacia con lo scheduling effettivo"~~ → fatto.
- **Ancora non implementato**: `subject.profile` (stem/umanistica/...) per varianti di prompt — F3
  usa un unico prompt per materia.

## Aggiornamento — `topics.mastery` ricalcolata a ogni review (2026-09-24)

`apps/web/src/lib/review.ts::submitReview` ora chiama `recomputeTopicMastery` (spostata da
`apps/worker` a `@studyhub/db/src/mastery.ts`, condivisa con F5 — vedi anche `docs/fasi/F5
-esami-simulazioni.md` "Stato") ogni volta che una card con `topicId` viene valutata, non solo dopo
la correzione di una simulazione. La formula (`packages/core/src/mastery.ts`) resta
`0.5·retrievability + 0.3·accuratezza simulazioni + 0.2·copertura` coi pesi rinormalizzati sulle sole
componenti con dati: una materia con solo flashcard (nessuna simulazione ancora fatta) ottiene comunque
un valore, pesato 100% su retrievability, invece di restare `null` in attesa di F5. 3 test nuovi in
`packages/db/test/mastery.test.ts` (nessun dato → null, combinazione review+simulazione coi pesi
rinormalizzati, card sospese/nuove ignorate) + 2 in `apps/web/test/review.test.ts` (submitReview
aggiorna mastery del topic taggato, non tocca nulla se la card non è taggata).

La copertura del materiale letto (l'ultima delle tre componenti) è stata implementata lo stesso
giorno — vedi "Aggiornamento — copertura del materiale letto" qui sotto.

## Aggiornamento — copertura del materiale letto, formula completa (2026-09-24)

La formula di mastery aveva ancora una componente sempre assente: la copertura. Ora
`packages/db/src/mastery.ts::recomputeTopicMastery` la calcola davvero — vedi
`docs/fasi/F6-planner-calendario.md` "Stato" per come i task "read" del Planner alimentano il dato.
Le tre componenti sono ora tutte reali; la formula resta `null` solo per un argomento senza alcun
dato in nessuna delle tre (nessuna card, nessuna simulazione, nessun materiale taggato).

## Aggiornamento — export CSV di un mazzo (2026-09-26)

Metà dello scope "Export/import Anki `.apkg`... e CSV": l'export CSV, non l'`.apkg`. `buildCsv`
(`packages/core/src/csv.ts`) è uno scrittore RFC 4180 minimale (stesso stile di `ics.ts` di F6:
zero dipendenze, quoting solo quando serve, `\r\n`) — testato contro la spec
(`packages/core/test/csv.test.ts`, 6 casi). `exportDeckCsv`
(`apps/web/src/lib/generation.ts`) scrive `front,back,type,hint`, una riga per card, nome file
dal titolo del mazzo. Esposto come `GET /api/subjects/[slug]/artifacts/[artifactId]/export.csv`
(`text/csv`, non JSON) e come link "Esporta CSV" nella pagina di revisione del mazzo.

**Dichiaratamente non** quello che il criterio di accettazione "Export su Anki e reimport: nessuna
perdita di stato di scheduling" chiede alla lettera: è testo semplice (front/back/type/hint),
importabile nel CSV importer di Anki ma **solo in una direzione** — una volta importato, è lo
scheduler di Anki (ease/interval, non FSRS) a gestire quella card, non StudyHub. Un vero
round-trip che preservi lo stato FSRS richiederebbe scrivere/leggere il formato `.apkg` reale
(SQLite zippato, schema note/card proprio di Anki) — scope a parte, non iniziato, più grande di
quanto valesse la pena affrontare in questa sessione insieme al resto. (Poi fatto: vedi
"Aggiornamento — editor deck, `.apkg`…".)

## Aggiornamento — editor deck, `.apkg`, review completa, statistiche (2026-09-28)

Chiude lo scope F4. Tutto con test reali (`pnpm -r test`: 678 verdi) e verificato dal vivo su Postgres
reale + server Next (migrazioni `0013`/`0014` applicate a pgvector/pg16, non solo pglite).

**Schema** (`0014_flashcard_editor_columns`): `flashcards.tags text[]`, `flashcards.flagged_at`,
e `flashcards.source_ref` ora **nullable** — una card scritta a mano non ha nulla da citare, e un
`sourceRef` finto (`docId` inventato) avrebbe contaminato ogni consumatore. `FlashcardDto.sourceRef`
è `| null` di conseguenza; la sessione di ripasso e la review queue di F3 nascondono la citazione
quando manca.

**Sessione di ripasso** (`ReviewSessionClient.tsx`): `E` modifica il testo sul posto (lo scheduling
non si tocca: correggere un refuso non deve azzerare la memoria della card; l'embedding invece sì,
perché calcolato sul vecchio `front`), `F` apre la fonte alla pagina citata (`…/file#page=N`, il
viewer PDF del browser), `X` = **"segnala card scadente"** (`flagged_at`: fuori dalla coda e da ogni
conteggio/forecast, resta nel deck, filtro "Segnalate" per raccoglierle). `?cap=&newLimit=` dimensiona
la coda (prima configurabile solo chiamando l'API a mano). La coda è uno snapshot con
`staleTime: Infinity`: un refetch in background farebbe slittare l'indice e salterebbe/ripeterebbe
una card. I tasti `1-4` accettano sia il carattere digitato sia la posizione fisica (`Digit`/
`Numpad`), perché solo `e.code` non funziona con tastierino numerico ed eventi sintetici.
Cloze, KaTeX, immagini: `renderCardHtml` (`apps/web/src/lib/cardText.ts`) — l'intero testo è
HTML-escaped **prima**, poi si riemettono solo `$…$`/`$$…$$` (KaTeX, `trust: false`, errori → sorgente
grezzo), `{{c1::x::hint}}` e il `{{...}}` del generatore F3, `![alt](url)` **solo** per `/api/…`,
`http(s)://`, `data:image/(png|jpeg|gif|webp)` (12 test, incluso un URL che tenta di uscire
dall'attributo). Una cloze in sintassi Anki, alla rivelazione, mostra il **fronte con le risposte
evidenziate** (`revealPlan`); il retro compare solo se aggiunge qualcosa.

**Editor deck** (`FlashcardListPanel` + `DeckToolsPanel`, `apps/web/src/lib/deckEditor.ts`): crea card
a mano (in un "mazzo manuale" creato al volo, `approved` subito: nessuna bozza per ciò che scrivi tu),
modifica inline, sposta fra mazzi, elimina, assegna argomento, **tag** (normalizzati minuscoli, senza
duplicati), azioni **in blocco** su selezione (sospendi, sposta, argomento, ±tag, elimina — limitate
alla materia: gli id di altre materie sono ignorati, non un errore), **unione di mazzi** (le card si
spostano con lo stato intatto, il mazzo sorgente sparisce; **rifiutata se uno dei due è in bozza**,
perché approverebbe di nascosto card mai riviste). Filtri: testo (i `%`/`_` sono letterali),
argomento, mazzo, stato, tag, segnalate. Spostare/eliminare/riassegnare ricalcola la `mastery` degli
argomenti toccati.

**Import/export**: CSV ora bidirezionale (`parseCsv` in core, l'inverso di `buildCsv`; colonne per
nome o `front,back[,tags]` senza intestazione; delimitatore autodetect virgola/`;`/tab). Export CSV
aggiunge la colonna `tags`. **`.apkg`** (`apps/web/src/lib/anki.ts`, puro: byte dentro/fuori):
zip (`fflate`) + collezione SQLite schema-11 scritta/letta con `node:sqlite` (nessuna dipendenza
nativa; caricato via `process.getBuiltinModule` perché il bundler non lo risolve; in Docker serve
Node ≥ 22.13, dove `node:sqlite` non richiede più flag — `node:22-bookworm-slim` segue l’ultima 22.x, ma non l’ho verificato nell’immagine costruita). Lo scheduling è scritto **due volte**:
nei campi Anki (`type/queue/due/ivl/factor`, l'equivalente SM-2 più vicino, così Anki mostra scadenze
sensate) e, esatto, nella colonna `data` della card (`s`/`d` = memory state FSRS di Anki, più un
oggetto `studyhub` lossless). Il reimport di un nostro export ripristina lo stato verbatim; un file di
Anki puro viene **approssimato**: stabilità ≈ intervallo, difficoltà dal fattore di ease, scadenza dal
contatore giorni della collezione — un seme sensato, non una conversione esatta. Matematica: `$…$` ↔
`\(…\)`. Cloze del generatore (`{{...}}` + frase piena nel retro) → `{{c1::risposta}}` ricostruita
per differenza; se non combacia, esce come card normale. Tutti i blank di una cloze escono come `c1`
(il nostro renderer li nasconde insieme, Anki solo il numero della card chiesta). Import: duplicati
(stesso fronte+retro in qualunque mazzo della materia) saltati, quindi reimportare lo stesso file è
innocuo; max 10 000 card e 50 MB; `.apkg` nel formato nuovo compresso (`anki21b`) rifiutato con
istruzione per riesportare in modalità compatibile.

**Non verificato / limiti dichiarati**:

- **Mai aperto in Anki desktop né AnkiDroid.** Il `.apkg` rispetta lo schema legacy che conosco e il
  round trip col nostro lettore è esatto, ma non ho visto Anki accettarlo. In particolare: il campo
  `data` con chiavi non standard (`studyhub`) è un'assunzione ragionevole ma non provata sul
  parser di Anki; se lo rifiutasse, l'import fallirebbe e andrebbe tolto (perdendo il lossless,
  restando `s`/`d`).
- **Immagini/media**: l'export non le include; l'import le sostituisce con `[immagine: nome]`
  (segnalato come warning), non le scarta in silenzio. Nessuno store media.
- **Cronologia (`revlog`)** non esportata né importata: solo lo stato corrente delle card.
- Note Anki con più template ("Basic and reversed") → una card StudyHub per card Anki (`ord`),
  col fronte scelto dal template; modelli esotici possono sceglierlo male.
- Una cloze Anki con `c1`+`c2` viene importata come **due card** (ognuna nasconde un numero); la
  nostra ne esporta una sola con tutto nascosto. Di conseguenza una cloze con numeri diversi da
  `c1` torna **rinumerata**: al primo giro export→reimport non risulta un duplicato esatto (fronte
  diverso) e viene importata di nuovo; da lì in poi è stabile.

**Statistiche** (`getFlashcardStats`, `StatsPanel`): forecast a 30 giorni **finalmente visualizzato**
(prima era calcolato ma mostrato solo come "Inizia (n)"), **heatmap mastery per argomento** (ogni cella
porta al ripasso mirato di quell'argomento), **ritenzione reale vs prevista**: `retentionCalibration`
(`packages/core/src/retention.ts`) raggruppa i ripassi per retrievability prevista al momento e
confronta col tasso reale di richiamo; il tempo trascorso viene dal log `reviews` stesso (`LAG` sulla
storia della card), non dallo stato corrente. Sotto 50 campioni il pannello dice che è indicativo. Le
card segnalate sono escluse da conteggi, forecast e rischio esame (`flaggedCount` a parte).

**Verifica dal vivo**: Postgres pgvector reale, dev server Next, browser. Provati con dati veri:
`E` (modifica salvata e persistita), voto `3` (card → `learning`), `X` (segnalata, sparita dalla coda),
cloze con blank e risposte evidenziate, KaTeX inline/display, creazione card da UI, export `.apkg`
(`PK`, `application/apkg`), reimport e import CSV in nuovo mazzo, 200 card importate. **Non provato**
in browser: azioni in blocco, unione mazzi, modifica inline nella lista, import `.apkg` dal form di
upload (solo via `fetch`); coperti dai test di libreria.
