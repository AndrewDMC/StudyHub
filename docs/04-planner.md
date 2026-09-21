# Il Planner — specifica funzionale

Il Planner è il cuore del prodotto. Non è "l'AI che scrive una lista": è un **solver vincolato**
in cui l'AI fa solo le due cose che sa fare meglio di un algoritmo.

## 1. Architettura ibrida (scelta chiave)

```
[AI]  Fase A — Analisi          →  [ALGO] Fase B — Scheduling  →  [AI] Fase C — Narrazione
 stima difficoltà/carico             allocazione giorni,            titoli e descrizioni
 dipendenze tra argomenti            FSRS, vincoli, interleaving    delle task, note di metodo
 peso d'esame per argomento          (deterministico, ri-eseguibile)
```

Perché: un LLM non sa fare aritmetica di calendario in modo affidabile né rispettare vincoli duri.
Un algoritmo non sa stimare "questo capitolo è concettualmente più duro". Si usano entrambi per ciò che valgono.
**Conseguenza pratica**: se sposti una task, il re-schedule è istantaneo e gratuito (nessuna chiamata LLM).

## 2. Input

```ts
{
  subjectId, examId, targetDate,
  availability: { perWeekday: {mon: 180, …}, blackoutDates: [], slots: ['morning','evening'] },
  materials: { docIds[], coverage: 'tutto' | topicIds[] },
  currentState: { masteryPerTopic, dueCards, completedTasks },
  prefs: { sessionLength: 50, breakLength: 10,
           intensity: 'sostenibile'|'standard'|'sprint',
           simulationCount: 'auto' }
}
```

## 3. Fase A — Analisi AI (1 chiamata, opus)
Output strutturato per ogni argomento:
`{ topicId, estimatedHours, conceptualDifficulty 1..5, examWeight 0..1, prerequisites[], suggestedMethods[] }`
+ `overallAssessment: { feasible: boolean, shortfallHours, recommendation }`.

**Se il tempo non basta, il Planner lo dice subito e propone tre strategie**
(copertura completa superficiale / focus sull'80% del peso d'esame / estensione della data).
Un planner che promette l'impossibile è peggio di nessun planner.

## 4. Fase B — Scheduling deterministico

Vincoli **duri**:
- mai superare i minuti disponibili del giorno; rispettare blackout;
- un argomento non inizia prima dei suoi prerequisiti;
- le card in scadenza (FSRS) hanno precedenza assoluta (il debito di ripasso non si rimanda);
- ultimi 2 giorni: **solo** ripasso e simulazione leggera, nessun contenuto nuovo.

Vincoli **morbidi** (funzione obiettivo, pesi esposti in `plan.params`):
- massimizzare `retrievability` media attesa alla `targetDate` (metrica primaria);
- interleaving: max 2 argomenti nuovi/giorno, alternanza argomenti "duri"/"facili";
- distanziamento: ogni argomento rivisto ≥3 volte a intervalli crescenti;
- simulazioni a ~60%, ~85% e ~95% del percorso; la prima *deve* arrivare presto (calibra l'autovalutazione);
- carico crescente poi calante (taper degli ultimi giorni, come un atleta prima della gara).

Backtracking greedy + local search; tempo di calcolo target < 500 ms.

## 5. Fase C — Materializzazione
Genera `tasks` con `kind`, `est_minutes`, `payload` **eseguibile**:
una task non dice "studia termodinamica", dice
*"Leggi Appunti cap. 4 pp. 51–68 (35 min) → genera 20 flashcard → ripassale"*, con i deep-link ai documenti
e il bottone che lancia direttamente il job o la sessione di ripasso. **Ogni task è azionabile in un click.**

## 6. Adattività (ciò che rende il piano vivo)
Ricalcolo automatico quando:
- salti ≥2 giorni o ≥30% delle task settimanali;
- una simulazione va sotto la soglia attesa → riallocazione verso gli argomenti deboli;
- aggiungi materiale nuovo a metà percorso;
- sposti la data d'esame.

Il ricalcolo **non cancella la storia**: il piano vecchio diventa `superseded`, con un diff visibile
("+2 sessioni su Elettromagnetismo, −1 su Cinematica, perché: simulazione del 12/01 al 54%").
La trasparenza del *perché* è ciò che fa accettare un piano.

## 7. Multi-materia
Con più esami nella stessa finestra, il Planner gira a livello globale:
i minuti del giorno sono una risorsa condivisa, allocata proporzionalmente a
`(peso esame × urgenza × gap di mastery)`. Conflitti mostrati esplicitamente in Calendario.

## 8. Anti-obiettivi
- Non gamifichiamo (niente streak punitive, badge, coriandoli). Lo strumento non deve competere per la tua attenzione.
- Non pianifichiamo oltre la sostenibilità: l'intensità `sprint` avvisa quando prevede >6h/giorno per >5 giorni.
- Nessuna notifica push di default.

---

## 9. Approvazione e materializzazione (il piano è una proposta finché non lo confermi)

Applicazione diretta del principio P2. Il Planner **non scrive mai** direttamente nel calendario.

### 9.1 Macchina a stati

```
job "plan"                 revisione utente            commit (transazione)
   │                            │                           │
   ▼                            ▼                           ▼
study_plans.status=draft → modifiche in bozza → status=active + tasks.status=todo
tasks.status=proposed                            + eventi calendario materializzati
(invisibili in Dashboard,                        + feed ICS aggiornato
 Calendario e Daily Task)                        + piano precedente -> superseded
```

Un task `proposed` non esiste per il resto del sistema: non compare in Dashboard, non entra nel conteggio
del carico giornaliero, non genera notifiche. Esiste solo dentro la schermata di revisione.

### 9.2 Schermata "Revisione piano"
Lista delle task raggruppate per giorno/settimana, tutte editabili prima del commit:
- modifica titolo, descrizione, durata stimata, tipo, argomento, materiale collegato;
- sposta di giorno (drag) o di fascia oraria;
- elimina una task, **aggiungi una task manuale** (non tutto nasce dall'AI);
- `pin` su una task che i ricalcoli futuri non devono spostare;
- azioni bulk: "sposta tutta la settimana di 2 giorni", "riduci del 20% il carico", "escludi questo argomento".

Sempre visibili durante l'editing, ricalcolati in tempo reale (Fase B, nessuna chiamata AI):
carico per giorno vs disponibilità, argomenti coperti, **verdetto di fattibilità aggiornato**.
Se le tue modifiche rendono il piano infattibile, lo vedi mentre lo modifichi, non dopo.

### 9.3 Commit
Una singola transazione DB, idempotente sulla `planId`:
1. `study_plans.status = active` (l'eventuale piano attivo precedente passa a `superseded`);
2. `tasks.status: proposed -> todo`, con `starts_at`/`ends_at` calcolati per le task assegnate a una fascia;
3. scrittura di `plans/<planId>.json` nella cartella della materia (P1: la verità resta su disco);
4. invalidazione del feed ICS.

Il commit fallisce in blocco o riesce in blocco. Nessuno stato intermedio in cui metà piano è nel calendario.

### 9.4 Tasks come eventi — decisione architetturale
**Le task *sono* gli eventi di calendario.** Non esiste una tabella `calendar_events` parallela da tenere
sincronizzata con `tasks`: una task schedulata ha semplicemente `date` e, se assegnata a un orario,
`starts_at`/`ends_at`.

Una tabella `calendar_events` separata esiste **solo** per ciò che non è una task e non è prodotto dal Planner:
esami, lezioni, impegni importati da ICS esterno. Questi sono **vincoli** in ingresso per lo scheduler,
non suoi output.

Motivazione: duplicare task ed eventi in due tabelle da sincronizzare è la principale fonte di desincronizzazione
in questo tipo di applicazioni. Una task spostata e un evento rimasto indietro distruggono la fiducia nel calendario.

### 9.5 Ricalcolo: si approva il diff, non il piano
Un ricalcolo (vedi §6) genera un nuovo `draft` **confrontato con il piano attivo**. La UI mostra solo il delta:

```
+  2 sessioni  Elettromagnetismo   (mar 14, gio 16)     motivo: simulazione del 12/01 al 54%
-  1 sessione  Cinematica          (mer 15)             motivo: mastery 0.87, sopra soglia
~  Simulazione 2 spostata          20/01 -> 22/01       motivo: 3 giorni saltati
=  17 task invariate
```

Approvi il diff (in blocco o voce per voce), non 40 task da rileggere da capo. Le task `pin` non compaiono
mai nel diff. Ogni riga porta il **motivo**: senza il perché, dopo tre ricalcoli si clicca "conferma" a occhi
chiusi e il piano smette di essere uno strumento.

### 9.6 Criteri di accettazione aggiuntivi
- [ ] Un piano `draft` non produce alcun effetto visibile fuori dalla schermata di revisione.
- [ ] Modifico 5 task in bozza, chiudo il browser, riapro: la bozza è intatta.
- [ ] Il commit di un piano da 40 task crea 40 task e 40 voci ICS in una transazione.
- [ ] Rilancio lo stesso commit: nessun duplicato (idempotenza su `planId`).
- [ ] Un ricalcolo mostra un diff leggibile con il motivo per ogni riga e rispetta le task `pin`.
- [ ] Rifiuto il diff: il piano attivo resta identico, il draft viene scartato.
