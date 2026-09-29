/**
 * Scope of a study session (docs/08-sessione-di-studio.md §3): which topics and
 * which documents a click on "Inizia" puts in front of the student. Pure — the
 * caller loads the rows, this only decides.
 *
 * A task carries at most one `topicId` plus the documents it was planned on
 * (`payload.material`), so "topics 1 and 2" is derived: the task's own topic
 * plus every topic those documents are tagged with.
 */
export interface SessionTaskInput {
  topicId: string | null;
  material: { docId: string; pageFrom: number; pageTo: number }[];
}

export interface DocumentTopicLink {
  documentId: string;
  topicId: string;
}

export interface SessionScopeInput {
  task: SessionTaskInput | null;
  /** A choice made by the student (free session, or edited in the page): replaces the derived topics. */
  explicitTopicIds?: string[] | undefined;
  /** Every `document_topics` link of the subject. */
  links: DocumentTopicLink[];
  /** Ids of the subject's documents — anything else in the task material is dropped (deleted docs). */
  knownDocumentIds: ReadonlySet<string>;
}

export interface SessionScope {
  topicIds: string[];
  /** Task material first (highlighted in the UI), then the other documents of the topics. */
  documentIds: string[];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function resolveSessionScope(input: SessionScopeInput): SessionScope {
  const material = (input.task?.material ?? []).map((m) => m.docId);
  const materialDocs = unique(material).filter((id) => input.knownDocumentIds.has(id));

  const topicsOf = (documentId: string): string[] =>
    input.links.filter((l) => l.documentId === documentId).map((l) => l.topicId);

  const topicIds =
    input.explicitTopicIds !== undefined
      ? unique(input.explicitTopicIds)
      : unique([
          ...(input.task?.topicId ? [input.task.topicId] : []),
          ...materialDocs.flatMap(topicsOf),
        ]);

  const topicSet = new Set(topicIds);
  const topicDocs = input.links
    .filter((l) => topicSet.has(l.topicId) && input.knownDocumentIds.has(l.documentId))
    .map((l) => l.documentId);

  return { topicIds, documentIds: unique([...materialDocs, ...topicDocs]) };
}
