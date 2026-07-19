/**
 * intel kotoba — REFERENCE E2E pattern: plaintext public-meta + kotoba-E2E
 * sensitive payload.
 *
 * Per ADR-2606011400 (Consensys) + ADR-2605172400 (3-axis) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03: PII /
 * CUI / LE may migrate to etzhayyim when made safe via kotoba E2E.
 *
 * SPLIT:
 *   PUBLIC (plaintext AT records) — aggregate coverage projections (no subject
 *   PII): counts/estimates by target domain. Frontable open metadata.
 *   SENSITIVE / CUI (kotoba E2E, com.etzhayyim.encrypted.record) — inferred
 *   cohorts (subjectDid + estimate): written via sdk.encryptedWrite (read-cap =
 *   owner DID), so confidential intelligence lives on-substrate encrypted, not
 *   etzhayyim-resident. Public discovery metadata stays plaintext.
 *
 *   STAYS etzhayyim (consumed via consent-capability) — HUMINT/SIGINT collection
 *   pipelines + analysis EXECUTION + source feeds (the regulated *acts*, not the
 *   resulting data records).
 *
 * AT-Lexicon: no float (estimates + confidence are integers; confidence 0-100).
 */

// Plaintext public collection.
export const COVERAGE_COLLECTION = "com.etzhayyim.apps.intel.coverageProjection";
// E2E inner-type NSID (body shape inside the encrypted envelope).
export const COHORT_INNER_TYPE = "com.etzhayyim.apps.intel.inferredCohort";

export const INTEL_DID_PREFIX = "did:web:intel.etzhayyim.com:" as const;

// ─── Coverage projection (PLAINTEXT, public aggregate) ──────────────

export interface CoverageProjectionRecord {
  did: string;
  projectionId: string;
  targetDomain: string;
  estimatedCount: number;
  generatedAt: string;
  createdAt: string;
}
export interface CoverageProjectionView extends CoverageProjectionRecord {
  projectionUri: string;
}
export interface RecordCoverageInput {
  projectionId: string;
  targetDomain: string;
  estimatedCount: number;
  generatedAt?: string;
}
export interface RecordCoverageOutput {
  status: "recorded" | "alreadyExists" | "rejected";
  projectionUri?: string;
  did?: string;
  projectionId?: string;
  error?: string;
}
export interface ListCoverageInput {
  targetDomain?: string;
  limit?: number;
  cursor?: string;
}
export interface ListCoverageOutput {
  items: CoverageProjectionView[];
  cursor?: string;
  total: number;
}

// ─── Inferred cohort (E2E-ENCRYPTED, CUI) ───────────────────────────

export interface InferredCohortBody {
  cohortId: string;
  subjectDid: string;
  targetDomain: string;
  estimatedCount: number;
  /** integer 0-100. */
  confidence: number;
  assessedAt: string;
}
export interface InferredCohortView extends InferredCohortBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordCohortInput {
  cohortId: string;
  subjectDid: string;
  targetDomain: string;
  estimatedCount: number;
  confidence: number;
  assessedAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface RecordCohortOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  cohortId?: string;
  error?: string;
}
export interface ListCohortsInput {
  targetDomain?: string;
  limit?: number;
  cursor?: string;
}
export interface ListCohortsOutput {
  items: InferredCohortView[];
  cursor?: string;
  total: number;
}
export interface GetCohortInput {
  cohortId: string;
}
export interface GetCohortOutput {
  cohort?: InferredCohortView;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  coverageProjectionCount?: number;
  inferredCohortCount?: number;
  projectionsByDomain?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isPct(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100;
}
export function coverageDidFor(id: string): string {
  return `${INTEL_DID_PREFIX}cov:${id.toLowerCase()}`;
}
export function coverageRkey(id: string): string {
  return `cov-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function cohortRkey(id: string): string {
  return `cohort-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
