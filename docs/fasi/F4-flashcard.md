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
