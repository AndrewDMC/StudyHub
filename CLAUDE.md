# StudyHub

Piattaforma self-hosted di studio: monorepo pnpm + turbo, TypeScript strict, Node 22.
`apps/web` (Next.js 15 + React 19 + Tailwind v4), `apps/worker` (BullMQ), `apps/cli`,
`packages/{core,db,contracts,services,ai}`. Knowledge base in `docs/` (indice nel README);
design system in `docs/05-design-system.md`, token in `apps/web/src/app/globals.css`.

- Test: `pnpm test` (pglite in-memory, niente Docker). Per pacchetto: `pnpm --filter @studyhub/<nome> test|typecheck|lint`.
- Lingua: codice in inglese, testi UI, commit e documentazione in italiano.
- Branch da `origin/main`, PR su GitHub; commit in stile conventional (`feat:`, `fix:`, `chore:`).

## Orchestrazione (sessione principale)

> Se sei un subagent, ignora questa sezione e segui la tua definizione in `.claude/agents/`.

La sessione principale è l'**orchestratore** (Opus): pianifica, delega, integra, decide. Non implementa
in prima persona se non per ritocchi di poche righe. Gli agenti stanno in `.claude/agents/`:

| Agente        | Modello | Quando                                                             |
| ------------- | ------- | ------------------------------------------------------------------ |
| `scout`       | Haiku   | Capire dove sta il codice prima di pianificare o scrivere un brief |
| `designer`    | Sonnet  | Da mockup/canvas a `spec.md` per il frontend                       |
| `frontend`    | Sonnet  | UI in `apps/web`                                                   |
| `backend`     | Sonnet  | core, db, contracts, services, worker, cli, Route Handler          |
| `ai-engineer` | Sonnet  | `packages/ai`, prompt, provider, processor AI                      |
| `tester`      | Sonnet  | Test per i criteri di accettazione, repro di bug                   |
| `checker`     | Haiku   | typecheck/lint/test/build → solo gli errori                        |
| `reviewer`    | Opus    | Review del diff completo, una volta per feature                    |
| `docs-writer` | Haiku   | Sezioni "Stato" in `docs/fasi`, README                             |

Flusso standard per una feature (vedi skill `/feature`): scout → piano → designer (se c'è UI) →
backend / ai-engineer / frontend → tester → checker → reviewer → correzioni → docs-writer → commit e PR.

### Regole per risparmiare token

1. **Non leggere codice in grande nella sessione principale.** Per sapere "dove/come", manda `scout`.
   Leggi tu solo ciò che serve per decidere (una firma, uno snippet).
2. **Passa file, non contenuti.** Spec, piani e contratti vanno in `.claude/work/<task>/` (ignorata da git);
   nel brief scrivi il path, non il testo. Gli agenti scrivono lì le spec lunghe e rispondono in breve.
3. **Brief autosufficienti**: obiettivo, file/area, vincoli, criteri di accettazione, comandi di verifica.
   Un agente parte senza la conversazione: tutto ciò che deve sapere è nel brief o nei file citati.
4. **Risposte corte a formato fisso**: ogni agente chiude con il blocco `ESITO/FILE/VERIFICHE/NOTE`.
   Se un report è vago, chiedi via `SendMessage` allo stesso agente invece di rilanciarne uno nuovo.
5. **Parallelo quando i file non si sovrappongono** (es. backend e frontend su contratti già fissati);
   in sequenza quando uno dipende dall'altro. Mai due agenti che scrivono sugli stessi file.
6. **Modello minimo sufficiente**: niente `reviewer` sui ritocchi, niente `designer` senza UI nuova,
   `checker` invece di lanciare tu la suite e leggerne i log.
7. **Continua invece di rifare**: per correzioni dopo review usa `SendMessage` all'agente che ha scritto
   il codice (ha già il contesto), non uno nuovo.
8. Compiti banali (una riga, rinomina, typo) li fai direttamente: lanciare un agente costa di più.

### Design di riferimento

- Mockup completo desktop: https://claude.ai/artifact/BFcYbQ67tF5DuaFbPnNSEu
- Flusso materia mobile: https://claude.ai/artifact/HqmqH7VfECQb27YCkerjDV — sorgenti in
  `docs/design/materia-mobile/` (`canvas.json` + un `.dc.html` per schermata) che il `designer` legge.
