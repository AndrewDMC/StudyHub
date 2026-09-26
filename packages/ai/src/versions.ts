import { loadPrompt } from './promptLoader.js';

// Single source of truth for prompt versions — both providers and job
// orchestration (idempotency jobKey, artifact front-matter) read from here
// instead of hardcoding the string in more than one place.
export const FLASHCARDS_PROMPT_VERSION = loadPrompt('flashcards', 1).promptVersion;
export const SUMMARY_PROMPT_VERSION = loadPrompt('summary', 1).promptVersion;
export const SCHEMA_PROMPT_VERSION = loadPrompt('schema', 1).promptVersion;
export const SCHEMA_TRANSCRIPTION_PROMPT_VERSION = loadPrompt('schema_transcription', 1).promptVersion;
export const EXAM_PROFILE_PROMPT_VERSION = loadPrompt('exam_profile', 1).promptVersion;
export const SIMULATION_PROMPT_VERSION = loadPrompt('simulation', 2).promptVersion;
export const GRADING_PROMPT_VERSION = loadPrompt('grading', 1).promptVersion;
export const ESTIMATE_TOPICS_PROMPT_VERSION = loadPrompt('estimate_topics', 1).promptVersion;
export const EXTRACT_TOPICS_PROMPT_VERSION = loadPrompt('extract_topics', 1).promptVersion;
