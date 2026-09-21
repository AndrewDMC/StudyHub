# F5 — Esami & Simulazioni

## Obiettivo
Dagli esami passati il sistema impara **come** esamina quel corso e produce simulazioni realistiche, corrette con rubrica.

## Scope
- Anagrafica esami: data, tipo, peso, descrizione, materiale ammesso, durata.
- **Exam Profile Extraction**: dai documenti `esami` → struttura ricorrente, tipologie di esercizio,
  distribuzione argomenti, punteggi, tempo medio per item, verbosità richiesta. Editabile dall'utente.
- `generate_simulation`: modalità *esame completo* (imita il profilo) e *drill mirato* (un argomento, N esercizi crescenti).
- **Modalità Esame**: timer, item uno alla volta o vista completa, salvataggio automatico, niente aiuti AI durante.
- **Correzione**: passata AI con `rubric` → punteggio per criterio, cosa mancava, riferimento all'appunto
  che copre la lacuna, e proposta di card/drill sui punti deboli. Il risultato aggiorna `mastery`.
- Storico simulazioni con trend e confronto per argomento.

## Decisioni
- **La rubrica è generata insieme all'esercizio**, non dopo: garantisce coerenza fra ciò che si chiede e ciò che si valuta.
- La correzione è **formativa**: niente voto secco. "Punteggio 6/10 — manca il passaggio sul bilancio energetico
  (Appunti p. 73); esercizi simili sbagliati: 3/4" è utile, "6/10" no.
- Le simulazioni sono artefatti versionati: puoi rifare la stessa a distanza di tempo e confrontare.
- Feedback loop esplicito: ogni correzione produce `weak_topics[]` che il Planner legge alla ricalcolata successiva.

## Criteri di accettazione
- [ ] Da 3 esami passati emerge un profilo riconoscibile e modificabile.
- [ ] Una simulazione generata "somiglia" all'esame reale nel formato (verifica manuale su caso reale documentata).
- [ ] La correzione cita sempre il materiale dove ripassare.
- [ ] Un risultato scarso su un argomento si riflette nella heatmap e nel piano.
- [ ] Modalità esame: chiudo la tab per errore, riapro, le risposte ci sono e il timer è corretto.

## Rischi
- Esami con figure/grafici: senza input multimodale il profilo è parziale. Usare le pagine come immagini per i
  documenti `esami` è la strada, e va messa in conto nei costi.
- Correzione di risposte aperte: variabilità alta. Mitigazione: rubrica esplicita, temperatura bassa,
  e possibilità di chiedere una seconda opinione con modello superiore su singolo item.
