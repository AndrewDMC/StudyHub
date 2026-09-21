# Architettura

## 1. Vista a blocchi

```
┌──────────────────────────────────────────────────────────────┐
│  Browser  →  apps/web (Next.js 15, App Router, RSC)          │
│              ├─ UI (Dashboard, Materie, Materia, Ingest…)    │
│              └─ Route Handlers = API interna (REST + SSE)    │
└───────────────┬──────────────────────────────────────────────┘
                │ enqueue job / stream progress (SSE)
┌───────────────▼──────────────────────────────────────────────┐
│  Redis (BullMQ)  — coda job + pub/sub progress               │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  apps/worker (Node, long-running)                            │
│   ├─ processors: ingest, chunk, embed, flashcards,           │
│   │              schema, summary, simulation, plan           │
│   ├─ packages/ai  → provider adapter (Anthropic | local)     │
│   └─ packages/core → dominio, FS layout, schemi Zod          │
└───────────────┬──────────────────────────────────────────────┘
                │
     ┌──────────┴───────────┐
┌────▼─────────┐   ┌────────▼───────────────────────────────┐
│ Postgres 16  │   │  VOLUME DATI  /data                    │
│ + pgvector   │   │   /data/subjects/<slug>/…  (verità)    │
│ (indice)     │   │   /data/tmp, /data/exports             │
└──────────────┘   └────────────────────────────────────────┘
```

`apps/cli` è lo stesso codice del worker invocato one-shot: `studyhub generate flashcards --subject fisica-1 …`.

## 2. Stack e motivazioni

| Layer | Scelta | Perché (e alternativa scartata) |
|---|---|---|
| Frontend | **Next.js 15 + React 19 + TypeScript** | RSC per dashboard dense senza waterfall di fetch. Scartato Vite+SPA: avremmo dovuto scrivere a mano il layer server. |
| UI kit | **Tailwind v4 + shadcn/ui (Radix)** | Componenti non-opinati, accessibili, totalmente ri-tematizzabili → necessario per il look futuristico custom. |
| Stato client | **TanStack Query** + Zustand (solo UI state) | Il server è la fonte; niente store globale di dominio. |
| API | Route Handlers + **Zod** su ogni boundary | Un solo linguaggio, tipi condivisi via `packages/contracts`. |
| DB | **Postgres 16 + pgvector** | Serve FTS + ricerca semantica + JSONB. Scartato SQLite: pgvector/FTS e concorrenza worker↔web. *(profilo `lite` con SQLite+sqlite-vec previsto in F7)* |
| ORM | **Drizzle** | Migrazioni SQL leggibili, zero runtime pesante nel worker. |
| Coda | **BullMQ + Redis 7** | Job con retry/priorità/progress + pub/sub per SSE. |
| Worker | **Node 22** | Stesso linguaggio ovunque; parsing PDF via `mupdf`/`pdfjs-dist`. |
| OCR | **tesseract.js** (opt-in) o `ocrmypdf` in sidecar | Per scansioni e foto di appunti. |
| LLM | **Anthropic SDK** (`@anthropic-ai/sdk`) | Default. Adapter aperto a OpenAI-compatible/Ollama. |
| Embeddings | **fastembed/ONNX locale** (bge-m3) | Gira offline, costo zero, 1024-d. Opzionale Voyage per qualità. |
| Auth | **Lucia / auth.js credentials**, single-user di default | È self-hosted. Multi-utente = flag, non requisito. |
| Osservabilità | **pino** → file + `/admin/jobs` | Niente SaaS obbligatori. |

## 3. Monorepo

```
studyhub/
├─ apps/
│  ├─ web/            # Next.js
│  ├─ worker/         # BullMQ consumer
│  └─ cli/            # bin "studyhub"
├─ packages/
│  ├─ core/           # dominio, FS layout, slug, path-safety
│  ├─ db/             # schema Drizzle + migrazioni
│  ├─ ai/             # provider adapter, prompt registry, model router
│  ├─ contracts/      # Zod schemas condivisi web↔worker↔cli
│  └─ ui/             # design system (token + componenti)
├─ docker/            # Dockerfile, compose, entrypoint
└─ docs/              # questa knowledge base
```

## 4. Docker

`docker-compose.yml` — 4 servizi: `web`, `worker`, `postgres`, `redis`.
Un solo volume di dati montabile dall'host:

```yaml
services:
  web:
    image: studyhub/web
    ports: ["3000:3000"]
    env_file: .env
    volumes: ["${STUDYHUB_DATA:-./data}:/data"]
    depends_on: [postgres, redis]
  worker:
    image: studyhub/worker
    env_file: .env
    volumes: ["${STUDYHUB_DATA:-./data}:/data"]
    deploy: { replicas: 1 }          # scalabile
  postgres:
    image: pgvector/pgvector:pg16
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7-alpine
```

Regole:
- **Immagini multi-stage**, non-root (`uid 1000`), `HEALTHCHECK` su tutti i servizi.
- La chiave API vive **solo** nel processo worker (`ANTHROPIC_API_KEY` non è mai esposta al browser).
- `STUDYHUB_DATA` punta a una cartella reale dell'host → l'utente vede le materie nel suo file manager.
- `docker compose --profile lite up` → variante SQLite senza Postgres/Redis (coda in-process) per macchine deboli.

## 5. Sicurezza minima ma reale
- **Path traversal**: ogni path passa da `resolveSubjectPath()` in `packages/core`; nessuna concatenazione di stringhe con input utente.
- **Upload**: allowlist MIME + sniffing magic bytes + limite dimensione + rinomina in `<uuid>.<ext>`; il nome originale resta solo come metadato in DB.
- **Prompt injection**: il testo dei documenti è **dato, non istruzione**. Va sempre incapsulato in tag (`<document>…</document>`) con istruzione esplicita al modello di ignorare comandi al suo interno. I worker non hanno tool di scrittura filesystem arbitraria.
- **Secrets**: `.env` non committato, `.env.example` sì.
- **Rete**: nessuna chiamata in uscita oltre il provider LLM configurato.

## 6. Contratto Job (cuore del sistema)

```ts
type Job = {
  id: string; type: JobType; subjectId: string;
  input: unknown;                       // validato con Zod per tipo
  model: { provider: 'anthropic'; id: string; maxTokens: number };
  status: 'queued'|'running'|'succeeded'|'failed'|'cancelled';
  progress: { pct: number; step: string };
  cost: { inputTokens: number; outputTokens: number; eur: number };
  output?: { artifactIds: string[] };
  error?: { code: string; message: string; retryable: boolean };
};
```
Stesso contratto per UI, CLI e cron. È il punto in cui il sistema resta semplice: **tutto è un job**.
