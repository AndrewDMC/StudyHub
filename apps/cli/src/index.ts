#!/usr/bin/env node
import { Command } from 'commander';
import { createDb } from '@studyhub/db';
import { resolveDataRoot, SUBJECT_COLORS, type SubjectColor } from '@studyhub/core';
import { reconcileSubjects } from '@studyhub/worker/lib';
import { addSubject, listSubjectRows } from './commands/subject.js';
import { backupData, restoreData } from './backup.js';

const program = new Command();
program.name('studyhub').description('StudyHub CLI').version('0.1.0');

const subject = program.command('subject').description('Gestione materie');

subject
  .command('add')
  .description('Crea una nuova materia (cartella + record DB)')
  .argument('<name>', 'Nome della materia')
  .option('-c, --color <color>', `Colore identità (${SUBJECT_COLORS.join('|')})`, 'blue')
  .option('-p, --professor <professor>', 'Docente')
  .option('--cfu <cfu>', 'CFU', (v) => parseInt(v, 10))
  .action(async (name: string, opts: { color: string; professor?: string; cfu?: number }) => {
    if (!SUBJECT_COLORS.includes(opts.color as SubjectColor)) {
      console.error(
        `Colore non valido: ${opts.color}. Valori ammessi: ${SUBJECT_COLORS.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    const db = createDb();
    const dataRoot = resolveDataRoot();
    const row = await addSubject(db, dataRoot, {
      name,
      color: opts.color as SubjectColor,
      professor: opts.professor,
      cfu: opts.cfu,
    });
    console.log(`Creata materia "${row.name}" (${row.slug}) in ${row.folderPath}`);
  });

subject
  .command('ls')
  .description('Elenca le materie')
  .action(async () => {
    const db = createDb();
    const rows = await listSubjectRows(db);
    if (rows.length === 0) {
      console.log('Nessuna materia.');
      return;
    }
    for (const row of rows) {
      console.log(`${row.slug}\t${row.name}\t${row.color}`);
    }
  });

program
  .command('reconcile')
  .description('Importa nel DB le materie presenti su disco ma non ancora indicizzate')
  .option('-s, --subject <slug>', 'Limita la reconcile a una singola materia')
  .action(async (opts: { subject?: string }) => {
    const db = createDb();
    const dataRoot = resolveDataRoot();
    const result = await reconcileSubjects(db, dataRoot, { subjectSlug: opts.subject });
    console.log(`Importate: ${result.imported.length}`, result.imported);
    console.log(`Già indicizzate: ${result.alreadyIndexed.length}`);
    if (result.skippedInvalid.length > 0) {
      console.log(
        `Saltate (manifest non valido): ${result.skippedInvalid.length}`,
        result.skippedInvalid,
      );
    }
  });

function logTableCounts(tables: Record<string, number>): void {
  for (const [name, count] of Object.entries(tables)) {
    if (count > 0) console.log(`  ${name}: ${count}`);
  }
}

program
  .command('backup')
  .description('Backup di /data e del database in una cartella (docs/fasi/F7-dashboard-polish.md)')
  .argument('<destDir>', 'Cartella di destinazione (creata se non esiste)')
  .action(async (destDir: string) => {
    const db = createDb();
    const dataRoot = resolveDataRoot();
    const result = await backupData(db, dataRoot, destDir);
    console.log(`Backup scritto in ${result.destDir}`);
    logTableCounts(result.tables);
  });

program
  .command('restore')
  .description(
    'Ripristina /data e il database da una cartella di backup — sostituisce lo stato attuale, non lo unisce',
  )
  .argument('<srcDir>', 'Cartella di backup da ripristinare')
  .action(async (srcDir: string) => {
    const db = createDb();
    const dataRoot = resolveDataRoot();
    const result = await restoreData(db, dataRoot, srcDir);
    console.log('Ripristino completato:');
    logTableCounts(result.tables);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
