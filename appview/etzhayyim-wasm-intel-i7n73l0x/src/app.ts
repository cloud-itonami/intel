import {
  asAgentTool, createWorkerExport, withCapabilityTags, withOCELEvent, truncateText,
  type ComAtprotoSyncSubscribeReposCommit, type HostSDK,
  nowISO, decodeJson, str, llmAsk, resolveHeartbeatCadence, createCadenceState, createInboxBuffer, genID,
  createKyselyDb,
  nsid,
  parseLexiconInput,
  sql,
} from "@etzhayyim/kotodama-host-sdk";

// Graph reads/writes (Kysely + Hyperdrive, ADR-0036).
const cadenceState = createCadenceState();
const inbox = createInboxBuffer();

let appId = "";
const COLLECTION = "com.etzhayyim.apps.intel.report";
const INTEL_REPORT_COLLECTION = "com.etzhayyim.apps.intel.report";
const INTEL_ENTITY_DID_COLLECTION = "com.etzhayyim.apps.intel.entityDid";
const VERTEX_INTEL_REPORT_TABLE = "vertex_intel_report";
const VERTEX_INTEL_ENTITY_DID_TABLE = "vertex_intel_entity_did";
const VERTEX_INTEL_INFERENCE_CHAIN_TABLE = "vertex_intel_inference_chain";
const VERTEX_INTEL_INFERRED_COHORT_TABLE = "vertex_intel_inferred_cohort";
const VERTEX_INTEL_EVIDENCE_TABLE = "vertex_intel_evidence";
const MV_VERTEX_INTEL_REPORT_COUNT_TABLE = "mv_vertex_intel_report_count";
const MV_VERTEX_INTEL_ENTITY_DID_COUNT_TABLE = "mv_vertex_intel_entity_did_count";

function parseJsonObject(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") return input as Record<string, unknown>;
  if (typeof input !== "string" || !input) return {};
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseIntelRow(
  row: Record<string, unknown> | null | undefined,
  defaultCollection: string,
  defaultLabel: string,
): Record<string, unknown> {
  if (!row) return {};
  const props = parseJsonObject(row.props);
  const valueJson = parseJsonObject(row.value_json);
  return {
    ...valueJson,
    ...props,
    ...row,
    vertex_id: row.vertex_id ?? valueJson.vertex_id ?? props.vertex_id ?? "",
    label: row.label ?? valueJson.label ?? props.label ?? defaultLabel,
    rkey: row.rkey ?? valueJson.rkey ?? props.rkey ?? valueJson.analysisId ?? valueJson.entityId ?? "",
    repo: row.repo ?? valueJson.repo ?? props.repo ?? "",
    collection: row.collection ?? valueJson.collection ?? props.collection ?? defaultCollection,
    status: row.status ?? valueJson.status ?? props.status ?? "",
    did: row.did ?? valueJson.did ?? props.did ?? "",
  };
}

async function readTableCount(
  table: string,
  fallbackTable: string,
): Promise<number> {
  const db = createKyselyDb();
  try {
    const mvRows = await db
      .selectFrom(table as any)
      .select(sql<number>`coalesce(sum(cnt), 0)`.as("cnt"))
      .execute();
    return Number(mvRows[0]?.cnt ?? 0);
  } catch {
    const rows = await db
      .selectFrom(fallbackTable as any)
      .select(sql<number>`count(*)`.as("cnt"))
      .execute();
    return Number(rows[0]?.cnt ?? 0);
  }
}

function parseIntelAnalysisRow(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return parseIntelRow(row, INTEL_REPORT_COLLECTION, "IntelAnalysis");
}

function parseIntelEntityRow(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return parseIntelRow(row, INTEL_ENTITY_DID_COLLECTION, "Entity");
}

function parseCommitRecord(commit: ComAtprotoSyncSubscribeReposCommit): Record<string, unknown> | null {
  const parsed = decodeJson(commit.payload);
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
}

function withLegacyVertexEnvelope(
  row: Record<string, unknown>,
  commit: ComAtprotoSyncSubscribeReposCommit,
): Record<string, unknown> {
  return {
    ...row,
    vertex_id: row.vertex_id,
    rkey: row.rkey ?? commit.rkey ?? "",
    repo: row.repo ?? commit.repo ?? "",
    collection: row.collection ?? commit.collection,
  };
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

function intelTable(collection: string): string | null {
  switch (collection) {
    case "report":
      return VERTEX_INTEL_REPORT_TABLE;
    case "entityDid":
      return VERTEX_INTEL_ENTITY_DID_TABLE;
    case "inferenceChain":
      return VERTEX_INTEL_INFERENCE_CHAIN_TABLE;
    case "inferredCohort":
      return VERTEX_INTEL_INFERRED_COHORT_TABLE;
    case "inferenceEvidence":
      return VERTEX_INTEL_EVIDENCE_TABLE;
    default:
      return null;
  }
}

function intelRecordId(collection: string, rec: Record<string, unknown>): string {
  return str(
    rec.analysisId ??
    rec.entityId ??
    rec.chainId ??
    rec.cohortId ??
    rec.evidenceId ??
    genID("intel"),
  );
}

function toIntelRow(collection: string, rec: Record<string, unknown>): Record<string, unknown> {
  const rkey = intelRecordId(collection, rec);
  const ownerDid = "did:web:intel.etzhayyim.com";
  const row: Record<string, unknown> = {
    vertex_id: str(rec.vertex_id ?? `at://${ownerDid}/com.etzhayyim.apps.intel.${collection}/${rkey}`),
    rkey,
    collection: `com.etzhayyim.apps.intel.${collection}`,
    status: rec.status ?? "active",
    sensitivity_ord: 2,
    owner_did: ownerDid,
    org_id: rec.orgId ?? "anon",
    user_id: rec.userId ?? "anon",
    actor_id: rec.actorId ?? appId,
    created_at: rec.createdAt ?? nowISO(),
  };
  for (const [key, value] of Object.entries(rec)) row[camelToSnake(key)] = value;
  if (collection === "inferenceChain") {
    row.steps_count = rec.stepsCount ?? rec.stepCount ?? row.steps_count;
  }
  if (collection === "inferenceEvidence") {
    row.evidence_id = rec.evidenceId ?? rkey;
    row.source_uri = rec.sourceUrl ?? rec.sourceUri ?? "";
    row.source_did = rec.sourceDid ?? "";
    row.extractor = rec.extractor ?? "intel";
    row.observed_at = rec.observedAt ?? rec.createdAt ?? nowISO();
    row.payload_json = JSON.stringify(rec);
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined) clean[key] = value;
  }
  return clean;
}

function write(sdk: HostSDK, collection: string, rec: Record<string, unknown>): void {
  const table = intelTable(collection);
  if (!table) {
    console.warn(`[write] unknown intel collection: ${collection}`);
    return;
  }
  const promise = createKyselyDb()
    .insertInto(table as any)
    .values(toIntelRow(collection, rec) as any)
    .execute()
    .catch(e => console.warn(`[write] ${collection}:`, e));
  const pendingWrites = (sdk.pds as unknown as { pendingWrites?: Promise<unknown>[] }).pendingWrites;
  if (Array.isArray(pendingWrites)) pendingWrites.push(promise);
}

// --- DJB2 Hash (cohort dedup, same as natural-person) ---
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// --- Inference Confidence Constants ---
const BASE_CONFIDENCE: Record<number, number> = { 1: 0.95, 2: 0.80, 3: 0.60, 4: 0.40, 5: 0.20 };
const CONFIDENCE_HALF_LIFE_DAYS = 90;

function corroborateConfidences(cs: number[]): number {
  return 1 - cs.reduce((acc, c) => acc * (1 - c), 1);
}

// --- Industry Ratio Templates ---
interface IndustryRatios { [key: string]: number }
interface IndustryTemplate { industry: string; ratios: IndustryRatios; sources: string[] }

const INDUSTRY_TEMPLATES: Record<string, IndustryTemplate> = {
  automotive: {
    industry: "automotive",
    ratios: {
      'salesToContract': 1.0, 'salesToDealerRatio': 62, 'salesToLoanRate': 0.50,
      'salesToInsuranceRate': 0.90, 'salesToAfterserviceRate': 0.60,
      'productionToTier1Ratio': 340, 'tier1ToTier2': 5, 'dealerToEmployee': 5,
      'productionToSteelTon': 0.143, 'productionToAluminumTon': 0.029, 'productionToResinTon': 0.049,
    },
    sources: ["JAMA Statistics", "OICA World Motor Vehicle Statistics", "Company IR/Annual Reports"],
  },
  semiconductor: {
    industry: "semiconductor",
    ratios: {
      'revenueBToWaferStartsK': 12, 'fabToEquipmentVendor': 15, 'fabToChemicalSupplier': 25,
      'designHouseToIpLicense': 3, 'foundryCustomerPerFab': 50,
      'fabToEmployee': 2000, 'revenueBToPatent': 500,
    },
    sources: ["SEMI World Fab Forecast", "IC Insights", "WSTS Semiconductor Market Statistics"],
  },
  finance: {
    industry: "finance",
    ratios: {
      'populationToBankAccount': 1.5, 'gdpToLoanVolume': 1.2, 'insurancePenetration': 0.07,
      'securitiesAccountPerCapita': 0.15, 'transactionPerAccountPerYear': 120,
      'bankToBranch': 150, 'branchToEmployee': 12,
    },
    sources: ["World Bank Global Findex", "BIS Statistics", "National Financial Authority Statistics"],
  },
  healthcare: {
    industry: "healthcare",
    ratios: {
      'populationToHospitalBed': 0.003, 'hospitalToEmployee': 200, 'populationToPhysician': 0.003,
      'populationToPrescriptionPerYear': 12, 'populationToInsuranceClaimPerYear': 4,
    },
    sources: ["WHO Global Health Observatory", "OECD Health Statistics"],
  },
  logistics: {
    industry: "logistics",
    ratios: {
      'gdpTToContainerTeuM': 0.15, 'containerToBillOfLading': 1.2,
      'warehouseSqmPerGdpB': 50000, 'fleetVehiclePerGdpB': 800,
    },
    sources: ["World Bank Logistics Performance Index", "UNCTAD Maritime Transport Review"],
  },
};

const koyoKeiyaku = "koyoKeiyaku";

// --- Coverage Domain Mapping ---
const DOMAIN_MAP: Record<string, string> = {
  'salesContract': koyoKeiyaku, 'legalEntity': "legalEntity", 'insurancePolicy': "insurance",
  'autoLoan': "bank", vin: "gtin", dealer: "supplyChain", 'tier1Supplier': "supplyChain",
  'tier2Supplier': "supplyChain", employee: "naturalPerson", 'steelTon': "resourceFlow",
  'aluminumTon': "resourceFlow", 'resinTon': "resourceFlow", 'logisticsContract': "resourceFlow",
  'afterserviceContract': koyoKeiyaku, patent: "sbom", 'bankAccount': "bank",
  'hospitalBed': "kaigo", physician: "naturalPerson", prescription: "ndc",
  'waferStart': "handotai", 'fabEquipment': "supplyChain", 'ipLicense': koyoKeiyaku,
  'containerTeu': "resourceFlow", 'billOfLading': "resourceFlow",
};

// --- Node label mapping ---
const INTEL_LABELS: Record<string, string> = {
  semiconductor: "IntelAnalysis:Semiconductor", cybercrime: "IntelAnalysis:Cybercrime",
  "risk-intelligence": "IntelAnalysis:Risk", "infrastructure-security": "IntelAnalysis:InfraSec",
  "network-intelligence": "IntelAnalysis:Network", "demographics": "IntelAnalysis:Demographics",
};
const SOURCE_DIDS: Record<string, string> = {
  handotai: "@handotai.etzhayyim.com", malak: "@malak.etzhayyim.com", yabai: "@yabai.etzhayyim.com",
  "ct-monitor": "@ct-monitor.etzhayyim.com", ipaddress: "@ipaddress.etzhayyim.com",
  "natural-person": "@natural-person.etzhayyim.com",
};

async function onPeerIntelCommit(sdk: HostSDK, commit: ComAtprotoSyncSubscribeReposCommit, sourceName: string, domain: string): void {
  const row = withLegacyVertexEnvelope(
    parseCommitRecord(commit) ?? {},
    commit,
  );
  if (Object.keys(row).length === 0) return;
  const title = str(row.title ?? row.name ?? row.displayName ?? `${sourceName} intel`);
  const content = str(row.description ?? row.content ?? row.summary ?? "");
  const analysisId = genID("peer");
  const graphLabel = INTEL_LABELS[domain] ?? "IntelAnalysis";
  const sourceDid = SOURCE_DIDS[sourceName] ?? `@${sourceName.replace(/\.etzhayyim\.ai$/, "")}.etzhayyim.com`;

  write(sdk, "report", {
    'analysisId': analysisId, title: truncateText(title, 200),
    summary: truncateText(content, 500),
    'sourceFamily': "public", 'collectionMethod': "follow",
    'analyticLens': "OSINT", domain, classification: "cui",
    'nodeLabel': graphLabel,
    status: "ingested", 'sourceApp': sourceName,
    'sourceCollection': commit.collection, 'sourceRkey': commit.rkey,
    sourceDid,
    'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
  });

  const entityName = str(row.name ?? row.entityName ?? row.company ?? row.threatActor ?? "");
  if (entityName) {
    const entityId = `intel:${entityName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    const entityType = str(row.entityType ?? "unknown");
    write(sdk, "entityDid", {
      'entityId': entityId, name: entityName,
      'entityType': entityType, domain,
      'nodeLabel': entityType === "person" ? "Entity:Person" : entityType === "org" ? "Entity:Org" : `Entity:${entityType}`,
      'sourceAnalysis': analysisId, 'createdAt': nowISO(),
      'orgId': "anon", 'userId': "anon", 'actorId': appId,
    });
  }
}

function cmdSubmitAnalysis(sdk: HostSDK, payload: Uint8Array): unknown {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.submitAnalysis", payload);
  if (!req.title) return { error: "title required" };
  if (!req.sourceText) return { error: "sourceText required" };
  const analysisId = genID("intel");
  write(sdk, "report", {
    'analysisId': analysisId, title: req.title,
    summary: truncateText(req.sourceText, 500),
    'sourceFamily': "public", 'collectionMethod': "manual",
    'analyticLens': "OSINT", classification: req.classification ?? "cui",
    status: "pendingLlm", 'createdAt': nowISO(),
    'orgId': "anon", 'userId': "anon", 'actorId': appId,
  });
  return { 'analysisId': analysisId, status: "pendingLlm" };
}

async function cmdGetAnalysis(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.getAnalysis", payload);
  if (!req.id) return { error: "id required" };
  const db = createKyselyDb();
  const rows = await db.selectFrom(VERTEX_INTEL_REPORT_TABLE as any).selectAll()
    .where((eb: any) => eb.or([
      eb("analysis_id", "=", req.id),
      eb("rkey", "=", req.id),
    ]))
    .limit(1).execute();
  if (rows.length === 0) return { error: "not found" };
  return parseIntelAnalysisRow(rows[0] as Record<string, unknown>);
}

async function cmdListAnalyses(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.listAnalyses", payload);
  const limit = Math.min(Math.max(req.limit ?? 50, 1), 100);
  const offset = req.offset ?? 0;
  const db = createKyselyDb();
  const rows = await db.selectFrom(VERTEX_INTEL_REPORT_TABLE as any).selectAll()
    .limit(limit).offset(offset).execute();
  const analyses = rows.map((r: unknown) => parseIntelAnalysisRow(r as Record<string, unknown>)).filter(a =>
    !req.domain || a.domain === req.domain
  );
  return { analyses, total: analyses.length, offset, limit };
}

async function cmdGetNeighbors(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.getNeighbors", payload);
  if (!req.entityId) return { error: "entityId required" };
  // Edge-based traversal not expressible without dedicated intel schema.
  // Stub: return empty until vertex_intel + edge_involves tables exist.
  return { 'entityId': req.entityId, 'relatedAnalyses': [] };
}

async function cmdSearchEntities(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.searchEntities", payload);
  if (!req.query) return { error: "query required" };
  const limit = Math.min(req.limit ?? 20, 50);
  const db = createKyselyDb();
  const rows = await db.selectFrom(VERTEX_INTEL_ENTITY_DID_TABLE as any).selectAll()
    .where((eb: any) => eb.or([
      eb("entity_id", "=", req.query),
      eb("rkey", "=", req.query),
      eb("name", "=", req.query),
    ]))
    .limit(limit).execute();
  return { results: rows.map((r: unknown) => parseIntelEntityRow(r as Record<string, unknown>)), count: rows.length };
}

async function cmdGetDashboard(sdk: HostSDK, _payload: Uint8Array): Promise<unknown> {
  void sdk;
  const totalAnalyses = await readTableCount(MV_VERTEX_INTEL_REPORT_COUNT_TABLE, VERTEX_INTEL_REPORT_TABLE);
  const totalEntities = await readTableCount(MV_VERTEX_INTEL_ENTITY_DID_COUNT_TABLE, VERTEX_INTEL_ENTITY_DID_TABLE);
  const byDomain: Array<{ domain: string; cnt: number }> = []; // Aggregation by JSON field: needs vertex_intel table
  return {
    'totalAnalyses': totalAnalyses,
    'totalEntities': totalEntities,
    'byDomain': byDomain,
  };
}

// ===== Inference Coverage Engine =====

interface InferenceStep {
  layer: number;
  'inputFact': string;
  'inferenceRule': string;
  'outputEntityType': string;
  'outputDomain': string;
  'estimatedCount': number;
  confidence: number;
  methodology: string;
  assumptions: string[];
}

function buildInferencePrompt(subjectName: string, sourceText: string, industry: string): string {
  const tpl = INDUSTRY_TEMPLATES[industry];
  const ratioCtx = tpl
    ? `\nIndustry ratios for ${tpl.industry}:\n${Object.entries(tpl.ratios).map(([k, v]) => `  ${k}: ${v}`).join("\n")}\nSources: ${tpl.sources.join(", ")}`
    : "";
  return `You are an economic intelligence analyst. Given the following source data about "${subjectName}", generate an inference chain that derives entity counts for coverage domains.
${ratioCtx}

Source data:
${sourceText}

Output ONLY a JSON array of inference steps. Each step:
{
  "layer": 1-5 (1=direct derivation, 2=statistical model, 3=ripple effect, 4=LLM analogy, 5=hypothesis),
  "inputFact": "the fact used as input",
  "inferenceRule": "the rule applied",
  "outputEntityType": "contract|entity|person|product|flow|policy|asset",
  "outputDomain": one of [${Object.keys(DOMAIN_MAP).join(",")}],
  "estimatedCount": number,
  "confidence": 0.0-1.0,
  "methodology": "directDerivation|statisticalModel|industryRatio|llmEstimation",
  "assumptions": ["assumption1"]
}

Generate 5-15 steps covering multiple domains. Be quantitative and cite the ratios used.`;
}

function parseInferenceSteps(llmResponse: string): InferenceStep[] {
  const match = llmResponse.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    return parsed.filter((s): s is InferenceStep =>
      typeof s === "object" && s !== null && "layer" in s && "estimatedCount" in s
    ).map(s => ({
      ...s,
      layer: Math.max(1, Math.min(5, s.layer)),
      confidence: Math.max(0, Math.min(1, s.confidence ?? BASE_CONFIDENCE[s.layer] ?? 0.5)),
      'outputDomain': s.outputDomain || "unknown",
      assumptions: Array.isArray(s.assumptions) ? s.assumptions : [],
    }));
  } catch { return []; }
}

function detectIndustry(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(vehicle|car|auto|motor|dealer|production.*unit)\b/.test(lower)) return "automotive";
  if (/\b(semiconductor|wafer|fab|chip|foundry|nm process)\b/.test(lower)) return "semiconductor";
  if (/\b(bank|loan|insurance|securities|gdp|financial)\b/.test(lower)) return "finance";
  if (/\b(hospital|physician|patient|pharma|drug|prescription)\b/.test(lower)) return "healthcare";
  if (/\b(container|freight|warehouse|logistics|shipping)\b/.test(lower)) return "logistics";
  return "general";
}

async function cmdInferCoverage(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.inferCoverage", payload);
  if (!req.sourceText) return { error: "sourceText required" };
  const subjectName = req.subjectName ?? req.subjectDid ?? "unknown";
  const industry = req.industry ?? detectIndustry(req.sourceText);
  const chainId = genID("ic");

  const prompt = buildInferencePrompt(subjectName, req.sourceText, industry);
  const llmResult = await llmAsk(prompt);
  const steps = parseInferenceSteps(llmResult);
  if (steps.length === 0) return { error: "inferenceFailed", 'chainId': chainId, 'llmResponse': truncateText(llmResult, 200) };

  write(sdk, "inferenceChain", {
    'chainId': chainId,
    'subjectDid': req.subjectDid ?? `did:web:${appId}.etzhayyim.com:org:${subjectName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    'subjectName': subjectName,
    industry, trigger: "manual",
    'sourceUrl': req.sourceUrl ?? "",
    'stepCount': steps.length,
    status: "active",
    'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
  });

  const cohorts: { 'cohortId': string; domain: string; 'estimatedCount': number; confidence: number }[] = [];
  for (const step of steps) {
    const coverageDomain = DOMAIN_MAP[step.outputDomain] ?? step.outputDomain;
    const canonical = `${subjectName}|${coverageDomain}|${step.outputEntityType}|${step.layer}`;
    const cohortHash = djb2(canonical);
    const cohortId = `infer-${coverageDomain}-${cohortHash}`;

    write(sdk, "inferredCohort", {
      'cohortId': cohortId, 'chainId': chainId,
      'subjectDid': req.subjectDid ?? "",
      'subjectName': subjectName,
      'targetDomain': coverageDomain,
      'entityType': step.outputEntityType,
      layer: step.layer,
      'estimatedCount': step.estimatedCount,
      confidence: step.confidence,
      methodology: step.methodology,
      'inferenceRule': step.inferenceRule,
      'inputFact': step.inputFact,
      assumptions: step.assumptions,
      status: "inferred",
      'cohortHash': cohortHash,
      'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
    });
    cohorts.push({ 'cohortId': cohortId, domain: coverageDomain, 'estimatedCount': step.estimatedCount, confidence: step.confidence });
  }

  if (req.sourceUrl) {
    write(sdk, "inferenceEvidence", {
      'evidenceId': genID("evi"), 'chainId': chainId,
      'sourceType': "irReport", 'sourceUrl': req.sourceUrl,
      'sourceTextExcerpt': truncateText(req.sourceText, 300),
      'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
    });
  }

  const domains = [...new Set(cohorts.map(c => c.domain))];
  const avgConf = cohorts.reduce((s, c) => s + c.confidence, 0) / cohorts.length;

  return { 'chainId': chainId, subject: subjectName, industry, steps: cohorts.length, domains, 'avgConfidence': avgConf };
}

async function cmdGetInferenceChain(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.getInferenceChain", payload);
  if (!req.chainId) return { error: "chainId required" };
  void sdk;
  const db = createKyselyDb();
  const chain = await db
    .selectFrom(VERTEX_INTEL_INFERENCE_CHAIN_TABLE as any)
    .selectAll()
    .where("chain_id", "=", req.chainId)
    .limit(1)
    .execute();
  if (chain.length === 0) return { error: "not found" };
  const cohorts = await db
    .selectFrom(VERTEX_INTEL_INFERRED_COHORT_TABLE as any)
    .selectAll()
    .where("chain_id", "=", req.chainId)
    .execute();
  const evidence = await db
    .selectFrom(VERTEX_INTEL_EVIDENCE_TABLE as any)
    .selectAll()
    .where("payload_json", "like", `%"chainId":"${req.chainId}"%`)
    .execute();
  return { chain: chain[0], cohorts, evidence };
}

async function cmdListInferredCohorts(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.listInferredCohorts", payload);
  const limit = Math.min(Math.max(req.limit ?? 50, 1), 100);
  const offset = req.offset ?? 0;
  void sdk;
  let query: any = createKyselyDb().selectFrom(VERTEX_INTEL_INFERRED_COHORT_TABLE as any).selectAll();
  if (req.domain) query = query.where("target_domain", "=", req.domain);
  if (req.status) query = query.where("status", "=", req.status);
  const rows = await query.limit(limit).offset(offset).execute();
  return { cohorts: rows, count: rows.length, offset, limit };
}

async function cmdCorroborateChain(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.corroborateChain", payload);
  if (!req.chainIdA || !req.chainIdB) return { error: "chainIdA and chainIdB required" };

  const db = createKyselyDb();
  const cohortsA = await db.selectFrom(VERTEX_INTEL_INFERRED_COHORT_TABLE as any).selectAll().where("chain_id", "=", req.chainIdA).execute();
  const cohortsB = await db.selectFrom(VERTEX_INTEL_INFERRED_COHORT_TABLE as any).selectAll().where("chain_id", "=", req.chainIdB).execute();
  if (cohortsA.length === 0 || cohortsB.length === 0) return { error: "one or both chains have no cohorts" };

  const mapB = new Map(cohortsB.map(c => [str(c.targetDomain) + "|" + str(c.entityType), c]));
  const corroborated: { domain: string; 'entityType': string; 'countA': number; 'countB': number; deviation: number; 'newConfidence': number }[] = [];

  for (const a of cohortsA) {
    const key = str(a.targetDomain) + "|" + str(a.entityType);
    const b = mapB.get(key);
    if (!b) continue;
    const countA = Number(a.estimatedCount ?? 0);
    const countB = Number(b.estimatedCount ?? 0);
    if (countA === 0 && countB === 0) continue;
    const avg = (countA + countB) / 2;
    const deviation = Math.abs(countA - countB) / avg;

    if (deviation <= 0.10) {
      const confA = Number(a.confidence ?? 0.5);
      const confB = Number(b.confidence ?? 0.5);
      const newConf = corroborateConfidences([confA, confB]);

      write(sdk, "inferredCohort", {
        'cohortId': str(a.cohortId),
        'chainId': req.chainIdA,
        'corroboratedBy': req.chainIdB,
        'targetDomain': str(a.targetDomain),
        'entityType': str(a.entityType),
        layer: Number(a.layer),
        'estimatedCount': Math.round(avg),
        confidence: newConf,
        methodology: str(a.methodology),
        'inferenceRule': str(a.inferenceRule),
        'inputFact': str(a.inputFact),
        assumptions: [],
        status: "corroborated",
        'cohortHash': str(a.cohortHash),
        'subjectDid': str(a.subjectDid),
        'subjectName': str(a.subjectName),
        'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
      });

      corroborated.push({
        domain: str(a.targetDomain), 'entityType': str(a.entityType),
        'countA': countA, 'countB': countB, deviation, 'newConfidence': newConf,
      });
    }
  }

  if (corroborated.length > 0) {
  }

  return { corroborated, 'totalMatched': corroborated.length, chains: [req.chainIdA, req.chainIdB] };
}

async function cmdStabilizeCohort(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.stabilizeCohort", payload);
  if (!req.cohortId) return { error: "cohortId required" };
  if (req.actualCount == null) return { error: "actualCount required" };

  const rows = await createKyselyDb()
    .selectFrom(VERTEX_INTEL_INFERRED_COHORT_TABLE as any)
    .selectAll()
    .where("cohort_id", "=", req.cohortId)
    .limit(1)
    .execute();
  if (rows.length === 0) return { error: "cohort not found" };
  const cohort = rows[0];
  const estimated = Number(cohort.estimatedCount ?? 0);
  const deviation = estimated > 0 ? (req.actualCount - estimated) / estimated : 0;

  write(sdk, "inferredCohort", {
    'cohortId': req.cohortId,
    'chainId': str(cohort.chainId),
    'targetDomain': str(cohort.targetDomain),
    'entityType': str(cohort.entityType),
    layer: Number(cohort.layer),
    'estimatedCount': estimated,
    'actualCount': req.actualCount,
    confidence: 1.0,
    status: "stable",
    deviation,
    'stabilizedAt': nowISO(),
    'stabilizedBy': req.actualSourceApp ?? "manual",
    notes: req.notes ?? "",
    'subjectDid': str(cohort.subjectDid),
    'subjectName': str(cohort.subjectName),
    methodology: str(cohort.methodology),
    'inferenceRule': str(cohort.inferenceRule),
    'inputFact': str(cohort.inputFact),
    assumptions: [],
    'cohortHash': str(cohort.cohortHash),
    'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
  });

  return { 'cohortId': req.cohortId, estimated, actual: req.actualCount, deviation, status: "stable" };
}

async function cmdGetCoverageProjection(sdk: HostSDK, payload: Uint8Array): Promise<unknown> {
  const req = parseLexiconInput("com.etzhayyim.apps.intel.getCoverageProjection", payload);
  void sdk;
  let query: any = createKyselyDb()
    .selectFrom(VERTEX_INTEL_INFERRED_COHORT_TABLE as any)
    .select([
      "target_domain as domain",
      "status",
      sql<number>`sum(estimated_count)`.as("totalEstimated"),
      sql<number>`avg(confidence)`.as("avgConfidence"),
      sql<number>`count(*)`.as("cohortCount"),
    ])
    .groupBy(["target_domain", "status"]);
  if (req.domain) query = query.where("target_domain", "=", req.domain);
  const byDomain = await query.execute();

  const projection: Record<string, { actual: number; corroborated: number; inferred: number; effective: number; 'cohortCount': number; 'avgConfidence': number }> = {};
  for (const row of byDomain) {
    const domain = str(row.domain);
    const status = str(row.status);
    const total = Number(row.totalEstimated ?? 0);
    const avgConf = Number(row.avgConfidence ?? 0);
    const count = Number(row.cohortCount ?? 0);
    if (!projection[domain]) projection[domain] = { actual: 0, corroborated: 0, inferred: 0, effective: 0, 'cohortCount': 0, 'avgConfidence': 0 };
    const p = projection[domain];
    p.cohortCount += count;
    p.avgConfidence = (p.avgConfidence * (p.cohortCount - count) + avgConf * count) / p.cohortCount;
    if (status === "stable") { p.actual += total; }
    else if (status === "corroborated") { p.corroborated += total; }
    else { p.inferred += total; }
    p.effective = p.actual * 1.0 + p.corroborated * 0.7 + p.inferred * 0.3;
  }

  return { projection, 'domainCount': Object.keys(projection).length };
}

// --- Reactive Inference from Follow Sources ---

async function inferFromCompanyCommit(sdk: HostSDK, commit: ComAtprotoSyncSubscribeReposCommit, sourceName: string, industry: string): void {
  // TODO(intel): rkey-indexed vertex lookup unavailable in @etzhayyim/graph-schema — reactive inference requires caller-supplied payload
  const rows: Array<Record<string, unknown>> = [];
  if (rows.length === 0) return;
  const row = rows[0];
  const companyName = str(row.name ?? row.company ?? row.displayName ?? "");
  if (!companyName) return;

  const revenue = str(row.revenue ?? row.sales ?? row.annualRevenue ?? "");
  const production = str(row.production ?? row.output ?? row.units ?? "");
  const employees = str(row.employees ?? row.employeeCount ?? row.headcount ?? "");
  const subsidiaries = str(row.subsidiaries ?? row.subsidiaryCount ?? "");
  const description = str(row.description ?? row.content ?? row.summary ?? "");

  const facts: string[] = [];
  if (revenue) facts.push(`Revenue: ${revenue}`);
  if (production) facts.push(`Production/Units: ${production}`);
  if (employees) facts.push(`Employees: ${employees}`);
  if (subsidiaries) facts.push(`Subsidiaries: ${subsidiaries}`);
  if (description) facts.push(`Description: ${truncateText(description, 300)}`);

  if (facts.length === 0) return;

  const sourceText = `Company: ${companyName}\nIndustry: ${industry}\n${facts.join("\n")}`;
  const chainId = genID("ic");
  const prompt = buildInferencePrompt(companyName, sourceText, industry);
  const llmResult = await llmAsk(prompt);
  const steps = parseInferenceSteps(llmResult);
  if (steps.length === 0) return;

  write(sdk, "inferenceChain", {
    'chainId': chainId,
    'subjectDid': `did:web:${appId}.etzhayyim.com:org:${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    'subjectName': companyName,
    industry, trigger: "followCommit",
    'sourceUrl': "", 'stepCount': steps.length, status: "active",
    'sourceApp': sourceName, 'sourceCollection': commit.collection, 'sourceRkey': commit.rkey,
    'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
  });

  let cohortCount = 0;
  for (const step of steps) {
    const coverageDomain = DOMAIN_MAP[step.outputDomain] ?? step.outputDomain;
    const canonical = `${companyName}|${coverageDomain}|${step.outputEntityType}|${step.layer}`;
    const cohortHash = djb2(canonical);
    write(sdk, "inferredCohort", {
      'cohortId': `infer-${coverageDomain}-${cohortHash}`, 'chainId': chainId,
      'subjectDid': `did:web:${appId}.etzhayyim.com:org:${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      'subjectName': companyName,
      'targetDomain': coverageDomain, 'entityType': step.outputEntityType,
      layer: step.layer, 'estimatedCount': step.estimatedCount,
      confidence: step.confidence, methodology: step.methodology,
      'inferenceRule': step.inferenceRule, 'inputFact': step.inputFact,
      assumptions: step.assumptions, status: "inferred",
      'cohortHash': cohortHash,
      'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
    });
    cohortCount++;
  }

  if (cohortCount > 0) {
  }
}

// --- Reactive: natural-person cohort/identified person → stabilize intel inferred cohorts ---
function onNaturalPersonCommit(sdk: HostSDK, commit: ComAtprotoSyncSubscribeReposCommit): void {
  const payload = decodeJson(commit.payload);
  if (!payload) return;
  if (commit.collection === "com.etzhayyim.apps.naturalPerson.cohortPerson") {
    const intelChainId = str(payload.intelChainId ?? "");
    if (!intelChainId) return;
    const estimatedCount = Number(payload.intelEstimatedCount ?? 0);
    if (estimatedCount <= 0) return;
    write(sdk, "inferenceEvidence", {
      evidenceId: genID("evi"), chainId: intelChainId,
      sourceApp: "natural-person", sourceCollection: "cohortPerson",
      sourceRkey: commit.rkey ?? "", evidenceType: "cohort-cross-reference",
      value: estimatedCount, confidence: Number(payload.intelConfidence ?? 0.5),
      'createdAt': nowISO(), 'orgId': "anon", 'userId': "anon", 'actorId': appId,
    });
  }
  if (commit.collection === "com.etzhayyim.apps.naturalPerson.identifiedPerson") {
    const name = str(payload.name ?? "");
    const org = str(payload.organization ?? "");
    if (!name) return;
    onPeerIntelCommit(sdk, commit, "natural-person", "demographics");
  }
}

export function handleComAtprotoSyncSubscribeReposCommit(sdk: HostSDK, commit: ComAtprotoSyncSubscribeReposCommit): { ok: true; detail: string } {
  if (commit.action !== "create") return { ok: true, detail: "ignored" };

  if (commit.collection.startsWith("com.etzhayyim.apps.handotai.")) {
    try { onPeerIntelCommit(sdk, commit, "handotai", "semiconductor"); } catch (e: any) { console.warn(`handotai error: ${e?.message ?? e}`); }
    if (commit.collection === "com.etzhayyim.apps.handotai.company") {
      try { inferFromCompanyCommit(sdk, commit, "handotai", "semiconductor"); } catch (e: any) { console.warn(`handotai inference error: ${e?.message ?? e}`); }
    }
    return { ok: true, detail: "processedHandotai" };
  }
  if (commit.collection.startsWith("com.etzhayyim.apps.kuruma.")) {
    try { onPeerIntelCommit(sdk, commit, "kuruma", "automotive"); } catch (e: any) { console.warn(`kuruma error: ${e?.message ?? e}`); }
    if (commit.collection === "com.etzhayyim.apps.kuruma.company") {
      try { inferFromCompanyCommit(sdk, commit, "kuruma", "automotive"); } catch (e: any) { console.warn(`kuruma inference error: ${e?.message ?? e}`); }
    }
    return { ok: true, detail: "processedKuruma" };
  }
  if (commit.collection.startsWith("com.etzhayyim.apps.malak.")) {
    try { onPeerIntelCommit(sdk, commit, "malak", "cybercrime"); } catch (e: any) { console.warn(`malak error: ${e?.message ?? e}`); }
    return { ok: true, detail: "processedMalak" };
  }
  if (commit.collection.startsWith("com.etzhayyim.apps.yabai.")) {
    try { onPeerIntelCommit(sdk, commit, "yabai", "risk-intelligence"); } catch (e: any) { console.warn(`yabai error: ${e?.message ?? e}`); }
    return { ok: true, detail: "processedYabai" };
  }
  if (commit.collection.startsWith("com.etzhayyim.apps.ctUmonitor.")) {
    try { onPeerIntelCommit(sdk, commit, "ct-monitor", "infrastructure-security"); } catch (e: any) { console.warn(`ctMonitor error: ${e?.message ?? e}`); }
    return { ok: true, detail: "processedCtMonitor" };
  }
  if (commit.collection.startsWith("com.etzhayyim.apps.ipaddress.")) {
    try { onPeerIntelCommit(sdk, commit, "ipaddress", "network-intelligence"); } catch (e: any) { console.warn(`ipaddress error: ${e?.message ?? e}`); }
    return { ok: true, detail: "processedIpaddress" };
  }
  if (commit.collection.startsWith("com.etzhayyim.apps.naturalPerson.")) {
    try { onNaturalPersonCommit(sdk, commit); } catch (e: any) { console.warn(`naturalPerson error: ${e?.message ?? e}`); }
    return { ok: true, detail: "processedNaturalPerson" };
  }
  if (commit.collection.startsWith("com.etzhayyim.apps.intel.")) {
    return { ok: true, detail: "processedInternal" };
  }

  return { ok: true, detail: "ignored" };
}

// Layer 3: Shinka (Social Evolution)
const shinkaEnabled = true; // domain: intel
// --- Multi-DID ---

// --- Domain Types ---

interface IntelRecord {
  id: string;
  name: string;
  status: string;
  category: string;
  'createdAt': string;
  'orgId': string;
  'userId': string;
  'actorId': string;
}

const INTEL_STATUSES = ["active", "draft", "archived", "pending", "completed", "cancelled"] as const;

const INTEL_CATEGORIES = new Map<string, string>([
  ["default", "General"],
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["archived", "Archived"],
]);

// --- Domain Collection Writers ---

// --- Domain Enrichment ---

// --- Domain Graph Queries ---

// --- DID Initialization ---

// --- cross-actor invoke ---

export async function runHeartbeat(sdk: HostSDK): Promise<{ ok: boolean; actions: Array<Record<string, unknown>> }> {
  const actions: Array<Record<string, unknown>> = [];
  const ts = nowISO();
  const cadence = await resolveHeartbeatCadence("did:web:i7n73l0x.etzhayyim.com", cadenceState, inbox);
  actions.push({ action: "cadenceResolved", mood: cadence.mood, reason: cadence.reason, ts });

  // --- shouldDrill: kyumei-koji self-research ---

  // --- shouldAnalyze: domain data analysis ---

  // --- shouldValidate: data quality check ---

  if (actions.length === 1) actions.push({ action: "noop", mood: cadence.mood, ts });
  return { ok: true, actions };
}

// --- Extended Commands ---

async function cmdStats(sdk: HostSDK, _p: Uint8Array): Promise<unknown> {
  // TODO(intel): actorId is not a promoted column on any vertex_* table — stats unavailable
  void sdk;
  const data: Array<Record<string, unknown>> = [];
  return { stats: data, agent: "Intel" };
}

async function cmdExportData(sdk: HostSDK, p: Uint8Array): Promise<unknown> {
  const args = JSON.parse(str(p) || "{}");
  const lim = Math.min(Number(args.limit) || 100, 1000);
  // TODO(intel): actorId is not a promoted column on any vertex_* table — export unavailable
  void sdk; void lim;
  const data: Array<Record<string, unknown>> = [];
  return { format: "json", data };
}

function cmdDescribe(_sdk: HostSDK, _p: Uint8Array): unknown {
  return { name: "Intel", did: `did:web:${appId}.etzhayyim.com`, nanoid: "i7n73l0x",
    capabilities: ["info", "status", "stats", "export", "describe", "summarize", "audit"],
    protocols: ["xrpc", "w-protocol", "mcp"] };
}

async function cmdSummarize(sdk: HostSDK, p: Uint8Array): Promise<unknown> {
  const args = JSON.parse(str(p) || "{}");
  const topic = str(args.topic ?? "Intel");
  // TODO(intel): actorId is not a promoted column on any vertex_* table — summarize runs on empty input
  void sdk;
  const data: Array<Record<string, unknown>> = [];
  const summary = await llmAsk(`Summarize ${topic}: ${JSON.stringify(data)}`);
  return { summary, topic };
}

async function cmdAudit(sdk: HostSDK, p: Uint8Array): Promise<unknown> {
  const args = JSON.parse(str(p) || "{}");
  const lim = Math.min(Number(args.limit) || 50, 200);
  // TODO(intel): actorId is not a promoted column on any vertex_* table — audit unavailable
  void sdk; void lim;
  const data: Array<Record<string, unknown>> = [];
  return { audit: data, count: data.length };
}

async function cmdIngest(_sdk: HostSDK, p: Uint8Array): Promise<unknown> {
  const args = JSON.parse(str(p) || "{}");
  void args;
  const jobId = `ingest-${Date.now()}`;
  const rkey = jobId;
  const actorDID = "did:web:intel.etzhayyim.com";
  const vertexId = `at://${actorDID}/${INTEL_REPORT_COLLECTION}/${rkey}`;
  await createKyselyDb().insertInto(VERTEX_INTEL_REPORT_TABLE as any).values({
    vertex_id: vertexId,
    sensitivity_ord: 2,
    owner_did: actorDID,
    actor_id: appId,
    type: "ingestJob",
    status: "pending",
    created_at: nowISO(),
    org_id: "anon",
    user_id: "anon",
  } as any).execute();
  return { jobId, status: "pending" };
}

export default createWorkerExport((sdk) => {
  appId = sdk.pds.selfNanoid ?? "";
  sdk.app
      .command(nsid("com.etzhayyim.apps.intel.submitAnalysis"), (_, body) => cmdSubmitAnalysis(sdk, body), asAgentTool("Submit source text for LLM analysis"), withCapabilityTags("analysis", "ingest"), withOCELEvent("governance.audit"))
      .command(nsid("com.etzhayyim.apps.intel.getAnalysis"), (_, body) => cmdGetAnalysis(sdk, body), asAgentTool("Get analysis by ID"), withCapabilityTags("analysis", "query"))
      .command(nsid("com.etzhayyim.apps.intel.listAnalyses"), (_, body) => cmdListAnalyses(sdk, body), asAgentTool("List analyses with filters"), withCapabilityTags("analysis", "query"))
      .command(nsid("com.etzhayyim.apps.intel.getNeighbors"), (_, body) => cmdGetNeighbors(sdk, body), asAgentTool("Get related analyses for entity"), withCapabilityTags("entity", "graph"))
      .command(nsid("com.etzhayyim.apps.intel.searchEntities"), (_, body) => cmdSearchEntities(sdk, body), asAgentTool("Search extracted entities"), withCapabilityTags("entity", "search"))
      .command(nsid("com.etzhayyim.apps.intel.getDashboard"), (_, body) => cmdGetDashboard(sdk, body), asAgentTool("Get intel dashboard metrics"), withCapabilityTags("analytics", "query"))
      .command(nsid("com.etzhayyim.apps.intel.inferCoverage"), (_, body) => cmdInferCoverage(sdk, body), asAgentTool("Generate inference chain for coverage from source data"), withCapabilityTags("inference", "coverage"))
      .command(nsid("com.etzhayyim.apps.intel.getInferenceChain"), (_, body) => cmdGetInferenceChain(sdk, body), asAgentTool("Get inference chain with cohorts"), withCapabilityTags("inference", "query"))
      .command(nsid("com.etzhayyim.apps.intel.listInferredCohorts"), (_, body) => cmdListInferredCohorts(sdk, body), asAgentTool("List inferred cohorts by domain/status"), withCapabilityTags("inference", "query"))
      .command(nsid("com.etzhayyim.apps.intel.corroborateChain"), (_, body) => cmdCorroborateChain(sdk, body), asAgentTool("Cross-validate two inference chains"), withCapabilityTags("inference", "corroboration"))
      .command(nsid("com.etzhayyim.apps.intel.stabilizeCohort"), (_, body) => cmdStabilizeCohort(sdk, body), asAgentTool("Stabilize cohort with real data"), withCapabilityTags("inference", "stabilization"))
      .command(nsid("com.etzhayyim.apps.intel.getCoverageProjection"), (_, body) => cmdGetCoverageProjection(sdk, body), asAgentTool("Get inferred coverage projection by domain"), withCapabilityTags("inference", "coverage"))
      .command(nsid("com.etzhayyim.apps.intel.stats"), (_ctx, p) => cmdStats(sdk, p), asAgentTool("Get statistics"), withCapabilityTags("intel", "analytics"))
      .command(nsid("com.etzhayyim.apps.intel.exportData"), (_ctx, p) => cmdExportData(sdk, p), asAgentTool("Export data"), withCapabilityTags("intel", "export"))
      .command(nsid("com.etzhayyim.apps.intel.describe"), (_ctx, p) => cmdDescribe(sdk, p), asAgentTool("Describe capabilities"), withCapabilityTags("intel", "meta"))
      .command(nsid("com.etzhayyim.apps.intel.summarize"), (_ctx, p) => cmdSummarize(sdk, p), asAgentTool("AI summary"), withCapabilityTags("intel", "ai"))
      .command(nsid("com.etzhayyim.apps.intel.audit"), (_ctx, p) => cmdAudit(sdk, p), asAgentTool("Audit log"), withCapabilityTags("intel", "audit"))
      .command(nsid("com.etzhayyim.apps.intel.ingest"), (_ctx, p) => cmdIngest(sdk, p), asAgentTool("Trigger ingestion"), withCapabilityTags("intel", "pipeline"))
});
