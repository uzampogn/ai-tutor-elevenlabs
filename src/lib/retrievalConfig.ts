/**
 * Retrieval tuning constants, kept in a dependency-free leaf module so consumers
 * that only need the values (e.g. the chat route's tracing metadata) can import
 * them without going through `@/lib/retrieval` — whose test suites replace that
 * module with a partial factory mock that omits these exports. `retrieval.ts`
 * re-exports both, so its public API is unchanged.
 */
export const RETRIEVAL_K = 3;
// Cosine-similarity floor so off-topic questions ("hello!") retrieve nothing.
// Starting guess — tune against real questions before raising/lowering.
export const SIM_FLOOR = 0.35;
