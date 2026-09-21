# Design System — "Calm Futurism"

## 1. Direzione
Futuristico = **strumentale**, non scenografico. Riferimenti: Linear, Vercel, Arc, un terminale ben fatto,
la strumentazione di un cockpit. Anti-riferimenti: dashboard "sci-fi" con neon, HUD circolari, glassmorphism,
gradienti arcobaleno, glow su ogni bordo.

**Test di validazione**: se un elemento non aiuta a decidere cosa studiare, va rimosso.
Il colore non decora: **il colore significa**.

## 2. Token

### Colore — dark-first (light come tema completo, non ripiego)
```css
/* superfici: neutri freddi, mai neri puri */
--bg-base:   #0A0B0F;   --bg-surface: #111318;  --bg-raised: #171A21;
--bg-inset:  #0D0E13;   --border:     #22262F;  --border-strong: #2E3441;

/* testo */
--fg-primary: #E8EAF0;  --fg-secondary: #9BA3B4; --fg-muted: #626B7D;

/* accento unico — usato con parsimonia, solo per l'azione primaria e lo stato attivo */
--accent:     #5B8CFF;  --accent-hover: #7AA2FF; --accent-subtle: #5B8CFF1A;

/* semantica dei dati (l'unico altro uso legittimo del colore) */
--ok: #3DD68C;   --warn: #F5B544;   --danger: #FF6B6B;   --info: #4ECDC4;

/* mastery scale (heatmap argomenti) — percettivamente uniforme */
--m-0:#2E3441 --m-1:#3C4A6B --m-2:#42648F --m-3:#3E85A8 --m-4:#3DA88C --m-5:#3DD68C
```
Materie: palette di **8 tinte assegnate** (violet, blue, cyan, teal, green, amber, rose, magenta),
usate solo come accento d'identità (bordo sinistro card, punto colore), mai come riempimento di grandi aree.

### Tipografia
- UI: **Inter** (o Geist), `-2%` letter-spacing sui titoli.
- Numeri/dati: **Geist Mono** o `font-variant-numeric: tabular-nums` — obbligatorio in ogni tabella e KPI.
- Codice/formule: JetBrains Mono; formule in KaTeX.
- Scala: 11 · 12 · 13 · **14 (base)** · 16 · 20 · 24 · 32. Base 14px: è un'app densa, non un sito.
- Peso: 400 corpo, 500 label, 600 titoli. Mai 700+.

### Spazio e forma
- Griglia **4px**. Spazi: 4·8·12·16·24·32·48.
- Radius: 6px (controlli), 10px (card), 14px (modali). Niente pill se non per i tag.
- Ombre: quasi assenti. La profondità si fa con **superfici e bordi**, non con blur.
- Bordi 1px `--border`; lo stato attivo si segnala con bordo `--accent` + `--accent-subtle` di sfondo.

### Movimento
- Durate: 120ms (hover/feedback), 200ms (pannelli), 320ms (transizioni di pagina).
- Easing: `cubic-bezier(0.2, 0, 0, 1)`.
- Consentito: fade+translate 4px, skeleton shimmer, progress determinato, conteggi animati.
- Vietato: parallax, rotazioni, pulse infiniti, elementi che si muovono mentre leggi.
- `prefers-reduced-motion` rispettato ovunque.

## 3. L'unico effetto "futuristico" permesso
Una texture di sfondo a **griglia tecnica** (linee 1px, opacità 3%, 32px) sulle aree vuote/header,
e un **hairline glow** (1px, `--accent`, opacità 30%) solo sull'elemento con focus corrente.
Un accento, una firma. Nient'altro.

## 4. Componenti core
`AppShell` (sidebar 240px collassabile a 56px + topbar 48px con command palette) ·
`StatTile` (numero tabular + delta + sparkline) · `SubjectCard` · `TopicHeatBar` ·
`TaskRow` (checkbox, kind-icon, durata, deep-link, drag handle) · `DocumentChip` (tipo + pagine + stato) ·
`JobToast` (progress + costo + cancel) · `ModelPicker` (modello + costo stimato) ·
`CalendarMonth/Week/Agenda` · `FlashcardReview` (full-screen, zero cromo) ·
`ArtifactCard` (draft/approved + fonte) · `SourceLink` (chip → apre PDF alla pagina).

## 5. Densità e layout
- Larghezza max contenuto 1440px, sidebar fissa.
- **Tre livelli di densità** (comfortable / compact / dense) come preferenza utente: chi studia 6h/giorno vuole dense.
- Tastiera prima: `⌘K` command palette, `G poi D/M/C` navigazione, `N` nuovo, `Space` review, `1-4` rating FSRS.
  Ogni azione primaria ha una scorciatoia mostrata nel tooltip.

## 6. Accessibilità (requisito, non extra)
Contrasto ≥ 4.5:1 sul testo, ≥ 3:1 su bordi e grafici. Focus ring visibile sempre.
Il colore non è mai l'unico veicolo d'informazione (heatmap = colore **+** numero).
Target touch ≥ 40px. Tutti i modali con focus trap e `Esc`.

## 7. Stati obbligatori per ogni schermata
Ogni pagina è progettata in 5 stati, non solo quello pieno:
**empty** (con next-action chiara) · **loading** (skeleton, non spinner) · **partial** (job in corso) ·
**error** (causa + rimedio + retry) · **full**.
Gli stati vuoti sono la prima cosa che l'utente vede: sono schermate di onboarding travestite.
