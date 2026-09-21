# StudyHub

Piattaforma self-hosted che trasforma materiale di studio grezzo (appunti, schemi, esami passati)
in un **piano quotidiano di azioni verificabili** verso un esame.
Local-first: le materie sono cartelle reali su disco, l'AI è un worker eseguibile anche da terminale.

> Stato: **fase di progettazione**. Questo repository contiene per ora la knowledge base.

## Knowledge base

| Documento | Contenuto |
|---|---|
| [Vision & Principi](docs/00-vision.md) | Tesi del prodotto, principi non negoziabili, glossario |
| [Architettura](docs/01-architettura.md) | Stack, monorepo, Docker, sicurezza, contratto Job |
| [Filesystem & Dati](docs/02-filesystem-e-dati.md) | Layout su disco, schema DB, FSRS, formula di mastery |
| [AI & Worker](docs/03-ai-e-worker.md) | Pipeline di ingest, funzioni AI, model routing, CLI, disciplina dei prompt |
| [Planner](docs/04-planner.md) | Motore ibrido AI + scheduler, vincoli, adattività, **revisione e commit del piano** |
| [Design System](docs/05-design-system.md) | "Calm Futurism": token, componenti, densità, a11y |
| [Markdown Layer & Schemi](docs/07-markdown-layer.md) | Formato canonico Markdown, trascrizione schemi a mano, grafo nodi/archi, verifica |
| [Miglioramenti proposti](docs/06-miglioramenti.md) | Estensioni ordinate per valore/costo + anti-obiettivi |
| [Fasi di sviluppo](docs/fasi/README.md) | F0→F7, una KB per fase con criteri di accettazione |
| [Prompt mockup](docs/design/prompt-mockup.md) | Prompt pronto per generare i mockup dell'hub |

## Percorso consigliato di lettura
`00-vision` → `fasi/README` → `01-architettura` → la fase su cui stai lavorando.
