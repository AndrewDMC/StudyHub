# Prompt per la generazione dei mockup

Copia tutto il blocco sottostante in una conversazione dedicata al design.
È autosufficiente: non richiede di aver letto il resto della knowledge base.

---

## PROMPT

Sei un product designer senior specializzato in strumenti professionali ad alta densità informativa
(referenze: Linear, Vercel Dashboard, Arc, Raycast, Height). Devi progettare i mockup ad alta fedeltà di
**StudyHub**, una piattaforma self-hosted che trasforma materiale di studio grezzo in un piano quotidiano
di azioni verso un esame.

Produci i mockup come **artifact HTML statici e navigabili** (un file unico con navigazione fra le schermate),
usando HTML + CSS. Niente framework, niente backend: sono mockup visivi, ma devono essere pixel-accurati
e realistici, non wireframe.

### Principio guida
Futuristico significa **strumentale e calmo**, non scenografico. L'interfaccia è uno strumento di precisione
per qualcuno che ci passa 6 ore al giorno: densità, gerarchia, silenzio visivo.
Regola di validazione da applicare a ogni elemento che disegni:
*se non aiuta a decidere cosa studiare adesso, va rimosso.*

**Vietato esplicitamente**: neon, glow diffusi, glassmorphism, gradienti multicolore, raggi di bordo oltre 14px,
ombre marcate, illustrazioni decorative, emoji come icone, HUD circolari, animazioni ambientali, grafici 3D,
"AI sparkle" ovunque.
**Consentito come unica firma futuristica**: una griglia tecnica di sfondo a linee 1px al 3% di opacità sugli
header e sulle aree vuote, e un hairline da 1px in colore accento sull'elemento attivo.

### Design token (usali esattamente, sono vincolanti)
```
Superfici (dark-first):  bg-base #0A0B0F · surface #111318 · raised #171A21 · inset #0D0E13
Bordi:                   #22262F · strong #2E3441
Testo:                   primary #E8EAF0 · secondary #9BA3B4 · muted #626B7D
Accento (uno solo):      #5B8CFF · hover #7AA2FF · subtle #5B8CFF1A
Semantica:               ok #3DD68C · warn #F5B544 · danger #FF6B6B · info #4ECDC4
Scala mastery (heatmap): #2E3441 -> #3C4A6B -> #42648F -> #3E85A8 -> #3DA88C -> #3DD68C
Identità materie:        violet, blue, cyan, teal, green, amber, rose, magenta
                         (solo come bordo sinistro 2px o punto colore 6px, mai come fondo ampio)
Tipografia:              Inter (UI, -2% letter-spacing sui titoli) · mono tabular-nums per TUTTI i numeri
Scala type:              11 · 12 · 13 · 14 (base) · 16 · 20 · 24 · 32
Pesi:                    400 corpo · 500 label · 600 titoli (mai oltre)
Griglia:                 4px · spazi 4/8/12/16/24/32/48
Radius:                  6px controlli · 10px card · 14px modali
Profondità:              solo tramite superfici e bordi 1px, quasi nessuna ombra
```
Viewport di riferimento: **1512 × 982**. Sidebar 240px, topbar 48px, contenuto max 1440px.

### Contesto di dominio (serve per scrivere contenuti realistici)
Utente: studente universitario di ingegneria. Materie da usare nei mockup:
**Fisica 1** (esame 15 gen, viola), **Analisi 2** (esame 28 gen, blu), **Chimica** (esame 9 feb, teal),
**Diritto Privato** (archiviata, ambra).
Argomenti d'esempio per Fisica 1: Cinematica, Dinamica, Lavoro ed Energia, Termodinamica, Fluidi, Onde.
Usa dati **plausibili e non tondi** (347 card, 73%, 2h 45m, 12 gg), mai lorem ipsum, mai placeholder generici.
Lingua dell'interfaccia: **italiano**.

### Due concetti di dominio che devi capire prima di disegnare

**(a) Ogni documento diventa Markdown.** PDF, foto di appunti e foto di schemi disegnati a mano vengono
normalizzati in un Markdown canonico, che è l'unico formato che le funzioni AI leggono. Per gli schemi scritti
a mano viene estratto anche un **grafo** di nodi e frecce tipizzate. La trascrizione può sbagliare: i blocchi
incerti sono marcati e **devono essere verificati dall'utente** prima di poter generare flashcard.
Questo introduce un concetto visivo ricorrente: **lo stato di confidenza** (ok / incerto / illeggibile) e il
**conteggio dei blocchi bloccati**.

**(b) Il piano di studio è una proposta finché non viene confermato.** Il Planner genera una bozza di task
che l'utente rivede, modifica e solo allora conferma: al commit le task entrano nel calendario e nella
dashboard. Prima del commit sono invisibili al resto dell'app. Questo introduce il concetto di
**bozza vs attivo** e, per i ricalcoli, di **diff da approvare**.

### Schermate da produrre (14, in quest'ordine)

**1. Dashboard** — la schermata più importante. Griglia a 12 colonne:
- riga di 4 stat tile: giorni al prossimo esame (con nome materia), minuti pianificati oggi, card in scadenza,
  mastery media — ognuno con delta settimanale e micro-sparkline da 1px;
- "Oggi" (col. 1–7): in cima **una sola next-action consigliata**, grande e inequivocabile, con CTA; sotto le task
  del giorno raggruppate per fascia (mattina / pomeriggio / sera), ogni riga con checkbox, icona del tipo di task,
  durata stimata, materia (punto colore), deep-link al materiale e drag handle;
- "Flashcard per materia" (col. 8–12): per ogni materia una barra impilata new / learning / review / a-rischio
  più il forecast a 7 giorni;
- "Caricamento rapido" (col. 8–12): dropzone discreta, sempre presente;
- "Prossimi 14 giorni" (col. 1–7): striscia calendario compatta con esami evidenziati e carico giornaliero
  come barra verticale;
- footer attività: job recenti, artefatti in attesa di approvazione, un avviso del Planner
  (es. "2 schemi hanno blocchi da verificare").

**2. Upload / Selezione materiali** — stato di drag attivo con 6 file in coda (3 PDF, 2 foto di schemi, 1 DOCX),
progress per file, un duplicato rilevato, un file in errore, selettore materia e tipo di default.

**3. Triage documenti** (post-upload, schermata chiave) — griglia di 8 documenti con anteprima della prima pagina;
ogni card mostra il **tipo suggerito dall'AI** (appunti / schemi / esami / slide) con livello di confidenza, da
confermare o correggere; selezione multipla attiva su 3 documenti; barra di azioni bulk in basso con le scorciatoie
da tastiera visibili; **pipeline di normalizzazione** mostrata come step discreti
(preprocessing → trascrizione → markdown → grafo → argomenti) con uno step in corso, e un documento che
segnala "3 blocchi da verificare".

**4. Verifica trascrizione schema** — schermata critica, nuova. Uno schema di Termodinamica fotografato a mano
è stato trascritto. Split verticale:
- **sinistra**: l'immagine originale dello schema (rappresentala come disegno a mano stilizzato con riquadri,
  frecce e testo manoscritto) con i **bounding box dei nodi** sovrapposti — verdi quelli sicuri, ambra quelli
  incerti, rossi gli illeggibili;
- **destra**: il markdown/grafo risultante, editabile, con i nodi incerti evidenziati e il marcatore di
  incertezza visibile nel testo; per il nodo attualmente selezionato mostra il ritaglio ingrandito
  dell'immagine accanto al campo di testo;
- **in alto**: barra di avanzamento "3 nodi da verificare su 42", navigazione `Tab` fra i soli nodi dubbi,
  pulsante `Approva schema`;
- **in basso a destra**: anteprima del grafo renderizzato (nodi e frecce tipizzate: implica, causa, esempio-di)
  e i pulsanti di export `.canvas` / Mermaid;
- un avviso discreto: "le flashcard non possono essere generate dai nodi non verificati".
Fai sentire che questa schermata è veloce: si conferma il 5% incerto, non si rilegge tutto.

**5. Materie** — griglia di card materia: nome, bordo colore identità, countdown esame, indicatore di mastery,
card in scadenza oggi, numero documenti, barra di copertura argomenti, e un badge quando ci sono documenti
da verificare. Una materia archiviata, visivamente attenuata. Azioni su hover.

**6. Materia singola — Panoramica** — layout a 3 colonne: a sinistra l'albero degli argomenti con heatmap di mastery
(colore **e** percentuale numerica); al centro le tab (Panoramica | Appunti | Schemi | Esami | Flashcard |
Simulazioni | Piano) con: prossimo esame e countdown, 3 azioni consigliate, gap rilevati, attività recente;
a destra il **pannello AI contestuale** con le azioni disponibili per la selezione corrente, ciascuna con
modello e **costo stimato**.

**7. Materia singola — tab Schemi** — la vista che mostra il valore del grafo: elenco degli schemi con anteprima,
stato di verifica, e una **mappa unificata** dei grafi di più schemi (nodi e archi) con la heatmap di mastery
proiettata sopra. Un pannello segnala un gap strutturale: "lo schema non copre le trasformazioni isocore,
presenti negli appunti a p. 61".

**8. Materia singola — Appunti con selezione attiva** — tab Appunti: lista documenti con tipo, pagine, stato di
normalizzazione, argomenti coperti; **2 documenti selezionati** e il pannello destro che reagisce mostrando
"Genera flashcard dai 2 documenti selezionati", con selettore modello, numero di card, tipi di card e costo stimato.

**9. Review Queue artefatti** — approvazione delle 24 flashcard appena generate: card corrente al centro
(fronte / retro), **citazione sorgente verificabile a fianco** con documento e pagina, azioni accetta / modifica /
scarta, contatore di avanzamento, scorciatoie da tastiera. Includi una card con avviso di possibile duplicato
e una card generata da una relazione del grafo di uno schema (con indicata l'origine: nodo e arco).

**10. Sessione di ripasso (full-screen)** — zero cromo: la domanda al centro, molto spazio attorno, i 4 pulsanti di
valutazione FSRS con i rispettivi intervalli previsti, una barra di avanzamento sottilissima, il link alla fonte in
basso, e una formula matematica resa correttamente. È la schermata dove l'interfaccia deve quasi sparire.

**11. Planner — Wizard step 4 (anteprima e fattibilità)** — anteprima del piano prima di generarlo in bozza:
carico per settimana come grafico a barre, elenco argomenti coperti con ore allocate, posizionamento delle
3 simulazioni, **verdetto di fattibilità** (in questo mockup: "tempo insufficiente del 18%") con le 3 strategie
alternative proposte, costo del job e pulsante per generare la bozza.

**12. Revisione e conferma del piano** — schermata critica, nuova. La bozza generata, **non ancora attiva**:
- banner di stato chiaro in alto: "Bozza — non ancora nel calendario", con il conteggio task e il pulsante
  primario `Conferma piano`;
- lista delle task raggruppate per settimana e per giorno, ognuna **editabile inline** (titolo, durata, tipo,
  argomento, materiale collegato), con drag handle per spostarle di giorno, icona `pin` su due task bloccate,
  e una task marcata come aggiunta manualmente;
- barra laterale sempre visibile con carico giorno per giorno vs disponibilità (con un giorno in eccesso
  evidenziato in ambra), argomenti coperti, e **verdetto di fattibilità che si aggiorna in tempo reale**;
- azioni bulk in basso: "sposta la settimana di 2 giorni", "riduci il carico del 20%", "escludi argomento";
- in un pannello secondario, la **vista diff di un ricalcolo**: righe `+` `-` `~` `=` con il motivo accanto a
  ciascuna (es. "+2 sessioni Elettromagnetismo — motivo: simulazione del 12/01 al 54%"), e la possibilità di
  approvare il diff in blocco o voce per voce.

**13. Calendario — vista mese** — task come chip colorati per materia, esami come milestone marcate, un giorno
sovraccarico evidenziato, blackout date e impegni importati da calendario esterno (visivamente distinti dalle
task, perché sono vincoli e non azioni), pannello laterale del giorno selezionato con le sue task, e un badge
"Debito: 3 task non completate" con le opzioni rimanda / riassorbi / archivia.

**14. Stati e sistema** — una schermata che raccoglie: empty state di una materia nuova (con next action chiara),
skeleton di caricamento, stato errore di un job con causa e rimedio, toast di job in corso con progress e costo,
command palette aperta con azioni e ricerca globale, e il pannello impostazioni del **model routing**
(task → modello, con budget mensile e consumo corrente). Includi le voci dei nuovi job:
normalizzazione markdown, trascrizione schema, profilo di grafia.

### Requisiti trasversali per ogni schermata
- **tabular-nums** su ogni numero; colonne numeriche allineate a destra.
- Ogni azione primaria mostra la sua scorciatoia da tastiera accanto all'etichetta o nel tooltip.
- Il colore non è mai l'unico veicolo di informazione: la heatmap ha anche il numero, gli stati anche l'icona,
  la confidenza anche l'etichetta testuale.
- Contrasto minimo 4.5:1 sul testo e 3:1 su bordi e grafici; focus ring sempre visibile.
- Ogni schermata che lancia un'azione AI mostra **modello e costo stimato prima** di eseguire.
- Mostra sempre lo **stato degli artefatti AI** (bozza / approvato) e la loro fonte.
- Dove è rilevante, mostra lo **stato di verifica** del materiale sorgente (verificato / da verificare / bloccato).
- Densità "compact" come default: è un'app da sessione lunga, non una landing page.

### Cosa consegnare
1. I mockup HTML navigabili, con un indice per passare da una schermata all'altra.
2. Una prima schermata **Style guide** con token, tipografia e i componenti core (stat tile, task row, subject card,
   topic heat bar, document chip, confidence badge, graph node, job toast, model picker, bottoni e campi)
   in tutti i loro stati: default, hover, active, focus, disabled, loading, error.
3. Per ogni schermata, 2–3 righe di note di design che spieghino le decisioni non ovvie.

### Metodo
Comincia dalla style guide e dalla Dashboard. **Fermati dopo queste due e chiedimi conferma della direzione**
prima di produrre le restanti dodici schermate. Se una mia richiesta ti sembra in conflitto con i principi di
densità e calma, segnalamelo e proponi l'alternativa invece di eseguirla silenziosamente.

---

## Varianti utili

- **Tema light**: *"Produci anche la variante light della Dashboard e della sessione di ripasso. Il light non è un
  dark invertito: usa #FAFAFB come base, #FFFFFF per le superfici, bordi #E4E6EC, testo #16181D, e mantieni lo
  stesso accento."*
- **Mobile companion**: *"Progetta la PWA a 390×844 limitata a due schermate: task del giorno e sessione di ripasso
  offline. Target touch ≥ 44px, azioni raggiungibili con il pollice, nessuna sidebar."*
- **Cattura schemi da mobile**: *"Progetta il flusso di acquisizione da telefono: inquadratura con guida ai bordi,
  correzione prospettica, anteprima, assegnazione materia e tipo, invio in coda di normalizzazione."*
- **Design system in codice**: *"Converti la style guide in componenti React + Tailwind v4 con i token come CSS
  custom properties, pronti per shadcn/ui."*
