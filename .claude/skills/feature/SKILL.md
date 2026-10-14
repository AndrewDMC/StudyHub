---
name: feature
description: Porta una feature da richiesta a PR con la squadra di agenti (scout, designer, backend, ai-engineer, frontend, tester, checker, reviewer, docs-writer). Usalo quando l'utente chiede di implementare una funzionalità o una schermata.
argument-hint: <descrizione della feature o riferimento al design>
---

Feature richiesta: $ARGUMENTS

Sei l'orchestratore. Segui le regole di "Orchestrazione" in `CLAUDE.md`. Passi:

1. **Ricognizione.** Crea `.claude/work/<slug>/`. Lancia `scout` con domande precise
   (dove stanno le route/componenti/servizi coinvolti, pattern simili esistenti). Se le aree sono
   indipendenti, più scout in parallelo.
2. **Piano.** Scrivi `.claude/work/<slug>/plan.md`: obiettivo, fette di lavoro con agente assegnato,
   file di ciascuna fetta (senza sovrapposizioni), contratti tra backend e frontend (tipi Zod, endpoint),
   criteri di accettazione. Se una scelta spetta all'utente, chiedi ora; altrimenti procedi.
   Per feature grandi, dividi in slice consegnabili e fai una PR per slice.
3. **Spec di design** (solo se c'è UI nuova o ridisegnata): `designer` con il path del design e della
   cartella di lavoro → `spec.md`.
4. **Implementazione.** Prima i contratti (`backend` su `packages/contracts`), poi in parallelo
   `backend`/`ai-engineer` e `frontend` su file disgiunti. Ogni brief cita `plan.md`, `spec.md` e la sua fetta.
5. **Test.** `tester` sui criteri di accettazione (unit + e2e mobile 375×812 se UI).
6. **Verifica.** `checker`. Se rosso, rimanda gli errori all'agente autore via `SendMessage`.
7. **Review.** `reviewer` sul diff completo. Problemi di gravità alta/media → `SendMessage` all'autore,
   poi di nuovo `checker`.
8. **Chiusura.** `docs-writer` con l'elenco delle modifiche; commit (conventional, in italiano) e PR
   se l'utente l'ha chiesta. Riepilogo all'utente: cosa è stato fatto, cosa no, come provarlo.

Non leggere i file implementati per "controllare": la verifica è del `checker` e del `reviewer`.
