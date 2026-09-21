# StudyHub — Vision & Principi

## 1. Problema
Lo studio universitario si frammenta su troppi strumenti: PDF sparsi, Anki separato, calendario altrove,
piani di studio inesistenti o fatti a mano. Il costo non è la mancanza di materiale, è il **costo di
orchestrazione**: decidere ogni giorno cosa studiare, con quale materiale, e verificare di essere in pari.

## 2. Tesi del prodotto
StudyHub non è un raccoglitore di file. È un **motore di pianificazione** che trasforma
`materiale grezzo + data d'esame` in `azioni giornaliere verificabili`.
Tutto il resto (flashcard, schemi, simulazioni) è carburante per quel motore.

## 3. Principi non negoziabili
| # | Principio | Conseguenza pratica |
|---|-----------|---------------------|
| P1 | **Local-first, filesystem-first** | Le materie sono cartelle reali su disco. Il DB è un indice rigenerabile, mai la verità. Se disinstalli StudyHub, i tuoi materiali restano leggibili. |
| P2 | **L'AI propone, l'utente approva** | Nessun artefatto AI entra nella materia senza uno stato `draft → approved`. Zero allucinazioni silenziose nelle flashcard. |
| P3 | **Ogni output AI è tracciabile alla fonte** | Ogni flashcard/riga di schema porta `source: {file, pagina, offset}`. Click → apri il PDF al punto giusto. |
| P4 | **Il calcolo pesante è asincrono e headless** | Ogni funzione AI è un job eseguibile da CLI/worker senza la UI aperta. La UI è un client del worker, non il suo contenitore. |
| P5 | **Il modello è un parametro, non una dipendenza** | Model routing esplicito per task (haiku per estrazione, opus per planning). Configurabile per profilo. |
| P6 | **L'interfaccia deve sparire** | Estetica futuristica = densità informativa, gerarchia, calma. Zero animazioni decorative, zero glassmorphism gratuito, zero neon. |
| P7 | **Niente lock-in sui dati** | Export: Anki `.apkg`, Markdown, ICS per il calendario, JSON per tutto. |

## 4. Glossario canonico
- **Materia** — unità organizzativa massima. 1 materia = 1 cartella su disco = 1 riga in `subjects`.
- **Documento** — un file sorgente caricato (PDF, DOCX, immagine, MD). Immutabile dopo l'ingest.
- **Tipo documento** — `appunti | schemi | esami | slide | altro`. Determina la pipeline di automazione.
- **Canonical Markdown** — la versione normalizzata in Markdown di un documento (`derived/<docId>/content.md`). È l'unico formato che le funzioni AI leggono. Vedi `docs/07-markdown-layer.md`.
- **Grafo di schema** — nodi e archi tipizzati estratti da uno schema disegnato a mano; conserva le relazioni che il Markdown lineare perderebbe.
- **Artefatto** — output generato dall'AI: `flashcard_deck | schema | summary | simulation | drill`.
- **Argomento (Topic)** — nodo della tassonomia della materia. Estratto dall'AI, editabile. Collega documenti, flashcard e task.
- **Piano (StudyPlan)** — sequenza datata di Task generata dal Planner verso una `target_date`. Nasce come **bozza**: entra nel calendario solo dopo la conferma dell'utente.
- **Task** — azione atomica di un giorno (es. "Ripassa 40 card di Termodinamica", "Simulazione parziale cap. 3–5").
- **Job** — unità di lavoro del worker (ingest, generate_flashcards, plan, …), con stato e log.
- **Run** — esecuzione di una sessione di studio/ripasso che produce dati di performance.

## 5. Metrica del successo
Il prodotto funziona se rispondi in <10 secondi a: *"Cosa devo fare adesso, e sono in pari per l'esame di X?"*
Tutto ciò che non serve a rispondere a questa domanda è secondario.
