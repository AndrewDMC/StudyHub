# F6 — Planner & Calendario

## Obiettivo
Da `materiale + data d'esame` a task giornaliere azionabili, visibili in calendario e in dashboard.
Spec funzionale completa: `docs/04-planner.md`.

## Scope
- **Wizard Piano** (4 step): obiettivo ed esame → disponibilità settimanale → copertura materiale e intensità →
  **anteprima del piano prima di confermare** (carico per settimana, argomenti coperti, fattibilità, costo del job).
- Motore ibrido AI/algoritmo (Fasi A/B/C).
- Materializzazione in `tasks`; ogni task ha un'azione eseguibile in un click.
- **Calendario**: viste Mese/Settimana/Agenda; esami come milestone con countdown; task drag&drop con
  re-schedule deterministico dei vincoli; blackout dates; overlay multi-materia con colori identità.
- Ricalcolo adattivo + **diff leggibile** del piano ("cosa è cambiato e perché").
- Export **ICS** (feed sottoscrivibile) + import ICS per conoscere gli impegni esistenti.
- Sezione Daily Task riusabile (stesso componente in Dashboard e in Materia).

## Decisioni
- **Il re-schedule non chiama l'LLM.** Spostare una task deve essere istantaneo e gratuito, altrimenti l'utente
  smette di usare il calendario. Solo un cambiamento di *scope* (nuovo materiale, nuova data) rilancia la Fase A.
- **Nessuna task senza payload eseguibile.** Se il Planner non sa dire con quale materiale si fa una task, non la crea.
- Il piano è **proposta**: l'utente può bloccare (`pin`) task che non devono muoversi nei ricalcoli.
- Task non completate: il giorno dopo non si accumulano silenziosamente — appaiono in "Debito" con l'opzione
  *rimanda / riassorbi nel piano / archivia*. L'accumulo invisibile è ciò che uccide ogni to-do app.

## Criteri di accettazione
- [ ] Piano a 30 giorni generato in <60s; fase B ricalcolata in <500ms.
- [ ] Tempo insufficiente → il wizard lo dichiara **prima** di generare e propone 3 strategie.
- [ ] Sposto una task di 2 giorni: il piano si riadatta senza violare i vincoli duri e senza chiamate AI.
- [ ] Due esami ravvicinati: nessun giorno supera i minuti disponibili.
- [ ] Il feed ICS si apre correttamente in Google Calendar e si aggiorna.
- [ ] Salto 3 giorni: al rientro il sistema propone un ricalcolo, non una lista di 30 task arretrate.

## Rischi
- **La fase più complessa del progetto.** Mitigazione: la Fase B è codice puro e testabile con scenari fissati
  (snapshot test su 10 casi: poco tempo, tanto tempo, un argomento, 5 materie, zero materiale…). Scrivere quei test *prima*.
- Sovra-ingegnerizzazione dell'ottimizzatore: partire da greedy + local search. Se non basta, si valuta un solver.

---

## Aggiornamento F6 — Revisione e commit del piano

Spec completa in `docs/04-planner.md` §9. Il wizard non termina con la generazione: termina con il **commit**.

### Scope aggiuntivo
- Stato `proposed` per le task; un piano `draft` è invisibile a Dashboard, Calendario e Daily Task.
- **Schermata Revisione piano**: editing completo della bozza (titolo, durata, tipo, giorno, materiale),
  aggiunta di task manuali, `pin`, azioni bulk, con carico e fattibilità ricalcolati in tempo reale (Fase B).
- **Commit transazionale e idempotente** su `planId`: tasks `todo`, orari, `plans/<id>.json` su disco, feed ICS.
- **Vista diff** per i ricalcoli, con il motivo su ogni riga e rispetto delle task `pin`.
- `calendar_events` come vincoli in ingresso (esami, lezioni, ICS importato), distinti dalle task.
- Prerequisiti dedotti dagli archi `precede` / `dipende-da` dei grafi degli schemi, come input della Fase A.

### Criteri di accettazione aggiuntivi
- [ ] Una bozza non produce alcun effetto fuori dalla schermata di revisione.
- [ ] Le modifiche alla bozza sopravvivono alla chiusura del browser.
- [ ] Commit di 40 task: transazione unica, nessun duplicato al rilancio.
- [ ] Il diff di un ricalcolo e' leggibile, motivato e rispetta i `pin`.
- [ ] Rifiutare il diff lascia il piano attivo immutato.
