import { resolveSubjectSubpath } from './paths.js';
import type { DocumentType } from './documents.js';

export function resolveDocumentSourcePath(
  slug: string,
  type: DocumentType,
  storedFilename: string,
  dataRoot?: string,
): string {
  return resolveSubjectSubpath(slug, ['sources', type, storedFilename], dataRoot);
}

export function resolveDocumentDerivedDir(
  slug: string,
  documentId: string,
  dataRoot?: string,
): string {
  return resolveSubjectSubpath(slug, ['derived', documentId], dataRoot);
}
