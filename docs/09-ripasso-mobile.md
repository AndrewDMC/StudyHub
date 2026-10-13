# 09 — Ripasso rapido mobile (piano di implementazione)

Fonte del design: artefatto "StudyHub · Ripasso rapido mobile" (4 artboard 390×844: scelta
materia/argomento → domanda → risposta e valutazione → riepilogo). Riprende
docs/06-miglioramenti.md #11 ("Mobile companion") e la variante "PWA mobile 390×844" di
docs/05-design-system.md, limitata per ora al **ripasso** (task del giorno e cattura schemi restano fuori).

Vincolo: la sezione **Ripasso rapido esiste solo sotto `md` (< 768 px)**. Su desktop resta il ripasso
per materia attuale (`/materie/[slug]/review`, tastiera-first) e il link al ripasso rapido non compare.

---

## 0. Stato attuale (cosa c'è e cosa manca)

| Area                                  | Oggi                                                             | Problema per il mobile                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `AppShell.tsx`                        | sidebar `hidden md:flex`, header con Appearance + CommandPalette | **sotto `md` non c'è nessuna navigazione**: da telefono non si arriva a Materie/Calendario se non dalla Dashboard    |
| `layout.tsx`                          | nessun `viewport` export, nessun manifest                        | niente `viewport-fit=cover`/safe-area, niente `theme-color`, non installabile                                        |
| `ReviewSessionClient.tsx`             | `h-dvh` dentro `<main>` dell'AppShell                            | doppio scroll (header 48 px + `h-dvh`), bottoni 32 px, scorciatoie da tastiera come UI principale, etichette inglesi |
| `getReviewQueue` (`lib/review.ts`)    | per **una** materia, filtro `topicId`                            | il ripasso rapido parte da "tutte le materie" o da una materia/argomento qualsiasi                                   |
| `countDueCards*` (`lib/dashboard.ts`) | conta new + scadute                                              | **non esclude le card segnalate** e non applica `newLimit`: il numero non coincide con la coda reale                 |
| `reviews` (schema)                    | salva `prevStability`                                            | **impossibile annullare** una valutazione: manca lo snapshot FSRS precedente                                         |
| `FlashcardDto`                        | senza `dueAt`                                                    | il riepilogo "Prossime scadenze" non ha i dati                                                                       |
| FSRS (`core/fsrs.ts`)                 | solo `scheduleReview`                                            | mancano gli intervalli in anteprima sotto i bottoni ("<1 min", "1 g"…)                                               |
| Playwright                            | solo `Desktop Chrome`                                            | nessun test a viewport telefono                                                                                      |

---

## 1. Decisioni di prodotto (da confermare prima di iniziare)

1. **Route**: `/ripasso` (home + sessione + riepilogo nello stesso client component, come il prototipo).
   La sessione è un overlay `fixed inset-0` che copre shell e tab bar; deep link via
   `?materia=<slug>&argomento=<topicId>&n=10`.
2. **Solo mobile**: niente user-agent sniffing. Il gate è CSS (`md:hidden` sulla tab bar e sul
   contenuto); a `≥ md` `/ripasso` mostra un rimando "Il ripasso rapido è pensato per il telefono"
   con i link ai ripassi per materia. Così ruotare un tablet o ridimensionare la finestra non rompe nulla.
3. **Confidenza pre-risposta** (1-3, docs/06 #4): il prototipo non la ha. Proposta: **omessa** su mobile
   (`confidence = null`, già ammesso dallo schema) per non aggiungere un tap a ogni card. La calibrazione
   continua a usare i dati del ripasso desktop.
4. **"Di nuovo" ri-accoda la card a fine sessione** (comportamento del prototipo), oltre all'aggiornamento FSRS
   lato server. "Ripassa gli errori" rilancia le card con almeno un "Di nuovo".
5. **Swipe**: → = Bene (3), ← = Di nuovo (1), soglia 70 px, solo a risposta visibile. Facile/Difficile solo dai bottoni.
6. **Azioni secondarie** (modifica, sospendi, segnala, fonte) in un bottom sheet dal bottone `⋯` dell'header
   sessione, non come riga di scorciatoie.
7. **Offline**: fuori scope in questa fase (vedi §7). Le valutazioni restano una richiesta ciascuna.

---

## 2. Fase A — Fondamenta mobile di tutta l'app

Obiettivo: ogni pagina esistente è usabile a 390 px prima di aggiungere la nuova sezione.

### A1. Viewport, safe area, installabilità

- `app/layout.tsx`: `export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0a0b0f' }, { media: '(prefers-color-scheme: light)', color: '#f6f7f9' }] }`.
- `app/manifest.ts` (Next metadata route): `name`, `short_name: 'StudyHub'`, `display: 'standalone'`,
  `start_url: '/ripasso'`, `background_color`/`theme_color` dai token, icone 192/512 + maskable in `public/icons/`.
- `globals.css`: utility `pb-safe`/`pt-safe` su `env(safe-area-inset-*)`; `-webkit-tap-highlight-color: transparent`;
  `overscroll-behavior-y: contain` sul `<main>`.

### A2. Navigazione mobile (`AppShell`)

- **Fatto (PR 1)**: `components/MobileTabBar.tsx` (client, `md:hidden`, 56 px + safe area), figlio flex
  sotto `<main>` e non `position: fixed`, così `<main>` non ha bisogno di padding. Voci da `lib/nav.ts`
  (condiviso con la sidebar): **Dashboard · Materie · Calendario · Admin**, voce attiva con `usePathname`.
- **Fatto (PR 1)**: header con padding `safe-area-inset-top`; la CommandPalette resta solo `md+` (serve la
  tastiera); il bottone Aspetto e le sue opzioni sono alti 44 px sotto `md`.
- **PR 4**: "Ripasso" entra nella tab bar al posto di Admin (che passa a un menu `⋯` nell'header), con
  badge mono del numero di card in scadenza (`GET /api/review/overview`, §B2); `start_url` del manifest
  diventa `/ripasso`.
- **PR 4**: la tab bar si nasconde quando la sessione di ripasso (overlay full-screen) è aperta.

### A3. Audit pagina per pagina a 390×844

Checklist per ogni route (`/`, `/materie`, `/materie/[slug]` e tab, `/piano`, `/calendario`,
documento, sessione di studio, simulazione, risultati, admin): niente scroll orizzontale di pagina,
tabelle larghe in contenitore `overflow-x-auto`, toolbar che vanno a capo, target ≥ 44 px, dialog Radix a
tutta larghezza con `max-h-[90dvh]`. Correzioni note già da ora:

- `ReviewSessionClient`: togliere `h-dvh` (o portarlo in overlay come la nuova sessione), bottoni rating 44 px.
- `SessionClient`: le tre colonne diventano tab (già previsto da docs/08, verificare che sia implementato).
- `CalendarClient`/`PlanClient`: vista settimana → lista giornaliera sotto `md`.

Ogni correzione è piccola e isolata: un commit per pagina.

---

## 3. Fase B — Backend del ripasso trasversale

### B1. Coda unica, criteri unici (`lib/review.ts`)

- Estrarre `dueCardConditions(now)` condiviso da `getReviewQueue` e da `countDueCards*`:
  non sospese, **non segnalate**, materia non archiviata, `new` oppure `dueAt ≤ fine giornata`.
  Corregge la discrepanza attuale tra numero in dashboard e coda reale.
- `getReviewQueue(db, scope, options)` con `scope = { subjectSlug?: string; topicId?: string }`:
  senza materia attraversa tutte le materie attive. La firma per-materia resta come wrapper
  (nessuna regressione su `/materie/[slug]/review`).
- Ordine "tutte le materie": scadute per `dueAt`, con interleaving per materia (round-robin)
  così 10 card non sono 10 card della stessa materia.

### B2. Nuovi endpoint

- `GET /api/review/overview` → `ReviewOverviewDto`:
  `{ totalDue, subjects: [{ slug, name, color, nextExam: { title, date } | null, due, topics: [{ id, name, mastery: number|null, due }] }] }`.
  Una query aggregata `GROUP BY subject, topic` sulle condizioni di B1; card senza argomento → riga "Senza argomento".
- `GET /api/review/queue?materia=&argomento=&n=` → `ReviewQueueItemDto[]`:
  `FlashcardDto` + `subjectSlug`, `subjectName`, `subjectColor`, `topicName`, `intervals: { 1..4: string }`.
- Il rating riusa `POST /api/subjects/[slug]/review/[cardId]` (lo slug arriva dall'item);
  la risposta aggiunge `reviewId` e `dueAt`.

### B3. Annulla valutazione

- Migrazione `0021_review_undo.sql`: colonna `reviews.prev_schedule jsonb` (snapshot completo di
  `FlashcardSchedule` prima della review). Nullable: le review vecchie non sono annullabili.
- `submitReview` salva lo snapshot e restituisce `reviewId`.
- `DELETE /api/review/[reviewId]`: in transazione ripristina il flashcard dallo snapshot, cancella la riga
  `reviews`, ricalcola `recomputeTopicMastery`. Consentito solo per l'ultima review di quella card
  (409 altrimenti).

### B4. Intervalli in anteprima (`packages/core/src/fsrs.ts`)

- `previewIntervals(schedule, now): Record<FsrsRating, number /*ms*/>` via `scheduler.repeat`.
- `formatInterval(ms)` in `apps/web/src/lib/format.ts`: `<1 min`, `8 min`, `3 h`, `1 g`, `4 g`, `2 mesi`.
- Calcolati lato server nella coda (B2); dopo un "Di nuovo" la card ri-accodata usa il `dueAt` restituito.

### B5. Contratti (`packages/contracts/src/review.ts`)

`ReviewOverviewDtoSchema`, `ReviewQueueItemDtoSchema`, `SubmitReviewResponseSchema` (`reviewId`, `dueAt`),
esportati dal barrel.

---

## 4. Fase C — UI della sezione (solo mobile)

Struttura file:

```
app/ripasso/page.tsx                    server: legge searchParams, rende <QuickReviewClient>
components/quick-review/
  QuickReviewClient.tsx                 stato schermata (home | session | summary), React Query
  QuickReviewHome.tsx                   artboard 1
  QuickReviewSession.tsx                artboard 2-3 (overlay fixed inset-0)
  QuickReviewSummary.tsx                artboard 4
  SwipeCard.tsx                         pointer events + drag visivo
  CardActionsSheet.tsx                  modifica / sospendi / segnala / fonte
lib/quickReview.ts                      logica pura: coda, ri-accodamento, undo locale, riepilogo
```

`lib/quickReview.ts` porta 1:1 la logica del prototipo (`rate`, `undo`, `summary`) come funzioni pure
su `{ queue, idx, history }`: testabili senza DOM.

### C1. Home (artboard 1)

- Header su griglia tecnica (`bg-technical-grid`): data mono (`toLocaleDateString('it-IT', …)`),
  "Ripasso rapido", "**N** card in scadenza oggi".
- Segmented control "Card per sessione" 5 / 10 / Tutte (`aria-pressed`), scelta salvata in `localStorage`.
- Lista materie: riga = bottone avvio (pallino colore, nome, "N card · Esame 21 ott", contatore) +
  bottone chevron `aria-expanded` per gli argomenti. Argomento: nome, barra padronanza
  (`mastery` null → barra vuota e "—"), contatore, chevron. Materie/argomenti senza card: disabilitati e attenuati.
  Prima materia con card espansa di default.
- CTA fissa in basso "Ripassa tutto · 10 di 37" sopra la tab bar.
- Stati: caricamento (skeleton righe), errore (messaggio + Riprova), zero card ("Niente da ripassare oggi"
  - prossima scadenza), nessuna flashcard ancora (link alla generazione).

### C2. Sessione (artboard 2-3)

- Overlay `fixed inset-0 z-50`, `h-dvh`, safe area sopra/sotto; imposta `data-fullscreen` (A2).
- Header: chiudi (✕, senza conferma: ogni valutazione è già salvata),
  titolo "Materia · argomento" + `pos / total` mono, annulla (disabilitato senza history), `⋯`.
- Progress bar 3 px `role="progressbar"`.
- Card: briciola colore + "Materia · Argomento"; fronte con `CardText` (cloze, immagini, KaTeX già gestiti) e
  `revealPlan`; tap ovunque → rivela. A risposta visibile: domanda attenuata, separatore, label "RISPOSTA",
  retro, eventuale `hint` e citazione fonte; area scrollabile.
- Bottom: "Mostra risposta" (56 px) → poi griglia 4 bottoni 64 px Di nuovo/Difficile/Bene/Facile con intervallo,
  colori `--danger`/`--warn`/`--ok`/`--accent-hover`, hint "← di nuovo · bene →".
- Swipe (`SwipeCard`): `touch-action: pan-y`, la card segue il dito (`translateX` + leggera rotazione),
  tinta rossa/verde oltre soglia, rilascio sotto soglia → torna al centro; `navigator.vibrate?.(10)` al
  superamento soglia; disattivato con `prefers-reduced-motion` (resta il tap).
- Valutazione ottimistica: si avanza subito, la richiesta parte in background; in errore toast
  "Valutazione non salvata — Riprova" e la card resta in testa alla coda di invio (retry esponenziale ×3).
- Annulla: ripristino locale immediato + `DELETE /api/review/[reviewId]`.

### C3. Riepilogo (artboard 4)

- Check verde, "Sessione completata", titolo sessione.
- Tre tile: card ripassate, % al primo colpo (prima valutazione ≥ Bene), tempo medio per card ("6,1 s").
- Distribuzione valutazioni (barre orizzontali, colori dei rating).
- "Prossime scadenze": raggruppate da `dueAt` reale (Oggi / Domani / Tra N giorni).
- CTA "Ripassa gli errori **N**" (solo se N > 0) e "Torna alle materie"; invalidano `review-overview`.

### C4. Tema, accessibilità, gate desktop

- Solo token (`bg-bg-surface`, `text-fg-secondary`, …): il prototipo usa hex scuri fissi, qui deve funzionare anche
  `data-theme=light`. Contrasti ≥ 4.5:1 (il grigio `#8A93A6` del prototipo → `text-fg-secondary`).
- Bottoni veri, `aria-label` sulle icone, focus visibile, annuncio `aria-live="polite"` della card successiva.
- `/ripasso` a `≥ md`: blocco `hidden md:flex` con rimando ai ripassi per materia; il contenuto mobile è `md:hidden`.

---

## 5. Test

- **Vitest** `packages/core`: `previewIntervals` (ordine crescente 1<2<3<4, card nuova vs in review).
- **Vitest** `apps/web` (pglite, come gli altri test di `lib/`): coda trasversale (esclude segnalate/sospese/archiviate,
  interleaving, `n`), overview coerente con la coda, undo (ripristino esatto, 409 se non è l'ultima),
  `countDueCards` allineato.
- **Vitest** `lib/quickReview.ts`: ri-accodamento "Di nuovo", undo dopo ri-accodamento, metriche del riepilogo
  (stessi casi del prototipo: 8 valutazioni → 6 card, 67% al primo colpo).
- **Playwright**: nuovo project `mobile` (`devices['Pixel 7']`) in `playwright.config.ts`;
  `e2e/ripasso-mobile.spec.ts`: home → espandi materia → avvia argomento → rivela → swipe → undo → riepilogo →
  ripassa errori. Più uno smoke "nessuno scroll orizzontale" su ogni route della Fase A
  (`document.documentElement.scrollWidth <= innerWidth`). Test desktop: tab bar e link Ripasso assenti.

---

## 6. Ordine di consegna (PR)

1. **PR 1 — Shell mobile** (A1, A2): viewport, manifest, tab bar, header mobile. Nessuna feature nuova.
2. **PR 2 — Audit responsive** (A3): fix per pagina + smoke Playwright mobile.
3. **PR 3 — Backend ripasso trasversale** (B1–B5): migrazione, endpoint, contratti, test. Il ripasso desktop
   per materia beneficia già di criteri unificati e undo.
4. **PR 4 — UI Ripasso rapido** (C1–C4): home, sessione, riepilogo, e2e mobile.
5. **PR 5 — Rifinitura**: animazioni swipe, haptics, stati vuoti, badge tab bar.

## 7. Fuori scope / dopo

- Offline-first (service worker + outbox delle valutazioni in IndexedDB, sync al ritorno online): richiede
  di rendere `submitReview` idempotente (`clientReviewId`) — predisposizione consigliata già in B3.
- Task del giorno su mobile e cattura schemi da fotocamera (resto di docs/06 #11).
- Notifiche push "hai N card in scadenza".
