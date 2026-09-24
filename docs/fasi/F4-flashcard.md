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

- [ ] 200 card in coda: la sessione scorre senza lag percepibile, nessun mouse necessario.
- [ ] Chiudo il browser a metà sessione: le risposte già date sono salvate.
- [ ] Export su Anki e reimport: nessuna perdita di stato di scheduling.
- [ ] Il forecast a 30 giorni combacia con lo scheduling effettivo (test deterministico con clock fissato).
- [ ] Sospendo una card: sparisce dalla coda ma resta nel deck.

## Rischi

- Card di bassa qualità generate in massa = ripasso inutile. Mitigazione: la Review Queue di F3 è obbligatoria,
  e nella sessione esiste "segnala card scadente" → esclusa + raccolta per migliorare il prompt.

## Stato: FSRS reale, editor/export deck non ancora (2026-09-22)

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

**Non implementato** in questa slice:

- **Editor deck** (crea/modifica/sposta/elimina card in blocco, merge di deck, tag): solo le
  operazioni singole già presenti (review-queue di F3 per pre-approvazione, sospensione qui).
- **Export/import Anki `.apkg`**: non iniziato — è un formato SQLite zippato, scope a parte non
  coperto in questa sessione. CSV più semplice ma anch'esso rimandato.
- **Test "forecast combacia con lo scheduling effettivo"**: coperto solo indirettamente
  (`forecastDueCounts` su uno schedule vero prodotto da `scheduleReview`, non un confronto a 30
  giorni con repliche multiple).
- **KaTeX/immagini nella sessione di ripasso**: il front/back sono renderizzati come testo semplice;
  formule LaTeX (previste per `generate_summary`/schema) non sono ancora renderizzate lato client.
- **`subject.profile` (stem/umanistica/...) per varianti di prompt**: non implementato — F3 usa un
  unico prompt per materia.

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
