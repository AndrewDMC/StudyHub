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

## 8. Mockup di riferimento
**[StudyHub Interface — mockup completo](https://claude.ai/artifact/BFcYbQ67tF5DuaFbPnNSEu)**
(artifact HTML statico navigabile, generato dal [prompt di design](design/prompt-mockup.md))

È la **fonte di verità visiva** di questo documento: dove testo e mockup divergono, prima si decide, poi si
allinea il perdente. Contiene 15 viste, selezionabili dal navigatore in basso a destra:

| # | Vista | # | Vista |
|---|---|---|---|
| 00 | Style guide (token + componenti in tutti gli stati) | 08 | Materia · Appunti con selezione attiva |
| 01 | Dashboard | 09 | Review queue artefatti |
| 02 | Upload materiali | 10 | Sessione di ripasso (full-screen) |
| 03 | Triage documenti | 11 | Planner · Anteprima e fattibilità |
| 04 | Verifica trascrizione schema | 12 | Revisione e conferma del piano |
| 05 | Materie | 13 | Calendario · vista mese |
| 06 | Materia · Panoramica | 14 | Stati e sistema |
| 07 | Materia · Schemi (mappa dei grafi) | | |

La vista `00 Style guide` è quella da consultare in fase di implementazione: mostra ogni componente core
(§4) nei suoi stati default / hover / active / focus / disabled / loading / error.

### Scostamenti noti dal testo di questo documento
Il mockup è più recente; questi punti vanno riconciliati quando si scrive il codice:
- **Griglia tecnica**: il mockup usa 24px, qui è scritto 32px.
- **Hairline attivo**: nel mockup è un `box-shadow: inset 0 0 0 1px var(--accent)` pieno, non un glow al 30%.
- **Mono**: il mockup usa JetBrains Mono anche per i numeri; qui l'alternativa era Geist Mono.
- **Densità**: il mockup realizza solo il livello `compact`; i tre livelli (§5) restano da progettare.
- **Sidebar**: nel mockup è fissa a 240px; il collasso a 56px (§4) non è mockuppato.

### Non ancora prodotto
Varianti opzionali elencate in fondo al prompt: **tema light**, **PWA mobile 390×844**,
**flusso di cattura schemi da telefono**, e la conversione della style guide in **componenti React + Tailwind**.
