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
