# F8 — Estensioni

## Obiettivo

`docs/06-miglioramenti.md` è un elenco ordinato per valore/costo, non un piano. F8 ne prende **una
fetta per volta**, mai tutto: questa KB dice quali estensioni sono state fatte, con quale criterio
sono state scelte, e cosa resta volutamente fuori.

## Criterio di scelta

Si parte dal Tier 1 e, dentro il Tier 1, da ciò che:

1. **non richiede un modello** (gratis, istantaneo, testabile con dati fissati — come la Fase B del Planner);
2. **usa dati che l'app già raccoglie** (nessuna nuova fonte di ingest);
3. **non allarga la superficie di rischio** (niente multi-utente, niente rete, niente audio).

Per questo la prima fetta è **#2 Gap Analysis** e **#4 Confidence calibration**. Restano fuori #1
(già in F5), #3 (serve un modello che interroghi e un flusso vocale), #5 (nuovi ingest: YouTube, web,
Whisper).

## Stato: prima fetta (2026-09-29)

### #2 — Gap Analysis / Coverage Map (scheda "Lacune")

`packages/core/src/coverage.ts` (pura) + `apps/web/src/lib/coverage.ts` (query) +
`GET /api/subjects/:slug/coverage` + `CoveragePanel`. Incrocia, per ogni argomento della materia:
materiale collegato (documenti e pagine, esclusi gli esami), flashcard, mastery e **in quanti esami
passati compare**. Produce frasi come _"Non hai materiale su 'Trasformata di Laplace', che compare
in 4 esami su 5."_, ordinate per `frequenza negli esami × gravità` (senza materiale 3 · senza card 2 ·
debole 1).

Decisioni e limiti — da leggere prima di fidarsi dei numeri:

- **Il match con gli esami è testuale, non semantico.** Un argomento "compare" in un esame se tutte le
  sue parole di ≥4 lettere (accorciate di due, così _trasformata/trasformate_ coincidono) sono nel
  testo. Sottostima un argomento chiamato in modo diverso dall'esame; può sovrastimare un nome molto
  generico. La UI lo dice: è un indizio, non un verdetto. Un match per embedding sarebbe più robusto ma
  costa una chiamata per (argomento × esame) e non è deterministico: non ne valeva ancora la pena.
- **Solo documenti `parsed`.** Un esame ancora in estrazione non ha testo: contarlo diluirebbe ogni
  frequenza ("2 su 5" quando 3 su 5 non sono cercabili).
- **Temi che ricorrono ma non sono argomenti.** I `recurringTopics` del profilo d'esame (F5) senza un
  argomento corrispondente compaiono a parte, con quanti documenti dell'utente ne parlano (0 = il
  materiale non lo copre): è il caso "Laplace non è nemmeno nel programma" che la sola tabella per
  argomento non mostrerebbe mai.
- Un argomento senza alcuna evidenza d'esame pesa 0,25 invece di 0: può contare, ma meno di uno che
  gli esami ripetono. Un argomento senza lacune ha priorità 0, quanto spesso lo chiedano gli esami.

Test: `packages/core/test/coverage.test.ts` (13: normalizzazione, plurali, parola dentro un'altra,
frequenza "4 su 5", i tre flag, ordinamento, temi non mappati, vuoto) e
`apps/web/test/coverage.test.ts` (6, con dati reali su pglite: 4 esami su 5, materiale/pagine/card,
documenti non pronti esclusi, un esame non è materiale di studio, temi del profilo, isolamento fra materie).

### #4 — Confidence calibration

Prima di girare una carta l'utente dichiara **1 non lo so · 2 forse · 3 lo so**; il ripasso poi dice se
aveva ragione. `reviews.confidence` (migrazione `0015_review_confidence.sql`, con `CHECK` 1..3 nel DB,
non solo nel form). In sessione i tasti **1-3 prima del flip dichiarano e girano in un colpo solo** —
zero tasti in più — mentre **Space** gira senza dichiarare (`null`, mai un default inventato: un
valore di comodo falserebbe proprio la statistica che si vuole misurare). Nelle Statistiche della
scheda Flashcard compare il pannello "Calibrazione della fiducia".

- **"Corretta" = non è stata un _Again_.** FSRS tratta _Hard_ come una risposta passata; solo _Again_
  è un lapse. È una scelta, dichiarata in `isCorrectRating`.
- **Aspettativa per livello**: i punti medi dei terzi (1 → 17%, 2 → 50%, 3 → 83%). `bias` = accuratezza
  attesa − effettiva: > 0 sopravvaluti, < 0 sottovaluti, entro ±10 punti "calibrato".
- **Niente conclusioni da pochi dati.** Sotto 5 risposte per livello i numeri si mostrano con un
  asterisco ma non producono frasi; sotto 10 risposte in tutto il verdetto è `insufficient_data`.
- **"Dove ti illudi di più"**: gli argomenti con almeno 5 risposte "lo so" e almeno una sbagliata,
  ordinati per quota di errori.

Test: `packages/core/test/calibration.test.ts` (11), `apps/web/test/calibration.test.ts` (6, incluso il
rifiuto di `confidence = 4` da parte del database e l'isolamento fra materie).

**Non fatto** in questa fetta: la fiducia non è chiesta negli esercizi delle simulazioni (solo nelle
carte), quindi la calibrazione non vede l'accuratezza sugli esercizi aperti; e non c'è ancora un
segnale verso il Planner (un argomento in cui ti illudi non fa aumentare le sue task di ripasso).

## Ancora da fare (Tier 1–3 di `docs/06-miglioramenti.md`)

Ordine suggerito per la prossima fetta, sempre con il criterio sopra:

1. **#8 Question Bank incrementale** — gli esercizi sbagliati in simulazione rientrano nei drill
   (dati già presenti in `attempt_item_results`; costo AI zero). _Fatto solo per gli esercizi della sessione di studio_
   (docs/08 fase 4); per le simulazioni d'esame resta da fare.
2. **#7 Timer e telemetria di sessione** — _fatto_ con la sessione di studio (docs/08, fase 4): mediana reale/pianificato
   applicata a `generate_plan` e all'anteprima. Resta un solo numero per persona, non per tipo di task.
3. **#9 Ricerca semantica con risposta citata** — l'infrastruttura c'è (F1); serve la parte RAG e la UI.
4. **#6, #10, #5, #3, #11–#14**: costo medio/alto o nuove superfici (audio, rete, mobile, multi-utente).

Le sezioni "Aggiunte trasversali" di `06-miglioramenti.md` già coperte altrove: cost meter e budget
(F3/F7), undo con `.trash/` (F0), `schemaVersion` sui file JSON (F0). **Non fatti**: health check della
materia (semaforo) e changelog dei piani leggibile oltre il diff di ricalcolo di F6.
