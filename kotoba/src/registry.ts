/**
 * intel kotoba — REFERENCE E2E registry.
 *
 * Plaintext path (coverageProjection): sdk.write / sdk.read — public aggregates.
 * E2E path (inferredCohort): sdk.encryptedWrite / sdk.encryptedRead — CUI body
 * sealed in the kotoba envelope (ADR-2605181100), read-cap = owner DID. The
 * substrate never sees subject PII in plaintext.
 *
 * This is the canonical template for the founder's E2E-migration set: public
 * discovery metadata plaintext, sensitive payload E2E.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  COHORT_INNER_TYPE,
  COVERAGE_COLLECTION,
  coverageDidFor,
  coverageRkey,
  cohortRkey,
  isPct,
  isUint,
  type CoverageInput,
  type CoverageOutput,
  type CoverageProjectionRecord,
  type CoverageProjectionView,
  type GetCohortInput,
  type GetCohortOutput,
  type InferredCohortBody,
  type InferredCohortView,
  type ListCohortsInput,
  type ListCohortsOutput,
  type ListCoverageInput,
  type ListCoverageOutput,
  type RecordCohortInput,
  type RecordCohortOutput,
  type RecordCoverageInput,
  type RecordCoverageOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Coverage projection (PLAINTEXT) ────────────────────────────────

export async function recordCoverage(e: Etzhayyim, input: RecordCoverageInput): Promise<RecordCoverageOutput> {
  if (!input.projectionId || !input.targetDomain) return { status: "rejected", error: "missingRequiredFields" };
  if (!isUint(input.estimatedCount)) return { status: "rejected", error: "invalidEstimatedCount" };
  const rkey = coverageRkey(input.projectionId);
  const existing = await e.read<CoverageProjectionRecord>({ collection: COVERAGE_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", projectionUri: existing.records[0].uri, did: existing.records[0].value.did, projectionId: input.projectionId };
  }
  const now = new Date().toISOString();
  const did = coverageDidFor(input.projectionId);
  const record: CoverageProjectionRecord = {
    did,
    projectionId: input.projectionId,
    targetDomain: input.targetDomain,
    estimatedCount: input.estimatedCount,
    generatedAt: input.generatedAt ?? now,
    createdAt: now,
  };
  const receipt = await e.write({ collection: COVERAGE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "recorded", projectionUri: receipt.uri, did, projectionId: input.projectionId };
}

export async function listCoverage(e: Etzhayyim, input: ListCoverageInput = {}): Promise<ListCoverageOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<CoverageProjectionRecord>({ collection: COVERAGE_COLLECTION, cursor: input.cursor, limit });
  const items: CoverageProjectionView[] = resp.records
    .filter((r) => !input.targetDomain || r.value.targetDomain === input.targetDomain)
    .map((r) => ({ ...r.value, projectionUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Inferred cohort (E2E-ENCRYPTED, CUI) ───────────────────────────

export async function recordCohort(e: Etzhayyim, input: RecordCohortInput): Promise<RecordCohortOutput> {
  if (!input.cohortId || !input.subjectDid || !input.targetDomain) return { status: "rejected", error: "missingRequiredFields" };
  if (!isUint(input.estimatedCount)) return { status: "rejected", error: "invalidEstimatedCount" };
  if (!isPct(input.confidence)) return { status: "rejected", error: "invalidConfidence" };
  const body: InferredCohortBody = {
    cohortId: input.cohortId,
    subjectDid: input.subjectDid,
    targetDomain: input.targetDomain,
    estimatedCount: input.estimatedCount,
    confidence: input.confidence,
    assessedAt: input.assessedAt ?? new Date().toISOString(),
  };
  // Read-cap = owner DID (sender, auto-wrapped) + any explicit recipients.
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: COHORT_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: cohortRkey(input.cohortId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, cohortId: input.cohortId };
}

async function scanCohorts(e: Etzhayyim, maxScan: number): Promise<InferredCohortView[]> {
  const out: InferredCohortView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<InferredCohortBody>({ innerType: COHORT_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listCohorts(e: Etzhayyim, input: ListCohortsInput = {}): Promise<ListCohortsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanCohorts(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((c) => !input.targetDomain || c.targetDomain === input.targetDomain);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getCohort(e: Etzhayyim, input: GetCohortInput): Promise<GetCohortOutput> {
  if (!input.cohortId) return { error: "invalidCohortId" };
  const all = await scanCohorts(e, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.cohortId === input.cohortId);
  if (!found) return { error: "notFound" };
  return { cohort: found };
}

// ─── Coverage rollup ────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const projectionsByDomain: Record<string, number> = {};
  let coverageProjectionCount = 0;
  let cursor: string | undefined;
  while (coverageProjectionCount < maxScan) {
    const page = await e.read<CoverageProjectionRecord>({ collection: COVERAGE_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      projectionsByDomain[r.value.targetDomain] = (projectionsByDomain[r.value.targetDomain] ?? 0) + 1;
      coverageProjectionCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const inferredCohortCount = (await scanCohorts(e, maxScan)).length;
  return {
    coverageProjectionCount,
    inferredCohortCount,
    projectionsByDomain,
    truncated: coverageProjectionCount >= maxScan || inferredCohortCount >= maxScan,
  };
}
