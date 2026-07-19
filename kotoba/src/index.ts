/**
 * intel kotoba — barrel. REFERENCE E2E pattern (plaintext public-meta +
 * kotoba-E2E sensitive payload, ADR-2605181100). Copy this shape for the
 * founder's E2E-migration set (yabai/hc/society6/open-kyber/tia/… sensitive
 * collections).
 */
export * from "./types.js";
export {
  recordCoverage,
  listCoverage,
  recordCohort,
  listCohorts,
  getCohort,
  coverage,
} from "./registry.js";
