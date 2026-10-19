import type { CalibrationDto } from '@studyhub/contracts';

export const CALIBRATION_LEVEL_LABELS = { 1: 'Non lo so', 2: 'Forse', 3: 'Lo so' } as const;

/** Percentage 0..1 as "42%". */
export const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * One plain sentence per verdict, never a judgment from too few answers. With an illusion rate and
 * a tendency to overrate, the caller shows the figure itself (`illusionLead`) before `verdictTail`.
 */
export function headline(c: CalibrationDto): string {
  switch (c.verdict) {
    case 'overconfident':
      return `Tendi a sopravvalutarti: sei più sicuro di quanto i risultati giustifichino (scarto ${Math.round((c.bias ?? 0) * 100)} punti).`;
    case 'underconfident':
      return `Tendi a sottovalutarti: sai più di quanto pensi (scarto ${Math.round(Math.abs(c.bias ?? 0) * 100)} punti).`;
    case 'calibrated':
      return 'Sei ben calibrato: la fiducia che dichiari segue i tuoi risultati.';
    default:
      return `Servono più risposte con la fiducia dichiarata (almeno ${c.minSamplesPerLevel} per livello) prima di dire qualcosa.`;
  }
}

/** Closing part of the sentence that follows "Quando eri sicuro, hai sbagliato il X% delle volte". */
export function verdictTail(c: CalibrationDto): string | null {
  switch (c.verdict) {
    case 'overconfident':
      return "tendi a sopravvalutarti un po'.";
    case 'underconfident':
      return 'tendi a sottovalutarti.';
    case 'calibrated':
      return 'sei comunque ben calibrato.';
    default:
      return null;
  }
}
