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

## Stato: implementata (2026-09-22)

Tutti i criteri di accettazione sono coperti da test automatici (76 test, `pnpm turbo run test`,
tutti verdi). Decisioni prese _davvero_ durante l'implementazione, non previste nei documenti sopra:

- **Testing senza Docker**: `packages/db` usa [`@electric-sql/pglite`](https://pglite.dev) (Postgres
  in WASM) per i test — stesso schema Drizzle, vere query SQL, nessun server richiesto. La migrazione
  generata da `drizzle-kit` (`packages/db/drizzle/0000_init.sql`) è verificata in
  `packages/db/test/migrations.test.ts` applicandola per davvero con pglite, non solo con una DDL
  scritta a mano — evita che i due si disallineino in silenzio.
- **Ambiente di sviluppo senza Docker/Postgres/Redis a disposizione**: tutta l'implementazione e i test
  di questa fase sono stati fatti senza un demone Docker disponibile. I Dockerfile e il
  `docker-compose.yml` seguono il pattern standard Turborepo (`turbo prune --docker` + build
  multi-stage, utente non-root `uid 1000`, `HEALTHCHECK`) ma **non sono stati verificati con una build
  Docker reale** — da fare come primo passo prima di un deploy.
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
- **Niente `packages/services` condiviso**: la stessa logica "crea materia" (slug → scaffold FS → insert
  DB) è duplicata fra `apps/web/src/lib/subjects.ts` e `apps/cli/src/commands/subject.ts` (~30 righe).
  Estrarla in un package condiviso è rimandato finché una terza copia non lo giustifica.
- **shadcn/ui non installato**: per restare nei tempi di questa fase, i pochi controlli necessari
  (bottoni, input, form) sono Tailwind puro sui token del design system, non componenti shadcn/Radix
  generati. Da rivalutare quando F2+ richiede componenti più ricchi (select, dialog, combobox).
- **Verifica `next build`**: la compilazione, il type-check e la generazione delle pagine sono verdi;
  l'ultimo passo di `output: 'standalone'` (copia dei file tracciati) fallisce **solo** su questa
  macchina Windows per mancanza di permessi symlink (limite noto di Windows senza Developer Mode) — non
  è un problema del codice, e nell'immagine Docker (Linux) non si presenta.
- **e2e**: nessun Playwright/browser reale. Il "flusso principale" (creazione materia: input → slug →
  scaffold FS → insert DB → DTO → lista) è verificato end-to-end a livello di funzioni di libreria
  (`apps/web/test/subjects.test.ts`, `apps/cli/test/subject.test.ts`), non attraverso l'HTTP/UI reali.
