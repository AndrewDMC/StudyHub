# F0 — Fondamenta

## Obiettivo

`docker compose up` → web su :3000, worker connesso, DB migrato, una materia creata da UI crea
una cartella reale su disco con il suo `subject.json`.

## Scope

- Monorepo pnpm + turbo; TypeScript strict; ESLint/Prettier; commit hook.
- `packages/core`: slug, `resolveSubjectPath`, scaffolding cartelle, lettura/scrittura manifest.
- `packages/db`: Drizzle + migrazione iniziale (`subjects`, `jobs`, `settings`).
- `apps/web`: AppShell, tema e token del design system, pagina Materie (lista + create).
- `apps/worker`: connessione BullMQ, job `ping` e `reconcile` minimo.
- `apps/cli`: `subject add|ls`, `reconcile`.
- Docker: 4 servizi, healthcheck, volume `/data`, `.env.example`.

## Decisioni da fissare qui (costose da cambiare dopo)

- **Slug e identità**: `id` UUID in DB, `slug` stabile sul FS; rinominare la materia non tocca la cartella.
- **Path safety**: unica funzione di risoluzione path, testata contro `../`, symlink, unicode, riservati Windows.
- **Manifest come contratto**: `subject.json` valida con Zod e ha `schemaVersion` (serve per le migrazioni FS future).
- **Ordine di verità**: in caso di conflitto FS↔DB, **vince il filesystem** per l'esistenza dei file,
  vince il DB per i metadati derivati.

## Criteri di accettazione

- [ ] Creo "Fisica 1" da UI → esiste `/data/subjects/fisica-1/` con sottocartelle e manifest.
- [ ] Creo una cartella a mano con manifest valido → `reconcile` la importa.
- [ ] Rinomino la materia → la cartella non cambia, la UI mostra il nome nuovo.
- [ ] Il worker sopravvive al riavvio di Redis (retry con backoff).
- [ ] `docker compose down && up` non perde dati.

## Rischi

- **Path Windows ↔ container Linux** (case-sensitivity, lunghezza, caratteri illegali): normalizzare gli slug in
  `[a-z0-9-]` e testare su entrambi fin da ora. È il bug che, scoperto in F5, costa una settimana.
- Permessi volume Docker su Windows/WSL: fissare `uid/gid` e documentare.

## Stato: implementata (2026-09-22, aggiornata 2026-09-26)

Tutti i criteri di accettazione sono coperti da test automatici (`pnpm turbo run test`, tutti verdi)
**e ora anche da una build/avvio Docker reali** (vedi sotto). Decisioni prese _davvero_ durante
l'implementazione, non previste nei documenti sopra:

- **Testing senza Docker**: `packages/db` usa [`@electric-sql/pglite`](https://pglite.dev) (Postgres
  in WASM) per i test — stesso schema Drizzle, vere query SQL, nessun server richiesto. La migrazione
  generata da `drizzle-kit` (`packages/db/drizzle/0000_init.sql`) è verificata in
  `packages/db/test/migrations.test.ts` applicandola per davvero con pglite, non solo con una DDL
  scritta a mano — evita che i due si disallineino in silenzio.
- **Ambiente di sviluppo senza Docker/Postgres/Redis a disposizione**: tutta l'implementazione e i test
  di questa fase sono stati fatti senza un demone Docker disponibile. I Dockerfile e il
  `docker-compose.yml` seguono il pattern standard Turborepo (`turbo prune --docker` + build
  multi-stage, utente non-root `uid 1000`, `HEALTHCHECK`).
  **Aggiornamento 2026-09-26 — verificato con build Docker reale** (vedi in fondo).
- **`packages/core` diviso in barrel "server" e "browser"**: `manifest.ts`/`scaffold.ts`/`paths.ts`
  importano `node:fs`; un Client Component che importasse `SUBJECT_COLORS` dal barrel principale
  (`@studyhub/core`) trascinava quei moduli nel bundle del browser (Next.js/webpack falliva la build
  con `UnhandledSchemeError` su `node:fs`/`node:crypto`). Soluzione: `@studyhub/core/browser` esporta
  solo `slug.ts` + `colors.ts` (puri); i componenti client (`CreateSubjectForm`, `SubjectCard`)
  importano da lì, mai dal barrel principale.
- **Colori delle materie**: `docs/05-design-system.md` nomina le 8 tinte identità ma non fissa i valori
  esadecimali. Scelti ora in `apps/web/src/lib/subjectColors.ts` (violet `#8B5CF6`, blue `#4C8DFF`,
  cyan `#22D3EE`, teal `#2DD4BF`, green `#3DD68C`, amber `#F5B544`, rose `#FB7185`, magenta `#E879F9`).
- **`reconcile` in F0 copre solo i `subjects`**: lo scan sha256 dei documenti (`docs/02-filesystem-e-dati.md`
  §2) resta F1+, perché la tabella `documents` non esiste ancora. Il job importa nel DB le cartelle
  materia create a mano con un `subject.json` valido — esattamente il criterio di accettazione di F0.
- **`packages/services` condiviso** (2026-09-26): la logica "crea materia" (slug → scaffold FS →
  insert DB), prima duplicata fra `apps/web/src/lib/subjects.ts` e
  `apps/cli/src/commands/subject.ts` (~30 righe), ora vive in `createSubjectRow`
  (`packages/services/src/subjects.ts`); entrambi i chiamanti la richiamano e mappano il risultato
  al proprio DTO. Coperto da test propri (`packages/services/test/subjects.test.ts`) oltre a quelli
  già esistenti in web/cli, tutti verdi.
- **shadcn/ui installato** (2026-09-26): `apps/web/components.json` + `@/lib/utils` (`cn`) e un primo
  set di primitivi in `apps/web/src/components/ui/` (`button`, `input`, `label`, `dialog`, `select`,
  `popover`, `command`, `combobox` — quest'ultimo il recipe standard shadcn Popover+Command via
  `cmdk`), tutti restilizzati sui token del design system esistenti (`--bg-*`, `--fg-*`, `--accent`,
  `--radius-*`) invece della palette di default di shadcn, per non introdurre un secondo sistema di
  colori. `CreateSubjectForm`/`MaterieClient` sono stati migrati a `Button`/`Input`/`Label`/`Dialog`
  come primo utilizzo reale (creazione materia ora si apre in una vera modale, non più una rivelazione
  inline). Gli altri componenti bespoke restano Tailwind puro — la migrazione completa non è nello
  scope di questo aggiornamento.
- **Verifica `next build` e build Docker reale** (2026-09-26): confermato che il fallimento di
  `output: 'standalone'` su Windows **non è un problema di permessi mancanti**, come si pensava, ma
  del **filesystem**: pnpm/Next si appoggiano a symlink NTFS che **exFAT non supporta affatto** — se il
  checkout vive su un volume exFAT (caso reale riscontrato qui), perfino `pnpm install` da zero fallisce
  con `os error 1`, non solo l'ultimo passo della build. Niente di questo si presenta nell'immagine
  Docker (il build gira dentro un container Linux, filesystem del container, non del host) né sviluppando
  da un volume NTFS o dal filesystem nativo di WSL2 (ext4). **Build Docker verificata per davvero** su
  questa macchina (`docker compose -f docker/docker-compose.yml build` + `up`, tutte e 3 le immagini —
  `web`, `worker`, `migrate` — buildano e i container arrivano `healthy`): creazione "Fisica 1" via
  API reale → `/data/subjects/fisica-1/` scaffoldata per davvero; `down && up` con volumi (`pgdata`,
  `/data`) conferma che i dati sopravvivono al riavvio, come da criterio di accettazione.
- **e2e con Playwright reale** (2026-09-26): `apps/web/playwright.config.ts` +
  `apps/web/e2e/create-subject.spec.ts` verificano il flusso principale (creazione materia) attraverso
  un vero browser Chromium via HTTP, non più solo a livello di funzioni di libreria. Il test punta a
  un'istanza già in esecuzione (`docker compose up`, `baseURL` di default `http://localhost:3000`)
  invece di avviare una propria infrastruttura Postgres/Redis — è quell'ambiente, non un mock, la cosa
  che questo livello di test deve provare. Si lancia con `pnpm --filter @studyhub/web test:e2e` a
  container avviati; richiede i browser Playwright (`npx playwright install chromium`, più le librerie
  di sistema via `playwright install-deps` su Linux/WSL, non incluso in `pnpm install`).
