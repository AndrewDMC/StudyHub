# StudyHub

Piattaforma self-hosted che trasforma materiale di studio grezzo (appunti, schemi, esami passati)
in un **piano quotidiano di azioni verificabili** verso un esame.
Local-first: le materie sono cartelle reali su disco, l'AI è un worker eseguibile anche da terminale.

> Stato: **F0 completa · F1–F7 a slice** — fondamenta, ingest deterministico (PDF+FTS), materie
> (argomenti/esami/archiviazione), motore AI con provider **simulato** (`FakeProvider`, gratuito e
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
> di scheduling). Niente ancora tema light, densità, distribuzione Docker. 449 test
> (`pnpm turbo run test`), tutti verdi. Dettagli e limiti dichiarati nella sezione "Stato" di ogni
> `docs/fasi/F*.md`; roadmap completa in
> [docs/fasi/README.md](docs/fasi/README.md).

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

### Provider AI via CLI `claude` (subscription, senza API key)

`ClaudeCliProvider` ([packages/ai/src/claudeCliProvider.ts](packages/ai/src/claudeCliProvider.ts))
instrada le stesse chiamate (`generateFlashcards`, `generateSummary`, `extractExamProfile`,
`generateSimulation`, `gradeAnswer`, `estimateTopics`) attraverso la CLI `claude` da terminale
(`claude --print --output-format json --json-schema ...`, prompt su stdin, nessun tool/MCP
abilitato) invece della Messages API — usa quindi la sessione/subscription con cui `claude` è già
loggato, non `ANTHROPIC_API_KEY`. Stessa disciplina di retry-con-feedback-di-validazione (max 2)
dell'`AnthropicProvider`.

Per usarlo nell'ambiente Docker:

1. Sulla macchina host, assicurati che `claude login` sia già stato eseguito (scrive
   `~/.claude` e `~/.claude.json`).
2. In `.env`, imposta `AI_PROVIDER=claude-cli` e i percorsi host `CLAUDE_CLI_HOME`/
   `CLAUDE_CLI_CONFIG` (vedi commenti in `.env.example`).
3. Avvia con l'override che monta quelle credenziali nel container e installa la CLI
   (già nell'immagine worker):

   ```bash
   docker compose -f docker/docker-compose.yml -f docker/docker-compose.claude-cli.yml up
   ```

Il worker chiama quindi `claude` da terminale dentro il container, riusando la sessione OAuth
montata dall'host — nessuna chiave API in gioco. Nota: `pricing.ts` resta una stima *per token*
pensata per l'API a consumo — con la subscription il costo marginale reale per chiamata è zero,
la cifra mostrata in UI/CLI è quindi puramente illustrativa quando si usa questo provider.

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
