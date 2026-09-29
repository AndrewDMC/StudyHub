# StudyHub

Piattaforma self-hosted che trasforma materiale di studio grezzo (appunti, schemi, esami passati)
in un **piano quotidiano di azioni verificabili** verso un esame.
Local-first: le materie sono cartelle reali su disco, l'AI è un worker eseguibile anche da terminale.

> Stato: **F0 completa · F1 completa · F2–F7 a slice** — fondamenta, ingest con **OCR reale**
> (immagini e PDF scansionati via `AiProvider.ocrText`), **ricerca ibrida** (FTS + vettoriale,
> fusione RRF, embedding locale gratuito `Xenova/all-MiniLM-L6-v2`), **grafo nodi/archi per gli
> schemi a mano** (tassonomia chiusa, schermata di verifica con bounding box, export
> `.canvas`/Mermaid, profilo di grafia che impara dalle correzioni), **pre-classificazione AI del
> tipo documento** (suggerimento a un click, mai automatico) ed **editor di `content.md`** con
> stickiness (un re-ingest non sovrascrive mai una modifica manuale — mostra un conflitto
> risolvibile), materie (argomenti/esami/archiviazione), motore AI con provider **simulato**
> (`FakeProvider`, gratuito e
> deterministico; `AnthropicProvider` reale pronto ma non testato dal vivo — serve una
> `ANTHROPIC_API_KEY`; **`ClaudeCliProvider`** in alternativa, instrada le stesse chiamate sulla
> CLI `claude` da terminale usando la subscription già loggata, niente API key — vedi README
> "Provider AI via CLI `claude`"), ripasso con **FSRS-5 reale**, simulazioni d'esame con modalità esame e
> correzione formativa, **planner** con scheduling deterministico reale, bozza/revisione/commit del
> piano e **calendario mensile cross-materia** con **feed ICS sottoscrivibile** (export; import
> ancora da fare), **dashboard** cross-materia con
> command palette (`⌘K`), **`studyhub backup`/`restore`** reali, e **tagging documento↔argomento**
> (`document_topics`) che il Planner usa già per pianificare sugli argomenti taggati, non solo sui
> documenti, e **`topics.mastery` reale con formula completa** — retrievability (review FSRS),
> accuratezza simulazioni e **copertura del materiale letto** (task "read" completati) — con
> **heatmap nell'albero Argomenti** (tooltip con formula per esteso). Il Planner ora avvisa anche
> quando **il piano è indietro** (`detectDrift` collegato: 2+ giorni saltati o 30%+ task scadute →
> banner con link per rigenerare). **`studyhub plan generate`/`ls`** in CLI, in-process senza Redis.
> **Merge argomenti duplicati** (flashcard, `document_topics`, simulazioni e task si riattaccano,
> mastery ricalcolata). Motore AI ora completo sui quattro processor dello scope F3
> (`generate_flashcards`/`generate_schema`/`generate_summary`/`extract_topics`, oltre a
> `generate_simulation` di F5), con **`ModelPicker` + stima costo pre-flight** in UI prima di ogni
> generazione. **Pagina `/admin`** (job, costi per mese, stato sync FS, reset indice). **Export CSV**
> di un mazzo flashcard (importabile in Anki, mono-direzionale — niente ancora `.apkg` con stato
> di scheduling). **Tema chiaro/scuro/sistema e tre densità** (menu "Aspetto"), **checklist di
> primo avvio** in dashboard. Non ancora: immagini Docker pubblicate, profilo `lite` SQLite, audit
> axe/Lighthouse. Test: `pnpm turbo run test`. Dettagli e limiti dichiarati nella sezione "Stato" di ogni
> `docs/fasi/F*.md`; roadmap completa in
> [docs/fasi/README.md](docs/fasi/README.md).

## Quickstart

Serve solo Docker (con Compose v2). Le immagini **non sono ancora pubblicate**: la prima volta si
costruiscono in locale, quindi conta qualche minuto di build in più.

```bash
git clone <questo-repo> studyhub && cd studyhub
cp .env.example .env
docker compose -f docker/docker-compose.yml up --build
```

Apri <http://localhost:3000>: la dashboard mostra la checklist **Per iniziare** — crea una materia,
carica un PDF, attendi "Pronto", genera le prime flashcard, conferma un piano. Senza
`ANTHROPIC_API_KEY` l'AI è simulata (`FakeProvider`: gratuita, deterministica, estrae testo vero dal
tuo materiale ma non lo "capisce"); imposta la chiave in `.env` per usare il modello reale.

I tuoi dati stanno nella cartella `data/` (una cartella per materia): `studyhub backup` la salva
insieme al database.

## Sviluppo locale

```bash
corepack enable          # o: npm install -g pnpm
pnpm install
pnpm test                 # tutti i test (pglite in-memory, nessun Docker richiesto)
pnpm --filter @studyhub/web dev     # richiede DATABASE_URL (Postgres reale)
pnpm --filter @studyhub/cli dev -- subject ls
pnpm --filter @studyhub/cli dev -- backup ./backup-2026-09-24
pnpm --filter @studyhub/cli dev -- restore ./backup-2026-09-24   # sostituisce lo stato attuale
```

`docker compose -f docker/docker-compose.yml up` per l'ambiente completo (web + worker + Postgres +
Redis); copia `.env.example` in `.env` prima di avviarlo.

Le funzioni AI (`generate_flashcards`, `generate_summary`) girano **senza `ANTHROPIC_API_KEY`**
usando `FakeProvider` (estrazione deterministica, verbatim, costo zero — vedi
[docs/fasi/F3-ai-core.md](docs/fasi/F3-ai-core.md) "Stato"). Imposta `ANTHROPIC_API_KEY` in `.env`
per passare al provider reale (`AnthropicProvider`, API a consumo): nessun altro cambio richiesto.

### Collegare il proprio account Claude (subscription, senza API key)

Ogni utente collega **il proprio** account dall'app, senza toccare file o variabili:

1. Avvia lo stack (`docker compose -f docker/docker-compose.yml up`) e apri `/admin`.
2. Nella card **Account Claude** premi _Accedi con Claude_, apri il link, accedi e incolla nel
   campo il codice che Claude mostra alla fine.
3. Fatto: le generazioni (`generateFlashcards`, `generateSummary`, `extractExamProfile`,
   `generateSimulation`, `gradeAnswer`, `estimateTopics`, …) passano dal tuo abbonamento.

Come funziona: l'app pilota la CLI ufficiale (`claude auth login --claudeai`, poi
`claude --print --json-schema ...` con prompt su stdin e nessun tool/MCP abilitato,
[packages/ai/src/claudeCliProvider.ts](packages/ai/src/claudeCliProvider.ts)). StudyHub non vede né
salva alcun token: la CLI li scrive nel volume Docker `claude-auth`, condiviso da web e worker e
**locale alla tua installazione** — nessun file dell'host viene montato e nessuna credenziale è
nell'immagine o nel repo. Stessa disciplina di retry-con-feedback-di-validazione (max 2)
dell'`AnthropicProvider`. _Esci_ nella card revoca l'accesso; `docker compose down -v` cancella il volume.

`AI_PROVIDER=claude-cli` in `.env` resta disponibile per chi vuole fissare il provider da
configurazione (la card lo segnala e non permette di cambiarlo). Nota: `pricing.ts` resta una stima
_per token_ pensata per l'API a consumo — con la subscription la cifra in UI/CLI è illustrativa e
consuma i limiti del tuo piano. L'app non ha autenticazione propria: tienila su `localhost`.

## Knowledge base

| Documento                                                                | Contenuto                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [Vision & Principi](docs/00-vision.md)                                   | Tesi del prodotto, principi non negoziabili, glossario                              |
| [Architettura](docs/01-architettura.md)                                  | Stack, monorepo, Docker, sicurezza, contratto Job                                   |
| [Filesystem & Dati](docs/02-filesystem-e-dati.md)                        | Layout su disco, schema DB, FSRS, formula di mastery                                |
| [AI & Worker](docs/03-ai-e-worker.md)                                    | Pipeline di ingest, funzioni AI, model routing, CLI, disciplina dei prompt          |
| [Planner](docs/04-planner.md)                                            | Motore ibrido AI + scheduler, vincoli, adattività, **revisione e commit del piano** |
| [Design System](docs/05-design-system.md)                                | "Calm Futurism": token, componenti, densità, a11y                                   |
| [Markdown Layer & Schemi](docs/07-markdown-layer.md)                     | Formato canonico Markdown, trascrizione schemi a mano, grafo nodi/archi, verifica   |
| [Miglioramenti proposti](docs/06-miglioramenti.md)                       | Estensioni ordinate per valore/costo + anti-obiettivi                               |
| [Fasi di sviluppo](docs/fasi/README.md)                                  | F0→F7, una KB per fase con criteri di accettazione                                  |
| [Prompt mockup](docs/design/prompt-mockup.md)                            | Prompt pronto per generare i mockup dell'hub                                        |
| [**Mockup completo**](https://claude.ai/artifact/BFcYbQ67tF5DuaFbPnNSEu) | Artifact navigabile: style guide + 14 schermate (fonte di verità visiva)            |

## Percorso consigliato di lettura

`00-vision` → `fasi/README` → `01-architettura` → la fase su cui stai lavorando.
