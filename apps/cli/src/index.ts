#!/usr/bin/env node
import { Command } from 'commander';
import { createDb } from '@studyhub/db';
import type { FlashcardType } from '@studyhub/ai';
import { resolveDataRoot, SUBJECT_COLORS, type SubjectColor } from '@studyhub/core';
import { reconcileSubjects } from '@studyhub/worker/lib';
import { addSubject, listSubjectRows } from './commands/subject.js';
import { generatePlanCli, listPlansCli } from './commands/plan.js';
import {
  buildGenerationDryRun,
  type GenerationDryRunKind,
  type GenerationDryRunResult,
} from './commands/generate.js';
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

const plan = program.command('plan').description('Piano di studio (docs/04-planner.md)');

plan
  .command('generate')
  .description('Genera una bozza di piano (Fase A+B, nessun Redis richiesto: gira in-process)')
  .argument('<subjectSlug>', 'Slug della materia')
  .requiredOption('--start <date>', 'Data di inizio (YYYY-MM-DD)')
  .requiredOption('--target <date>', 'Data obiettivo/esame (YYYY-MM-DD)')
  .requiredOption(
    '--weekly <minutes>',
    'Minuti disponibili per giorno, 7 valori separati da virgola (dom..sab), es. 0,120,120,120,120,120,0',
  )
  .option('--session-length <minutes>', 'Durata di una sessione', (v) => parseInt(v, 10), 50)
  .option('--intensity <intensity>', 'sostenibile|standard|sprint', 'standard')
  .option('--exam <examId>', 'Esame collegato')
  .option('--force', 'Ignora il tetto di spesa giornaliero', false)
  .action(
    async (
      subjectSlug: string,
      opts: {
        start: string;
        target: string;
        weekly: string;
        sessionLength: number;
        intensity: 'sostenibile' | 'standard' | 'sprint';
        exam?: string;
        force: boolean;
      },
    ) => {
      const weekly = opts.weekly.split(',').map((v) => parseInt(v.trim(), 10));
      if (weekly.length !== 7 || weekly.some((n) => Number.isNaN(n))) {
        console.error('--weekly deve avere esattamente 7 numeri separati da virgola.');
        process.exitCode = 1;
        return;
      }
      const db = createDb();
      try {
        const result = await generatePlanCli(db, {
          subjectSlug,
          startDate: opts.start,
          targetDate: opts.target,
          weekly,
          sessionLength: opts.sessionLength,
          intensity: opts.intensity,
          ...(opts.exam !== undefined ? { examId: opts.exam } : {}),
          force: opts.force,
        });
        console.log(`Bozza generata: ${result.planId}`);
        console.log(`Task: ${result.taskCount} · fattibile: ${result.feasible ? 'sì' : 'no'}`);
        if (result.warnings.length > 0) console.log('Avvisi:', result.warnings);
        console.log(`Costo: €${result.costEur.toFixed(4)}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    },
  );

plan
  .command('ls')
  .description('Elenca i piani (draft/active/superseded) di una materia')
  .argument('<subjectSlug>', 'Slug della materia')
  .action(async (subjectSlug: string) => {
    const db = createDb();
    try {
      const rows = await listPlansCli(db, subjectSlug);
      if (rows.length === 0) {
        console.log('Nessun piano ancora — usa "studyhub plan generate".');
        return;
      }
      for (const row of rows) {
        console.log(
          `${row.id}\t${row.status}\t${row.startDate} → ${row.targetDate}\t${row.taskCount} task`,
        );
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

function printDryRun(result: GenerationDryRunResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`--- Prompt di sistema (${result.promptVersion}) ---`);
  console.log(result.system);
  console.log('\n--- Prompt utente ---');
  console.log(result.userPrompt);
  console.log('\n--- Stima (anteprima, nessuna chiamata al provider) ---');
  console.log(`Modello: ${result.model}`);
  console.log(`Documenti: ${result.docCount} · Chunk: ${result.chunkCount}`);
  console.log(`Token input (stimati): ${result.inputTokens}`);
  console.log(`Token output (stimati): ${result.outputTokens}`);
  console.log(`Costo stimato: ~€${result.costEur.toFixed(4)}`);
}

interface GenerateCommonOpts {
  docs?: string;
  topics?: string;
  model?: string;
  json: boolean;
  dryRun: boolean;
}

function parseScope(opts: GenerateCommonOpts): { docIds?: string[]; topicIds?: string[] } {
  return {
    ...(opts.docs ? { docIds: opts.docs.split(',').map((s) => s.trim()) } : {}),
    ...(opts.topics ? { topicIds: opts.topics.split(',').map((s) => s.trim()) } : {}),
  };
}

async function runDryRunCommand(
  kind: GenerationDryRunKind,
  subjectSlug: string,
  opts: GenerateCommonOpts,
  extra: Partial<import('./commands/generate.js').GenerationDryRunInput>,
): Promise<void> {
  if (!opts.dryRun) {
    console.error(
      'Modalità "wet" non supportata da questo comando: genera direttamente dal worker o dalla web UI ' +
        '(questo comando è solo anteprima — prompt finale + stima costo, mai una chiamata al provider).',
    );
    process.exitCode = 1;
    return;
  }
  const db = createDb();
  try {
    const result = await buildGenerationDryRun(db, {
      subjectSlug,
      kind,
      scope: parseScope(opts),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...extra,
    });
    printDryRun(result, opts.json);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

const generate = program
  .command('generate')
  .description(
    'Anteprima di una generazione AI (docs/fasi/F3-ai-core.md): stampa il prompt finale e la ' +
      'stima costo senza mai chiamare il provider. Sempre in dry-run — usa il worker/la web UI per generare davvero.',
  );

generate
  .command('flashcards')
  .description('Anteprima generate_flashcards')
  .argument('<subjectSlug>', 'Slug della materia')
  .option('--docs <ids>', 'docId separati da virgola')
  .option('--topics <ids>', 'topicId separati da virgola (alternativo a --docs)')
  .option('--model <model>', 'Modello (default: routing standard)')
  .option('--count <count>', '"auto" o numero di carte', 'auto')
  .option('--types <types>', 'basic|cloze|qa|formula separati da virgola', 'basic')
  .option('--difficulty <n>', '1|2|3', (v) => parseInt(v, 10), 2)
  .option('--lang <lang>', 'Lingua', 'it')
  .option('--json', 'Output JSON', false)
  .option('--no-dry-run', 'Non supportato: genera davvero dal worker/dalla web UI')
  .action(
    async (
      subjectSlug: string,
      opts: GenerateCommonOpts & { count: string; types: string; difficulty: number; lang: string },
    ) => {
      const count = opts.count === 'auto' ? ('auto' as const) : parseInt(opts.count, 10);
      await runDryRunCommand('flashcards', subjectSlug, opts, {
        count,
        types: opts.types.split(',').map((t) => t.trim()) as FlashcardType[],
        difficulty: opts.difficulty as 1 | 2 | 3,
        lang: opts.lang,
      });
    },
  );

generate
  .command('schema')
  .description('Anteprima generate_schema')
  .argument('<subjectSlug>', 'Slug della materia')
  .option('--docs <ids>', 'docId separati da virgola')
  .option('--topics <ids>', 'topicId separati da virgola (alternativo a --docs)')
  .option('--model <model>', 'Modello (default: routing standard)')
  .option('--depth <n>', '1|2|3|4', (v) => parseInt(v, 10), 2)
  .option('--style <style>', 'gerarchico|mappa|timeline|confronto', 'gerarchico')
  .option('--json', 'Output JSON', false)
  .option('--no-dry-run', 'Non supportato: genera davvero dal worker/dalla web UI')
  .action(
    async (subjectSlug: string, opts: GenerateCommonOpts & { depth: number; style: string }) => {
      await runDryRunCommand('schema', subjectSlug, opts, {
        depth: opts.depth as 1 | 2 | 3 | 4,
        style: opts.style as 'gerarchico' | 'mappa' | 'timeline' | 'confronto',
      });
    },
  );

generate
  .command('summary')
  .description('Anteprima generate_summary')
  .argument('<subjectSlug>', 'Slug della materia')
  .option('--docs <ids>', 'docId separati da virgola')
  .option('--topics <ids>', 'topicId separati da virgola (alternativo a --docs)')
  .option('--model <model>', 'Modello (default: routing standard)')
  .option('--length <length>', 'flash|standard|esteso', 'standard')
  .option('--json', 'Output JSON', false)
  .option('--no-dry-run', 'Non supportato: genera davvero dal worker/dalla web UI')
  .action(async (subjectSlug: string, opts: GenerateCommonOpts & { length: string }) => {
    await runDryRunCommand('summary', subjectSlug, opts, {
      length: opts.length as 'flash' | 'standard' | 'esteso',
    });
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
