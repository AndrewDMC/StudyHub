import type { TaskDto } from '@studyhub/contracts';

export type LessonMethodChoice = 'standard' | 'sprint';

/** How a lesson task is studied: the saved method, `standard` for plans from before the choice. */
export function taskMethod(task: Pick<TaskDto, 'payload'>): LessonMethodChoice {
  return task.payload.method === 'sprint' ? 'sprint' : 'standard';
}

/**
 * The switch is offered on an open lesson (a draft one, or a `todo` one of an active plan). A lesson
 * that is `doing`, done or skipped keeps its method; the server has the last word (409 once started).
 */
export function canSwitchMethod(task: Pick<TaskDto, 'kind' | 'status'>): boolean {
  return task.kind === 'lesson' && (task.status === 'proposed' || task.status === 'todo');
}

export function methodLabel(method: LessonMethodChoice): string {
  return method === 'sprint' ? 'Sprint' : 'Standard';
}

export function otherMethod(method: LessonMethodChoice): LessonMethodChoice {
  return method === 'sprint' ? 'standard' : 'sprint';
}

/** "Passa a sprint" when the lesson is standard, "Passa a standard" when it is sprint. */
export function switchMethodLabel(method: LessonMethodChoice): string {
  return `Passa a ${otherMethod(method)}`;
}

/** "Lezione · Sprint · 35 min": the meta line of a lesson task (the others keep theirs). */
export function lessonMetaLabel(task: Pick<TaskDto, 'kind' | 'payload' | 'minutes'>): string {
  return task.kind === 'lesson'
    ? `Lezione · ${methodLabel(taskMethod(task))} · ${task.minutes} min`
    : `${task.minutes} min`;
}

/** Said after the switch, in a polite live region: the new method and the minutes the server set. */
export function methodAnnouncement(method: LessonMethodChoice, minutes: number): string {
  return `Lezione passata a ${method}: ${minutes} min.`;
}

/** The server's refusal ("La lezione è già iniziata.") is shown as it is; anything else gets a lead-in. */
export function methodErrorMessage(message: string): string {
  return message.startsWith('La lezione è già')
    ? message
    : `Non sono riuscito a cambiare il metodo: ${message}`;
}

/**
 * Runs the switch and turns the outcome into what the row shows: the announcement with the minutes the
 * server set, or the error (the server's 409 "La lezione è già iniziata." is kept as it is).
 */
export async function runMethodSwitch(
  run: () => Promise<Pick<TaskDto, 'minutes'>>,
  next: LessonMethodChoice,
): Promise<{ note: string; error: null } | { note: ''; error: string }> {
  try {
    const updated = await run();
    return { note: methodAnnouncement(next, updated.minutes), error: null };
  } catch (err) {
    return { note: '', error: methodErrorMessage((err as Error).message) };
  }
}
