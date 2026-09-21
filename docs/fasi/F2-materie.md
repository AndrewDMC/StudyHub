# F2 — Materie & Materia Singola

## Obiettivo
La materia ha una pagina che è un vero centro di controllo: tutto raggiungibile, niente scroll infinito.

## Scope
**Pagina Materie**: griglia di card (nome, colore, prossimo esame + countdown, % mastery,
card in scadenza oggi, n. documenti, barra di copertura argomenti). Azioni: crea, modifica, archivia, elimina
(con conferma che dice **esattamente** cosa viene cancellato sul disco), riordina, filtra, ricerca.

**Pagina Materia Singola** — layout a 3 colonne:
- *Sinistra (240px)*: albero Argomenti con heatmap di mastery, filtro globale della pagina.
- *Centro*: tab `Panoramica | Appunti | Schemi | Esami | Flashcard | Simulazioni | Piano`.
  La Panoramica è la vista di default: prossimo esame, 3 azioni consigliate, attività recente, gap rilevati.
- *Destra (320px, collassabile)*: **pannello AI contestuale** — le azioni disponibili cambiano in base
  alla selezione corrente (selezioni 2 documenti → "genera flashcard da questi 2"; selezioni un argomento →
  "drill su questo argomento"). È qui che il prodotto diventa fluido: **l'azione AI segue la selezione**.

## Decisioni
- **Selezione come stato di prima classe**: un `SelectionContext` (documenti + argomenti) condiviso
  fra albero, tab e pannello AI. È il pattern che evita 12 modali diversi.
- **Argomenti editabili**: rinomina, unisci, sposta, elimina, crea a mano. L'AI propone, l'utente possiede la tassonomia.
- Eliminazione materia: default = archivia (nasconde, non tocca il disco). `Elimina definitivamente` sposta
  la cartella in `/data/.trash/` con timestamp, non `rm -rf`.

## Criteri di accettazione
- [ ] Da Materie a un argomento specifico in ≤2 click.
- [ ] Seleziono 3 documenti e il pannello destro offre le azioni giuste, con costo stimato.
- [ ] Unisco due argomenti duplicati: flashcard e chunk si riattaccano correttamente.
- [ ] Archivio una materia: sparisce dalla dashboard, la cartella resta intatta.
- [ ] La pagina con 200 documenti e 2000 flashcard resta reattiva (virtualizzazione liste).

## Rischi
- Sovraccarico cognitivo: 7 tab + albero + pannello è tanto. Mitigazione: la Panoramica risponde da sola all'80%
  dei casi; le tab sono per il lavoro mirato. Testare con dati reali, non con 3 righe finte.
