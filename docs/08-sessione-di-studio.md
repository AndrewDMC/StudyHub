# Sessione di studio — piano di implementazione

> Stato: **fasi 1 e 2 implementate** (2026-09-29 / 2026-10-05); fasi 3–4 da fare. Vedi §10 per lo stato e §9 per le decisioni prese.
> Realizza anche il "pannello AI contestuale" rinviato da F2 (`packages/db/src/schema.ts`, commento su `exams`).

## 1. Cosa vuole l'utente, in una frase

Clicco **Inizia** su una task del giorno → si apre una pagina di lavoro dove ho:

1. **il materiale** degli argomenti della task, pronto da leggere;
2. **una lista di punti chiave** da capire e **alcuni esercizi** per allenarmi, generati all'avvio;
3. **una chat laterale** con l'AI, che risponde _solo_ a partire da quei documenti e cita le fonti.

## 2. Esperienza utente

```
┌──────────────── Sessione · Analisi 2 · "Integrali doppi + Fubini" ─── ⏱ 00:23:10  [Termina] ┐
│ MATERIALE (sx)          │ STUDIO (centro)                         │ CHAT (dx)                  │
│ ▸ Arg. 1 Integrali dopp │ [Punti chiave] [Esercizi]               │ Tu: non capisco perché...  │
│   • Appunti cap.4 p3-9  │  ☐ Definizione di dominio normale [↗]   │ AI: Nel cap.4 (p.5) ...    │
│   • Slide L12           │  ☑ Enunciato di Fubini [↗]              │     [Appunti cap.4 · p.5]  │
│ ▸ Arg. 2 Fubini         │  ☐ Cambio di variabili polari [↗]       │                            │
│   • Esercitazione 3     │                                         │ [Spiegami meglio questo ▾] │
│ [viewer del documento]  │  Es.1 (facile)  Calcola... [Rispondi]   │ ┌────────────────────────┐ │
│                         │                                         │ │ Scrivi una domanda...   │ │
└─────────────────────────┴─────────────────────────────────────────┴────────────────────────────┘
```

- **Materiale**: i documenti sono raggruppati per argomento. Le pagine indicate dalla task
  (`payload.material[].pageFrom..pageTo`) sono evidenziate. Il viewer è quello già esistente
  (Markdown in stile Obsidian, wikilink, originale).
- **Punti chiave**: una checklist. Ogni voce ha un link `↗` al passaggio sorgente (con citazione).
  Spuntare una voce è solo uno stato personale.
- **Esercizi**: 3–6 esercizi con difficoltà crescente. Ogni esercizio si può risolvere in pagina e si
  può chiedere di **correggerlo** (riusa `gradeAnswer`) o vedere la **soluzione**.
- **Chat**: si possono selezionare delle righe nel viewer (o cliccare un punto chiave) e poi scegliere
  _"Chiedi all'AI"_: la domanda parte con quel passaggio come contesto. Le risposte citano sempre i
  documenti; se una domanda non è coperta dal materiale, l'AI lo dice (non inventa).
- **Termina**: registra il tempo reale, segna la task come `done` e propone _"Crea flashcard dai punti
  chiave"_ e _"Aggiungi gli esercizi sbagliati ai drill"_.

## 3. Da dove prendo gli "argomenti della task"

Oggi `tasks` ha **un solo** `topicId`, più `payload.material[]` (documenti + pagine). Una task
"argomento 1 e 2" quindi non è rappresentabile in modo diretto. Proposta, **senza migrazione della
tabella `tasks`**:

```
argomentiSessione = { task.topicId }
                  ∪ { topic di document_topics per ogni doc in payload.material }
documentiSessione = payload.material[].docId
                  ∪ { documenti taggati (document_topics) su argomentiSessione }
```

- I documenti citati nella task vengono **in evidenza**; gli altri documenti degli stessi argomenti
  restano disponibili ma in secondo piano.
- In pagina l'utente può **aggiungere o togliere argomenti** (un selettore degli argomenti della
  materia). La scelta viene salvata sulla sessione, non sulla task.
- Si può avviare una sessione anche **senza task** ("Studia un argomento" dalla scheda Argomenti):
  lo stesso flusso, con `taskId = null`.

## 4. Modello dati (nuove tabelle in `packages/db/src/schema.ts`)

```ts
study_sessions
  id uuid pk
  subject_id  → subjects (cascade)
  task_id     → tasks (set null)          // null = sessione libera
  topic_ids   jsonb string[]               // snapshot modificabile dall'utente
  document_ids jsonb string[]              // snapshot calcolato all'avvio (§3)
  status      'preparing' | 'active' | 'ended'
  briefing_job_id → jobs (set null)
  started_at, ended_at timestamptz
  active_ms   integer default 0            // tempo reale (pausa esclusa) → telemetria #7
  model       text                         // modello scelto per la chat

session_items                              // punti chiave + esercizi
  id uuid pk, session_id → study_sessions (cascade)
  kind        'key_point' | 'exercise'
  order_index integer
  title       text                         // punto chiave o testo dell'esercizio
  body        text                         // spiegazione / soluzione attesa
  difficulty  smallint null                // solo esercizi
  citations   jsonb {docId,page}[]         // validate come negli artifact
  topic_id    → topics (set null)
  state       'open' | 'done' | 'correct' | 'wrong'
  answer      text null, feedback jsonb null

session_messages                           // la chat
  id uuid pk, session_id → study_sessions (cascade)
  role        'user' | 'assistant'
  content     text
  focus       jsonb null                   // passaggio selezionato {docId,page,text} o itemId
  citations   jsonb {docId,page,chunkId}[]
  input_tokens, output_tokens integer, model text
  created_at
```

Lo stato vive nel DB, non in `data/`: una sessione è telemetria, non è materiale di studio. Il
backup esistente la include già, perché fa il dump del DB.

## 5. Backend

### 5.1 Avvio — `POST /api/subjects/[slug]/sessions` `{ taskId? , topicIds? }`

1. Risolve argomenti e documenti come in §3 (funzione pura in `packages/core/src/session.ts`, testabile).
2. Crea `study_sessions` con `status='preparing'` e porta la task a `doing`.
3. Accoda il job **`prepare_session`** e risponde `201 { sessionId }`. La UI naviga subito alla
   pagina: il materiale è già leggibile mentre il briefing viene generato.

Se esiste già una sessione `active` per la stessa task, la riapre invece di crearne una nuova.

### 5.2 Briefing — processor worker `prepare_session`

- Recupera i chunk dei `document_ids`, con priorità alle pagine indicate dalla task; resta sotto un
  budget di token.
- Nuovo metodo del provider: `generateSessionBriefing(input, model)` → `{ keyPoints[], exercises[] }`,
  entrambi con citazioni. Il prompt va in `packages/ai/prompts/session_briefing/v1.md` e lo schema zod
  in `schemas.ts`.
- Riusa la validazione delle citazioni già usata dagli artifact: gli item con citazioni non valide
  vengono scartati.
- Tiene conto di `exam_profiles`, se esiste: gli esercizi seguono lo stile del docente
  (tipologie e pesi).
- Implementazione `FakeProvider`: i punti chiave sono i titoli e le prime frasi dei chunk; gli
  esercizi sono cloze deterministici. Serve a far girare i test e l'e2e senza API key.
- Alla fine: `status='active'` e scrittura di `session_items`. La UI fa polling sul job come fa già
  `GenerationPanel`.

### 5.3 Chat — `POST /api/subjects/[slug]/sessions/[id]/messages` (streaming SSE)

La chat **non** passa dalla coda: l'utente aspetta la risposta, quindi serve streaming diretto dal
server web.

1. Salva il messaggio utente.
2. **Retrieval ristretto alla sessione**: estende `searchSubject` (`apps/web/src/lib/search.ts`) con
   un filtro `documentIds`. È la stessa ricerca ibrida FTS + vettoriale + RRF, con top‑k ≈ 8 chunk.
   Il passaggio in `focus`, se presente, entra sempre nel contesto.
3. Prompt `session_chat/v1.md`: system con regole (rispondi solo dal materiale, cita `[doc:pagina]`,
   di' "non è nel materiale" quando è il caso, italiano, tono da tutor); poi i chunk, gli ultimi N
   messaggi (finestra scorrevole) e l'elenco dei punti chiave.
4. Nuovo metodo del provider: `chatStream(input, model): AsyncIterable<ChatDelta>`
   - `AnthropicProvider` → `client.messages.stream(...)`
   - `ClaudeCliProvider` → `claude --print --output-format stream-json`
   - `FakeProvider` → risposta estrattiva (il chunk più pertinente, citato), emessa a pezzi
5. A fine stream: parsing delle citazioni, validazione contro i chunk forniti, salvataggio del
   messaggio assistente con i token usati.

Costi: l'uso della chat va registrato dove confluiscono gli altri costi, così compare in `/admin` e
nel cost meter. Il modello di default è quello "veloce" di `ModelPicker`, con selettore nella
testata della chat.

### 5.4 Altre route

| Route                                      | Scopo                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `GET  /sessions/[id]`                      | sessione + argomenti + documenti + item + messaggi                              |
| `PATCH /sessions/[id]`                     | `topicIds` (ricalcola `document_ids`), pausa/ripresa, `active_ms` (heartbeat)   |
| `PATCH /sessions/[id]/items/[itemId]`      | stato checklist, risposta a un esercizio                                        |
| `POST /sessions/[id]/items/[itemId]/grade` | correzione di un esercizio (job, riusa `gradeAnswer`)                           |
| `POST /sessions/[id]/items/more`           | "altri 3 esercizi" (job `prepare_session` con `mode:'exercises'`)               |
| `POST /sessions/[id]/end`                  | chiude la sessione, task → `done`, restituisce il riepilogo                     |
| `POST /sessions/[id]/flashcards`           | crea un mazzo dai punti chiave (riusa `generate_flashcards` con i chunk citati) |

## 6. Frontend

- **Nuova pagina** `apps/web/src/app/materie/[slug]/sessione/[sessionId]/page.tsx` con tre pannelli
  ridimensionabili. Su mobile diventano tre tab (Materiale / Studio / Chat).
- **"Inizia"** in `DashboardClient.tsx` e nella pagina Piano: oggi è un `Link` a `/piano`. Diventa una
  `POST /sessions` seguita dalla navigazione. Per le task di tipo `review` e `simulation` resta il
  comportamento attuale (portano a review e simulazione); la sessione serve per `read`, `schema` e
  `drill`.
- Componenti nuovi: `SessionMaterialPanel` (albero argomento→documenti + viewer riusato),
  `SessionBriefing` (checklist + esercizi), `SessionChat` (lista messaggi, streaming, chip di
  citazione cliccabili che aprono il documento alla pagina giusta), `SessionTimer`.
- **Selezione → chat**: il viewer Markdown mostra un piccolo menu "Chiedi all'AI" sulla selezione
  del testo.
- Stati empty, loading ed error (DoD): nessun documento taggato (con link "tagga i documenti"),
  briefing in corso (skeleton), briefing fallito ("riprova"), AI non configurata (spiegazione di
  `FakeProvider`).

## 7. Fette di consegna (ognuna usabile da sola)

| #   | Fetta                     | Contenuto                                                                                                       | AI?      |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **Sessione + materiale**  | tabelle, §3, avvio e chiusura, pagina con pannello Materiale, timer, "Inizia" collegato                         | no       |
| 2   | **Chat citata** ✔         | retrieval filtrato, `chatStream` su 3 provider, SSE, selezione → chat, costi                                    | sì       |
| 3   | **Briefing**              | job `prepare_session`, punti chiave ed esercizi, checklist, "altri esercizi"                                    | sì       |
| 4   | **Chiusura intelligente** | correzione esercizi, flashcard dai punti chiave, esercizi sbagliati nei drill (#8), `active_ms` al Planner (#7) | parziale |

Metto la chat prima del briefing perché è il pezzo che dà più valore subito e riusa di più
(ricerca ibrida già pronta). Il briefing ha senso una volta che la pagina esiste già.

## 8. Test (DoD trasversale)

- **Unit**: risoluzione argomenti/documenti (§3), finestra dei messaggi, parsing e validazione delle
  citazioni, `FakeProvider.chatStream` e `generateSessionBriefing` deterministici.
- **Integration (pglite)**: avvio da task (con e senza argomenti), riapertura di una sessione attiva,
  chat con retrieval ristretto (un chunk di un documento fuori sessione non deve mai comparire),
  chiusura → task `done` + `active_ms`.
- **e2e Playwright**: dashboard → Inizia → leggo un documento → faccio una domanda in chat → la
  risposta cita il documento → Termina.

## 9. Rischi e decisioni aperte

1. **Qualità del contesto**: se i documenti non sono taggati sugli argomenti, la sessione è vuota. Va
   mitigato col fallback sui `payload.material` della task e con una CTA verso `extract_topics`.
2. **Costi della chat**: una conversazione lunga costa. Servono una finestra di storia limitata, un
   top‑k limitato e il costo cumulativo visibile nella testata della sessione.
3. **Allucinazioni**: si rifiuta una risposta senza citazioni valide, oppure la si marca come
   "fuori dal materiale".
4. **Decisioni prese dall'utente** (2026-09-29): vedi §10.

## 10. Decisioni e stato

### Decisioni dell'utente

1. **Correzione degli esercizi: a scelta dell'utente.** Ogni esercizio ha _entrambe_ le vie:
   "Correggi con l'AI" (job `gradeAnswer`, costa) oppure "Mostra la soluzione" con
   autovalutazione (gratis). Niente correzione automatica.
2. **La chat è effimera nell'interazione, ma resta come trascrizione.** A fine sessione la
   conversazione viene salvata come **file Markdown** nella cartella della materia
   (es. `data/<materia>/sessioni/2026-09-29-<titolo>.md`, con citazioni come wikilink ai documenti),
   **rileggibile ma non più interattiva**. Conseguenza sul modello dati: `session_messages` (§4)
   serve solo _durante_ la sessione; alla chiusura si scrive il file e la riga in DB resta come
   indice. Il file si apre nel viewer Markdown già esistente (F1) e diventa cercabile come ogni
   altro documento della materia.
3. **Punti chiave ed esercizi solo su richiesta.** Nessun briefing all'avvio: la pagina mostra un
   pulsante "Genera punti chiave ed esercizi" (con `ModelPicker` e stima costo pre-flight, come
   `GenerationPanel`). Il job `prepare_session` (§5.2) parte solo da lì. Questo semplifica la fase 1
   (nessuno stato `preparing`) e tiene la spesa sotto controllo.

### Fase 1 — fatta

- `packages/core/src/session.ts` — `resolveSessionScope` (argomenti/documenti della sessione, §3), con test.
- `packages/db` — tabella `study_sessions` + migrazione `0016_study_sessions.sql`.
- `packages/contracts/src/session.ts` — DTO e richieste.
- `apps/web/src/lib/sessions.ts` — `startSession` (riapre la sessione attiva della stessa task),
  `getSession`, `updateSession` (cambio argomenti, `activeMs` monotono), `endSession` (task → `done`).
- Route: `POST /sessions`, `GET|PATCH /sessions/[id]`, `POST /sessions/[id]/end`.
- UI: pagina `/materie/[slug]/sessione/[sessionId]` (`SessionClient`): materiale per argomento con
  le pagine pianificate in evidenza, viewer Markdown, selettore argomenti, timer (solo a tab visibile,
  con pausa e heartbeat ogni 30 s), "Termina". "Inizia" in dashboard (`StartTaskButton`) apre la
  sessione per le task `read`/`schema`/`drill`; le altre restano sul Piano.
- Test: 4 unit (core) + 7 di integrazione (web, pglite).

### Timer Pomodoro — fatto (dentro la fase 1)

- `packages/core/src/pomodoro.ts` — macchina a stati pura (`tickPomodoro`, `skipPomodoroPhase`,
  `normalizePomodoroConfig`), esportata anche da `@studyhub/core/browser`. Ciclo classico:
  focus 25 → pausa breve 5, ogni 4° focus pausa lunga 15 (durate configurabili). Test: 8 unit.
- **Solo i focus contano come tempo di studio** (`activeMs`); le pause no. Nuova colonna
  `study_sessions.pomodoros` (migrazione `0017_session_pomodoros.sql`), monotona come `activeMs`.
- `PomodoroTimer.tsx` (`usePomodoro` + `PomodoroPanel`): countdown, pallini del ciclo, Pausa/Riprendi,
  "Salta al riposo/la pausa" (saltare un focus **non** lo conta come pomodoro), modalità
  **Pomodoro / Libero** (cronometro semplice), durate modificabili. Preferenze in `localStorage`.
- A fine fase: suono breve e notifica del browser (solo se concessa, chiesta al primo "Pausa/Riprendi").
- Il tempo scorre con il timestamp reale (una tab in background non lo perde); un salto oltre 90 s
  (PC in sleep) viene troncato e non conta come studio.
- **Limite noto:** la fase corrente del Pomodoro non è salvata sul server: dopo un ricaricamento si
  riparte da un nuovo focus, mentre tempo di studio e pomodori completati si recuperano.

**Non verificato nel browser**: le fasi sono coperte da test e typecheck, ma la pagina non è stata
aperta dal vivo (lo stack Docker in esecuzione ha l'immagine precedente e va ricostruito, con la
migrazione 0016).

### Fase 2 — chat con citazioni — fatta

- **Dati**: tabella `session_messages` e colonna `study_sessions.transcript_path` (migrazione `0018_session_chat.sql`).
- **Provider**: `AiProvider.chatStream(input, model): AsyncIterable<ChatDelta>` (`text` a pezzi, poi un `done` con i
  token). `AnthropicProvider` → `messages.create({ stream: true })`; `ClaudeCliProvider` →
  `claude --print --output-format stream-json --include-partial-messages` senza tool (con ripiego sul messaggio
  intero se non arrivano i parziali); `FakeProvider` → risposta estrattiva, citata, a pezzi. Prompt
  `session_chat/v1.md`; fonti, passaggio selezionato, storia e domanda entrano in tag escapati.
- **Citazioni**: il modello cita con marcatori numerici `[n]` (le fonti sono numerate nel prompt), non con
  `[doc:pagina]` come ipotizzato in §5.3: è più corto da generare e si valida con una semplice mappa
  `n → chunk`. Un marcatore verso una fonte mai fornita viene tolto dal testo, mai trasformato in citazione
  (`parseAnswerCitations`, `packages/core/src/sessionChat.ts`). Una risposta senza citazioni valide si vede
  marcata come «non ancorata al materiale».
- **Retrieval ristretto**: `retrieveChunks` in `apps/web/src/lib/search.ts` riusa la ricerca ibrida FTS +
  vettoriale + RRF con un filtro `documentIds` (top‑k 8; test: un chunk di un documento fuori sessione non
  compare mai). Per la chat l'FTS usa un **OR** sulle parole significative: con la sintassi `websearch`
  (AND) una domanda in linguaggio naturale non trovava nulla. Il passaggio selezionato porta sempre con sé i
  chunk della sua pagina.
- **Route**: `POST /sessions/[id]/messages` (SSE: `user` → `delta`… → `done` | `error`; gli errori prevedibili
  — sessione inesistente o terminata, passaggio di un documento fuori sessione — escono come normale errore
  HTTP prima dello stream), `GET /sessions/[id]/messages` (storia + costo), `GET /sessions/[id]/transcript`.
- **Costi**: ogni risposta scrive una riga `jobs` di tipo `session_chat` con il costo, quindi compare in
  `/admin` e nel costo mensile; il totale della sessione è nella testata della chat. Storia limitata a 10
  messaggi / 6000 caratteri, fonti troncate a 1800 caratteri.
- **Trascrizione** (decisione 2): `Termina` scrive `data/subjects/<materia>/sessioni/AAAA-MM-GG-<titolo>-<id8>.md`
  (front matter, turni, passaggio selezionato come citazione, fonti come `[[wikilink#p. N]]`). Se la scrittura
  fallisce la sessione resta comunque chiusa. A sessione terminata la chat mostra la trascrizione in sola lettura.
- **UI**: `SessionChat` a destra (sotto `lg` due tab Materiale / Chat); selezionando testo nel viewer compare
  «Chiedi all'AI» (la pagina si ricava dai titoli `## Pagina N` del `content.md`); i chip di citazione aprono il
  documento e scorrono alla pagina; selettore modello (`ModelPicker`), invio con Invio, risposta in streaming.
- **Test**: 10 unit (core) + 9 di integrazione pglite (chat) + 8 sui provider.

**Non fatto / limiti**

- La trascrizione non è ancora indicizzata come documento della materia (quindi non è cercabile come gli altri
  documenti, come prevede la decisione 2): oggi è un file `.md` sul disco, letto dalla sessione stessa.
- Interrompere la risposta dal browser ferma il modello ma non salva il parziale né il costo di quel turno.
- Se una risposta fallisce, la domanda resta nella storia senza risposta (e viene rimandata al modello nei turni
  successivi); non c'è un «riprova».
- **Non verificato nel browser** (come la fase 1): Docker non era in esecuzione, quindi la pagina e lo stream SSE
  non sono stati provati dal vivo. Coperti da test e typecheck: la logica, il retrieval, le route lato libreria e
  i tre provider contro client simulati; il parsing dello stream di `claude` è basato sul formato `stream-json`
  documentato, non su un'esecuzione reale. Serve ricostruire lo stack (migrazioni 0016–0018).

### Prossimo: fase 3 (briefing)
