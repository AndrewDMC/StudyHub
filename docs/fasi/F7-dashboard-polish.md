# F7 — Dashboard, Polish & Distribuzione

## Obiettivo
Tutto converge nella home; il prodotto è installabile da terzi in 5 minuti.

## Scope — Dashboard (layout a 12 colonne)
1. **Riga stato** (4 tile): giorni al prossimo esame · minuti pianificati oggi · card in scadenza · mastery media.
2. **Oggi** (col. 1–7): le task del giorno, raggruppate per slot, ognuna con azione diretta ("Inizia ripasso",
   "Apri p. 51", "Genera schema"). In cima: **la singola next-action consigliata**, grande e inequivocabile.
3. **Flashcard per materia** (col. 8–12): barre impilate new/learning/review/rischio + forecast 7 giorni + CTA.
4. **Upload rapido** (col. 8–12): dropzone sempre presente → porta al Triage di F1.
5. **Calendario compatto** (col. 1–7, sotto): prossimi 14 giorni, esami evidenziati, carico giornaliero come barra.
6. **Attività** (footer): job recenti, artefatti da approvare, avvisi del Planner.

## Scope — Polish e distribuzione
- Stati empty/loading/error rifiniti su ogni schermata; skeleton coerenti.
- Command palette completa (`⌘K`) con azioni AI, navigazione e ricerca globale.
- Tema light completo; 3 densità; `prefers-reduced-motion`; audit a11y con axe.
- Onboarding: primo avvio → crea materia → carica un PDF → genera 10 card → vedi la prima task. In 5 minuti.
- **Backup/restore**: `studyhub backup` → archivio con `/data` + dump DB; `restore` verificato con test.
- Immagini pubblicate (`ghcr.io`), `docker-compose.yml` one-liner, README con quickstart, profilo `lite` SQLite.
- Pagina `/admin`: job, costi per mese, stato sync FS, log, reset indice.

## Criteri di accettazione
- [ ] Una persona che non conosce il progetto arriva alla prima flashcard in <5 minuti seguendo il README.
- [ ] La Dashboard risponde alla domanda "cosa faccio adesso" senza scroll.
- [ ] Lighthouse ≥ 90 su performance e accessibilità nelle pagine principali.
- [ ] Backup e restore su macchina diversa: stato identico.
- [ ] Nessuna chiave API raggiungibile dal client (verificato nel bundle).
