# StudyHub

Piattaforma self-hosted che trasforma materiale di studio grezzo (appunti, schemi, esami passati)
in un **piano quotidiano di azioni verificabili** verso un esame.
Local-first: le materie sono cartelle reali su disco, l'AI è un worker eseguibile anche da terminale.

> Stato: **F0 completa · F1–F7 a slice** — fondamenta, ingest deterministico (PDF+FTS), materie
> (argomenti/esami/archiviazione), motore AI con provider **simulato** (`FakeProvider`, gratuito e
> deterministico; `AnthropicProvider` reale pronto ma non testato dal vivo — serve una
> `ANTHROPIC_API_KEY`), ripasso con **FSRS-5 reale**, simulazioni d'esame con modalità esame e
> correzione formativa, **planner** con scheduling deterministico reale, bozza/revisione/commit del
> piano e **calendario mensile cross-materia** (niente ancora ICS), **dashboard** cross-materia con
> command palette (`⌘K`), **`studyhub backup`/`restore`** reali, e **tagging documento↔argomento**
> (`document_topics`) che il Planner usa già per pianificare sugli argomenti taggati, non solo sui
> documenti, e **`topics.mastery` reale** ricalcolata sia dopo ogni review FSRS sia dopo ogni
> simulazione corretta (0.5·retrievability + 0.3·accuratezza simulazioni + 0.2·copertura, pesi
> rinormalizzati sulle componenti con dati), con **heatmap nell'albero Argomenti** (tooltip con
> formula per esteso). Niente ancora tema light, densità, distribuzione Docker.
> 395 test (`pnpm turbo run test`), tutti verdi. Dettagli e limiti dichiarati nella sezione "Stato" di
> ogni `docs/fasi/F*.md`; roadmap completa in [docs/fasi/README.md](docs/fasi/README.md).

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
per passare al provider reale: nessun altro cambio richiesto.

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
