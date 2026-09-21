# Proposte di miglioramento

Ordinate per **rapporto valore/costo**. Le prime cinque cambiano la natura del prodotto: le considererei
parte del piano, non extra.

## Tier 1 — Alto valore, costo contenuto

### 1. Exam Profile — imparare *come* esamina il docente
Già inserito in F5, ma vale ripeterlo: è **il vero differenziatore**. Chiunque genera flashcard da un PDF.
Nessuno costruisce un modello del tuo esame specifico (tipologie ricorrenti, pesi, verbosità attesa, trappole)
e ci allena sopra. È la funzione che giustifica l'esistenza del prodotto.

### 2. Gap Analysis / Coverage Map
Incrocio automatico `argomenti del programma × materiale posseduto × flashcard esistenti × argomenti d'esame ricorrenti`.
Output: **"Non hai materiale su 'Trasformate di Laplace', che compare in 4 esami su 5."**
Questa singola schermata previene il fallimento più costoso: studiare tanto, ma la cosa sbagliata.
Costo: basso (i dati ci sono già). Valore: altissimo.

### 3. Modalità Feynman / Interrogazione orale
Spieghi un argomento a voce (Web Speech API) o per iscritto; l'AI ti interrompe con domande di
approfondimento come farebbe un esaminatore, poi ti dice dove sei stato vago.
È la preparazione all'orale che nessun tool fa, ed è il momento in cui scopri di "sapere" senza saper spiegare.

### 4. Confidence calibration
Prima di rispondere a una card o a un esercizio, dichiari quanta fiducia hai (1–3).
Il sistema misura lo **scarto tra fiducia e correttezza** e ti mostra dove sei *illuso di sapere*.
È la metrica più predittiva del voto reale ed è quasi gratis da implementare.

### 5. Import diretto da fonti esterne
Drop di link YouTube (trascrizione), pagine web, registrazioni delle lezioni (Whisper locale).
Gli appunti universitari non sono solo PDF. Costo medio, elimina attrito quotidiano.

## Tier 2 — Forte valore, costo medio

### 6. Spaced repetition sugli *esercizi*, non solo sulle card
Per le materie STEM, ricordare la formula non serve se non sai applicarla. Un secondo scheduler FSRS su
"tipologie di esercizio" con difficoltà crescente. Trasforma lo strumento da mnemonico a performativo.

### 7. Sessione di studio con timer e telemetria
Pomodoro integrato nella task: tempo stimato vs reale. Dopo 2 settimane il Planner conosce il **tuo**
fattore di correzione personale (es. "sottostimi del 40%") e pianifica su dati reali, non su ipotesi.
Questo singolo dato migliora la qualità di ogni piano futuro.

### 8. Question Bank incrementale
Ogni esercizio sbagliato in simulazione entra in una banca personale e riemerge nei drill successivi
finché non è padroneggiato. Zero costo AI aggiuntivo, alto effetto.

### 9. Ricerca globale semantica ("chiedi ai tuoi appunti")
RAG su tutta la libreria, con risposta **sempre citata** e link alla pagina. Sostituisce "in che PDF era…".
L'infrastruttura (chunks + embeddings) esiste già da F1: il costo è quasi solo di UI.

### 10. Confronto documenti
"Cosa c'è negli appunti del collega che non c'è nei miei?" — diff semantico fra due documenti sullo stesso argomento.

## Tier 3 — Alto valore, costo alto (post-1.0)

### 11. Mobile companion (PWA offline) + cattura schemi
Ripasso flashcard, task del giorno e **acquisizione da fotocamera degli schemi a mano** (guida ai bordi,
correzione prospettica, invio in coda di normalizzazione). Fotografare uno schema dal telefono subito dopo
la lezione e trovarlo trascritto al rientro e' il flusso naturale. Offline-first con sync. Il 70% del ripasso avviene in mobilità;
senza questo, metà del valore delle flashcard resta inutilizzata.

### 12. Assistente vocale in studio
Domanda a voce durante la lettura, risposta contestuale sul documento aperto. Riduce l'attrito a zero.

### 13. Modalità collaborativa
Condividi deck e schemi (export pacchetto firmato), gruppi di studio, simulazioni comparate.
Attenzione: apre il tema multi-utente/permessi. Da valutare solo dopo un 1.0 solido.

### 14. Local LLM fallback (Ollama)
Per estrazione topic e chunking, un modello locale copre l'80% dei casi a costo zero e funziona offline.
Il routing è già astratto: il costo è l'adapter e la calibrazione dei prompt.

## Aggiunte trasversali da inserire fin da subito
- **Cost meter sempre visibile** (mese corrente vs budget). Un tool AI self-hosted senza controllo dei costi si abbandona.
- **Undo su tutto ciò che tocca il disco**, con `.trash/` a 30 giorni.
- **`schemaVersion` su ogni file JSON** (manifest, deck, piani): senza, la prima migrazione dati sarà dolorosa.
- **Health check della materia**: semaforo che segnala materiali non processati, argomenti senza card, piani scaduti.
- **Changelog dei piani** visibile: la fiducia nel Planner nasce dal vedere *perché* ha cambiato idea.

## Cose da NON fare
- Chat generica con l'AI dentro l'app senza contesto: diventa una scusa per procrastinare. Ogni interazione AI
  deve essere ancorata a un artefatto o a una task.
- Gamification competitiva, streak, notifiche: contraddicono P6.
- Editor di testo integrato per **scrivere** appunti da zero: esistono strumenti migliori. StudyHub **importa** e normalizza, non compete con Obsidian/Notion.
  *Distinzione importante*: l'editor correttivo sul Canonical Markdown (`docs/07-markdown-layer.md`) non viola questo punto — serve a correggere una trascrizione, non ad autorare. E poiché i `.md` stanno su disco dentro la cartella della materia, Obsidian ci lavora sopra nativamente: nessuna ragione per reimplementarlo.
- Sincronizzazione cloud proprietaria: local-first + backup. Chi vuole il cloud monta un volume di rete.
