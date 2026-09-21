# Canonical Markdown Layer & Trascrizione degli schemi

> Decisione fondante: **il Markdown non è un output del sistema, è il suo formato canonico.**
> Ogni documento, qualunque sia la sorgente (PDF, PNG, foto, DOCX, slide, trascrizione), viene normalizzato
> in Markdown. Tutto ciò che sta a valle — flashcard, riassunti, simulazioni, RAG, Planner — legge **solo**
> il Markdown. Nessun processo a valle apre mai il file originale.

---

## 1. Perché

1. **Un solo formato da gestire a valle.** Senza questo layer, ogni funzione AI dovrebbe sapere come si
   estrae il testo da 6 formati diversi. Con questo layer, ne conosce uno.
2. **Ispezionabilità.** Se una flashcard è sbagliata, apri il `.md` e vedi esattamente cosa ha letto il modello.
   Senza, il debug è impossibile.
3. **Correggibilità.** La normalizzazione sbaglia. Se l'artefatto intermedio è un file di testo, lo correggi
   in 10 secondi e tutto il resto migliora. Se è un blob in un DB, non lo correggi mai.
4. **Interoperabilità.** I `.md` vivono dentro la cartella della materia su disco: si aprono in Obsidian, si
   versionano con git, si cercano con grep. Coerente con P1 e P7 (`docs/00-vision.md`).
5. **Il tuo workflow reale.** Vai a lezione, prendi appunti, li pulisci, ne fai schemi. StudyHub si innesta su
   quel flusso invece di sostituirlo: la "pulizia" diventa un passaggio assistito, non un lavoro da rifare.

## 2. Posizione nel filesystem

```
subjects/fisica-1/
├─ sources/appunti/2026-01-12-termodinamica.pdf     # originale, IMMUTABILE
└─ derived/<docId>/
   ├─ content.md          # <-- IL FORMATO CANONICO
   ├─ content.orig.md     # prima versione generata, mai toccata (per il diff)
   ├─ assets/             # ritagli di figure, formule non trascrivibili, regioni di schema
   │   ├─ p1-fig1.png
   │   └─ p1-crop-n7.png
   └─ meta.json           # sha del sorgente, pipeline, modello, confidenza, flag edited
```

**Regola di stickiness**: se `content.md` differisce da `content.orig.md`, il file è marcato `edited: true`.
Un re-ingest **non lo sovrascrive mai**: genera `content.new.md` e apre un conflitto risolvibile in UI.
Le tue correzioni non si perdono per una rigenerazione accidentale.

## 3. Specifica del Canonical Markdown

### 3.1 Front-matter (obbligatorio)
```yaml
---
docId: 01HX...
subject: fisica-1
kind: appunti | schema | esame | slide | altro
title: "Termodinamica - Primo principio"
lang: it
source: { file: "sources/appunti/2026-01-12.pdf", pages: 24, sha256: "..." }
pipeline: { extractor: "vision", model: "claude-sonnet-5", promptVersion: 3, at: "2026-01-12T10:04Z" }
confidence: { overall: 0.94, uncertainBlocks: 3, unreadableBlocks: 0 }
edited: false
topics: [termodinamica, primo-principio, trasformazioni]
---
```

### 3.2 Corpo — sintassi ammessa e vincoli
- **Heading** `#`..`####` che riflettono la gerarchia reale del documento, non la dimensione del font.
- **Ancore di pagina**: `<!--p:12-->` prima di ogni blocco che cambia pagina. Non negoziabile: senza,
  le citazioni delle flashcard non sono verificabili (principio P3).
- **Formule** in LaTeX: `$...$` inline, `$$...$$` display. Mai "descrizioni" testuali di una formula.
- **Callout tipizzati** per i blocchi semanticamente rilevanti, che a valle diventano candidati flashcard:
  ```
  > [!definizione] Entalpia
  > H = U + pV

  > [!teorema] Primo principio
  > ...
  > [!esempio] / [!formula] / [!attenzione] / [!domanda]
  ```
- **Tabelle** in markdown standard.
- **Figure non trascrivibili** come immagine ritagliata: `![Ciclo di Carnot](assets/p8-fig2.png)` con
  didascalia che descrive cosa mostra. Una figura non va "raccontata" dentro il testo: va ritagliata e linkata.
- **Marcatori di incertezza** (vedi §5): `⟨?parola⟩` inline, e `<!--conf:uncertain n7-->` a livello di blocco.
- **Ancore di nodo**: `^n7` a fine riga, per collegare il blocco al grafo (schemi) e ai ritagli.

### 3.3 Cosa NON deve fare la normalizzazione
- Non riassume, non riformula, non "migliora" il testo. È **trascrizione strutturata**, non riscrittura.
  Il riassunto è una funzione separata, esplicita e approvata dall'utente.
- Non inventa heading dove non ci sono. Se il documento è piatto, il markdown è piatto.
- Non completa frasi interrotte né colma lacune. Un buco resta un buco marcato.

## 4. Pipeline di normalizzazione (job `normalize_markdown`)

```
sorgente
  ├─ PDF con layer testo   → estrazione strutturale (mupdf) → riallineamento heading → md
  ├─ PDF scansionato       → rasterizza pagine → ramo "vision"
  ├─ PNG/JPG (foto)        → preprocessing → ramo "vision"
  ├─ DOCX/PPTX             → conversione diretta (mammoth/pptx parser) → md
  └─ audio lezione         → Whisper locale → md con timestamp
```

**Preprocessing immagini** (deterministico, pre-AI): deskew, dewarp prospettico, normalizzazione contrasto,
rimozione ombre, upscale se < 1600px sul lato lungo, split automatico se la pagina contiene più regioni
staccate. Una foto storta e scura fa fallire qualunque modello: questo step vale più di mezzo prompt.

**Ramo vision**: la pagina viene letta dal modello multimodale. **Nessun OCR tradizionale.**
Tesseract su scrittura a mano corsiva con simboli matematici produce spazzatura, e la spazzatura si propaga
fino alle flashcard. Per i PDF a stampa scansionati, OCR resta un'opzione economica di primo tentativo con
fallback a vision se la confidenza è bassa.

**Tiling per pagine dense**: se la pagina supera una certa densità o dimensione (A3, schema grande),
viene divisa in tile con overlap del 15%, letta a tile, e i risultati vengono riuniti deduplicando la zona
di sovrapposizione. Un modello che legge un A3 intero a bassa risoluzione perde le annotazioni piccole.

**Costo**: la trascrizione vision è la voce più cara del sistema. Routing: `claude-sonnet-5` di default,
retry su `claude-opus-5` solo per le pagine con confidenza sotto soglia. Prompt caching sul profilo di grafia
e sul vocabolario di contesto.

---

## 5. Trascrizione degli schemi scritti a mano

È il caso più difficile e il più prezioso: gli schemi sono il tuo materiale già digerito.

### 5.1 Il problema
Uno schema disegnato a mano porta informazione su **due canali**:
- **testuale** — le parole nei riquadri;
- **strutturale/spaziale** — frecce, raggruppamenti, gerarchia, adiacenza, colori, riquadri.

Appiattire in markdown lineare conserva il primo e distrugge il secondo, che è esattamente la parte che
hai codificato tu quando l'hai disegnato. Un riassunto generato da uno schema appiattito perde le relazioni
causali e diventa un elenco.

### 5.2 La soluzione: Markdown + grafo tipizzato

Un solo file, due livelli di lettura. Il **corpo markdown** è la lettura lineare dello schema (quello che si
dà in pasto alle funzioni AI a valle, greppabile e leggibile). Il **front-matter** conserva il grafo.

```markdown
---
docId: 01HY...
kind: schema
schema:
  nodes:
    n1: { label: "Primo principio", kind: principio, crop: "p1@[120,340,480,410]", conf: ok }
    n2: { label: "Q calore scambiato", kind: grandezza, crop: "p1@[140,430,420,480]", conf: ok }
    n7: { label: "Trasf. adiabatica", kind: caso,      crop: "p1@[500,620,760,690]", conf: uncertain }
  edges:
    - { from: n1, to: n2, type: composto-da }
    - { from: n1, to: n7, type: implica, label: "Q = 0" }
    - { from: n7, to: n9, type: esempio-di }
  groups:
    g1: { label: "Trasformazioni", nodes: [n7, n8, n9] }
confidence: { overall: 0.88, uncertainBlocks: 1, unreadableBlocks: 0 }
---

## Primo principio  ^n1
<!--p:1-->
$\Delta U = Q - L$

- **Q** calore scambiato ^n2
- **L** lavoro compiuto dal sistema ^n3

### Trasformazioni ^g1

#### Trasformazione adiabatica ^n7   <!--conf:uncertain-->
Implica $Q = 0$, quindi $\Delta U = -L$.
```

**Tassonomia minima dei tipi** (chiusa, non libera — altrimenti il modello inventa):
- `node.kind`: `concetto | definizione | formula | principio | grandezza | caso | esempio | condizione | conseguenza | domanda`
- `edge.type`: `implica | causa | composto-da | esempio-di | opposto-a | precede | dipende-da | annota`

Un vocabolario chiuso rende il grafo interrogabile e confrontabile fra schemi diversi. Un vocabolario libero
produce 40 sinonimi di "porta a" e rende il grafo inutile.

### 5.3 Formati di rendering (derivati, mai sorgente)
Dal grafo si generano su richiesta:
- **Mermaid** per la visualizzazione in app;
- **JSON Canvas** (`.canvas`) esportato nella cartella della materia, apribile in Obsidian;
- **SVG** per l'export e la stampa.

*Perché Mermaid non è il formato di archiviazione*: sintassi fragile che i modelli generano spesso rotta,
impossibile attaccare metadati per nodo (confidenza, ritaglio sorgente), diff illeggibili, nessuna validazione.
Una sorgente, più render.

### 5.4 Le tre leve che fanno funzionare la trascrizione

**(a) Ancoraggio al materiale esistente — la leva più forte.**
Prima di leggere lo schema, il sistema recupera per similarità i chunk degli **appunti della stessa materia e
argomento** già in indice, ed estrae un **vocabolario di contesto** (termini tecnici, nomi, simboli ricorrenti,
formule note) che viene passato al modello insieme all'immagine.
Il modello non deve indovinare una parola illeggibile: sa già che in quel capitolo esistono "entalpia",
"isocora", "adiabatica". Questo elimina la maggior parte degli errori di trascrizione, e costa quasi nulla
perché i chunk esistono già da F1.
È il vantaggio strutturale di StudyHub: **gli schemi nascono dai tuoi appunti, che il sistema ha già letto.**

**(b) Profilo di grafia progressivo.**
`subjects/<slug>/.studyhub/handwriting-profile.md` (più uno globale) accumula le convenzioni personali
apprese dalle correzioni: abbreviazioni usate, forma dei simboli ambigui, significato delle frecce doppie,
uso dei colori, come scrivi le lettere greche.
Ogni correzione fatta in verifica viene distillata in una riga del profilo (job `distill_handwriting_profile`,
modello haiku, costo trascurabile). Il profilo entra nei prompt successivi come blocco cacheable.
Dopo 4-5 schemi corretti la qualità sale in modo evidente, senza alcun fine-tuning.

**(c) Doppia passata.**
1. *Lettura*: descrizione fedele della pagina — cosa c'è scritto e dove, quali frecce collegano cosa.
   Nessuna strutturazione, nessuna interpretazione.
2. *Strutturazione*: dalla descrizione al grafo tipizzato e al markdown.
Separare le due fasi riduce nettamente gli errori rispetto a chiedere tutto in una volta: nella singola
passata il modello "completa" la struttura inventando testo.

### 5.5 Confidenza e regola dura di qualità

Ogni nodo riceve `conf: ok | uncertain | unreadable`. Istruzione esplicita nel prompt:
**marcare `⟨?⟩` invece di indovinare** — un'incertezza dichiarata è un dato utile, una parola inventata è
un danno che si propaga fino al ripasso.

> **Regola dura**: un blocco `uncertain` o `unreadable` **non può generare flashcard, riassunti o simulazioni**
> finché non viene confermato dall'utente. I job a valle lo escludono e segnalano quanti blocchi sono bloccati.

Costa un passaggio di verifica. L'alternativa è ripassare per tre settimane una card costruita su una parola
letta male: è il tipo di errore che distrugge la fiducia nello strumento e non si scopre mai da soli.

### 5.6 Schermata di verifica (UI)
Split verticale: a sinistra l'immagine originale con i **bounding box dei nodi evidenziati**, a destra il
markdown/grafo editabile. Navigazione `Tab` **solo fra i nodi dubbi** — non si rilegge tutto, si conferma
il 5% incerto. Click su un nodo a destra = evidenzia il ritaglio a sinistra e viceversa.
Azioni: conferma, correggi, unisci nodi, cambia tipo di arco, elimina, "illeggibile, escludi".
In alto: barra di avanzamento "3 nodi da verificare su 42" e pulsante `Approva schema`.

### 5.7 Cosa sblocca il grafo (valore a valle)
- **Flashcard relazionali**: dagli archi si generano card che le funzioni testuali non potrebbero produrre —
  *"Cosa implica Q = 0 in una trasformazione?"*, *"Di cosa è caso particolare l'adiabatica?"*.
- **Gap analysis strutturale**: confronto fra il grafo dello schema e i topic estratti dagli appunti →
  *"lo schema non copre le trasformazioni isocore, presenti negli appunti a p. 61"* (già previsto in F1 per gli schemi).
- **Ordine di studio**: gli archi `precede` e `dipende-da` sono prerequisiti reali, dichiarati da te,
  e diventano input di qualità per la Fase A del Planner — molto meglio dei prerequisiti inferiti dall'AI.
- **Mappa unificata della materia**: merge dei grafi di più schemi in un'unica mappa navigabile, con la
  heatmap di mastery proiettata sopra.

## 6. Nuovi job introdotti

| Job | Input | Output | Modello |
|---|---|---|---|
| `normalize_markdown` | docId | `derived/<docId>/content.md` | sonnet (vision) / nessuno (PDF testuale) |
| `transcribe_schema` | docId (kind=schema) | markdown + grafo + crops | sonnet, retry opus |
| `build_vocab_context` | subjectId, topicIds | vocabolario di contesto | nessuno (retrieval) |
| `distill_handwriting_profile` | correzioni utente | righe del profilo | haiku |
| `merge_schema_graphs` | schemaIds[] | mappa unificata | nessuno (deterministico) |

## 7. Criteri di accettazione del layer
- [ ] Un PDF a stampa, una foto di appunti e una foto di schema producono tutti un `content.md` valido
      con ancore di pagina.
- [ ] Correggo `content.md` a mano, rilancio l'ingest: la mia versione sopravvive e il conflitto è mostrato.
- [ ] Uno schema fotografato produce un grafo con nodi, archi tipizzati e ritagli allineati.
- [ ] I nodi incerti sono verificabili in meno di 60 secondi per schema.
- [ ] Una flashcard non può essere generata da un nodo non verificato (test automatico).
- [ ] Dopo 5 schemi corretti, il profilo di grafia contiene regole sensate e riduce le incertezze misurabilmente.
- [ ] Il `.canvas` esportato si apre correttamente in Obsidian.
