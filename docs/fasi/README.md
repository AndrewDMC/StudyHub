# Fasi di sviluppo — indice

Ogni fase è una **slice verticale usabile**: al termine, il prodotto funziona end-to-end su uno scopo ridotto.
Nessuna fase è "solo backend" o "solo UI".

| Fase | Nome | Obiettivo in una frase | Durata stimata |
|---|---|---|---|
| F0 | Fondamenta | Il container parte, la materia è una cartella. | 3–5 gg |
| F1 | Ingest & Markdown canonico | Carico PDF e foto, diventano Markdown pulito (schemi a mano inclusi), verificabile e cercabile. | 8–12 gg — valutare split F1a/F1b |
| F2 | Materie & Materia Singola | La materia ha una casa con tutto dentro. | 4–6 gg |
| F3 | Motore AI & Worker | Flashcard, schemi, riassunti da CLI e UI. | 7–10 gg |
| F4 | Flashcard & Ripasso | FSRS, sessione di review, statistiche. | 5–7 gg |
| F5 | Esami & Simulazioni | Profilo d'esame, simulazioni, correzione. | 6–8 gg |
| F6 | Planner & Calendario | Il piano propone le task, io le approvo, entrano nel calendario. | 8–10 gg |
| F7 | Dashboard & Polish | Tutto converge nella home. Distribuzione. | 5–7 gg |
| F8 | Estensioni | Vedi `docs/06-miglioramenti.md`. | — |

**Definition of Done trasversale (vale per ogni fase):**
1. Test: unit sul dominio, integration sulle API, 1 e2e sul flusso principale della fase.
2. `docker compose up` da zero porta alla feature funzionante, senza passi manuali.
3. Gli stati empty/loading/error esistono e sono disegnati.
4. Nessun segreto nel bundle client; nessun path costruito per concatenazione.
5. La KB della fase è aggiornata con le decisioni prese *davvero* (non quelle previste).
