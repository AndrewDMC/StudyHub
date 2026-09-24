# F2 — Materie & Materia Singola

## Obiettivo

La materia ha una pagina che è un vero centro di controllo: tutto raggiungibile, niente scroll infinito.

## Scope

**Pagina Materie**: griglia di card (nome, colore, prossimo esame + countdown, % mastery,
card in scadenza oggi, n. documenti, barra di copertura argomenti). Azioni: crea, modifica, archivia, elimina
(con conferma che dice **esattamente** cosa viene cancellato sul disco), riordina, filtra, ricerca.

**Pagina Materia Singola** — layout a 3 colonne:

- _Sinistra (240px)_: albero Argomenti con heatmap di mastery, filtro globale della pagina.
- _Centro_: tab `Panoramica | Appunti | Schemi | Esami | Flashcard | Simulazioni | Piano`.
  La Panoramica è la vista di default: prossimo esame, 3 azioni consigliate, attività recente, gap rilevati.
- _Destra (320px, collassabile)_: **pannello AI contestuale** — le azioni disponibili cambiano in base
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

## Stato: slice non-AI implementata (2026-09-22)

Come per F1, implementata solo la parte che non dipende da un provider AI o da dati che non
esistono ancora (FSRS/F4, simulazioni/F5). **Non implementato**: pannello AI contestuale (azioni
che seguono la selezione), merge argomenti con riattacco di flashcard/chunk (non esistono ancora
flashcard), mastery calcolata (resta `null` finché F4/F5 non esistono), layout a 3 colonne
virtualizzato per 200+ documenti/2000+ flashcard, tab Flashcard/Simulazioni/Piano (F4/F5/F6).

Cosa c'è, con test reali (144 test totali nel monorepo):

- **Tabelle `exams` e `topics`** (migrazione `0002_exams_topics.sql`), `topics.parent_id`
  auto-referenziato con `ON DELETE CASCADE` per l'albero.
- **Griglia Materie**: conteggio documenti e countdown del prossimo esame calcolati via
  aggregazione SQL (`apps/web/src/lib/subjects.ts::listSubjectSummaries`, con `filter (where
status = 'scheduled' and date > now())` per ignorare esami passati o annullati — testato).
  Le materie archiviate sono nascoste di default, toggle "Mostra archiviate".
- **Archiviazione**: reversibile, non tocca il filesystem (`archived_at` nullable).
- **Eliminazione definitiva**: sposta la cartella in `/data/.trash/<timestamp>-<slug>/`
  (mai `rm -rf`, `packages/core/src/trash.ts`), poi rimuove la riga DB — i cascade ripuliscono
  documents/chunks/exams/topics/jobs collegati. La UI mostra il path esatto prima di confermare
  (`SubjectActions.tsx`), come richiesto in "Decisioni".
- **Argomenti**: CRUD utente (crea/rinomina/riassegna genitore/elimina), sempre `source: 'user'`
  in questa fase — nessuna proposta AI. Pagina materia a 2 click da Materie (criterio di
  accettazione soddisfatto per la parte di navigazione, non per il merge).
- **Esami**: CRUD, ordinati per data, usati sia per il countdown in griglia sia in un pannello
  nella pagina materia.

Verificato in browser reale (senza Postgres, come in F1): nessun errore di render/hydration sulle
nuove pagine/componenti nel percorso di errore; il flusso funzionale completo (creare argomento,
esame, archiviare, eliminare) è coperto solo dai test automatici con pglite, non da un click reale
in browser — richiederebbe un Postgres raggiungibile che non è disponibile in questo ambiente.
