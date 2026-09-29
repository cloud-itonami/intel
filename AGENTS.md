> **DEPRECATED**: Actor migrated to `20-actors/intel/actor-manifest.jsonld` (T1 MCP-Compose). This project wasm/*/src/app.ts is retained as T3 fallback only.

# etzhayyim-project-intel — Multi-INT Fusion Intelligence Platform

**intel.etzhayyim.com** — 30 INT discipline を統合した LLM 駆動 intelligence analysis platform

## Architecture

| 項目 | 値 |
|---|---|
| nanoid | `i7n73l0x` |
| URL | `https://intel.etzhayyim.com` / `https://i7n73l0x.etzhayyim.com` |
| Runtime | Worker WASM (default) |
| UI mode | appview |
| Sensitivity | **cui** (default classification) |
| Service path | `/xrpc/etzhayyim.intel.v1.IntelService` |
| LLM | Murakumo `qwen3-vl-8b` |
| Version | `0.2.0` |

## Graph Schema

| Node Label | ID Pattern | 用途 |
|---|---|---|
| `IntelAnalysis` | `intel-{ts}-{seq}` / `crawl-{ts}-{seq}` / `peer-{ts}-{seq}` / `hb-{ts}-{seq}` / `plan-{ts}-{seq}` | LLM 分析結果 (source_family: public/crawler/collection_plan/domain) |
| `Entity` | `intel:{sanitized_name}` (CURIE) | 抽出エンティティ (person/org/location/event/technology/other) |
| `IntelSource` | `intel:source-{family}` (CURIE) | データソース定義 (crawler, API, manual) |
| `IntelPending` | `{analysis_id}` | LLM 呼び出し失敗 → retry 待ちの prompt 保存 |
| `IntelAlert` | `scan-{ts}-{seq}` | OSINT scan 結果 |
| `App` | `i7n73l0x` | self engagement tracking |

| Edge | 意味 |
|---|---|
| `INVOLVES` | IntelAnalysis → Entity (分析がエンティティに言及) |
| `DERIVED_FROM` | IntelAnalysis → IntelSource (分析のソース追跡) |

## Path-Based DID (entity identity)

LLM で抽出された identity-bearing entity に対して path-based DID を自動作成:

| Entity Type | DID Path | 例 |
|---|---|---|
| person | `person:{slug}` | `did:web:intel.etzhayyim.com:person:john_doe` |
| org | `org:{slug}` | `did:web:intel.etzhayyim.com:org:tsmc` |
| technology | `tech:{slug}` | `did:web:intel.etzhayyim.com:tech:euv_lithography` |
| location | `geo:{slug}` | `did:web:intel.etzhayyim.com:geo:tokyo` |
| event, other | — (DID 不要) | graph node のみ |

DID 作成時に `entity_did` record を Domain 記録 + social announce。

## Classification Vocabulary

| Level | Description | Public Release |
|---|---|---|
| `public` | 公開可 | ✓ |
| `unclassified` | 未分類 | ✓ |
| `cui` | Controlled Unclassified (DEFAULT) | ✗ |
| `confidential` | 機密 | ✗ |
| `secret` | 極秘 | ✗ |
| `top_secret` | 最高機密 | ✗ |

## XRPC Methods (16)

| Method | 用途 | Required params |
|---|---|---|
| `SubmitAnalysis` | ソーステキスト → Murakumo LLM 分析 → entity graph 生成 | `title`, `source_text` |
| `GetAnalysis` | 分析結果取得 | `id` |
| `GetAnalysisStatus` | status 確認 + pending 自動 retry | `id` |
| `ListAnalyses` | org-scoped paginated list | — |
| `GetPublicExport` | public/unclassified のみ JSON-LD export | `id` |
| `GetCapabilities` | introspection: features, methods, security | — |
| `ListTools` | MCP tool definitions | — |
| `GetDashboard` | 集計メトリクス | — |
| `GetNeighbors` | entity の INVOLVES 経由隣接 entity | `entity_id` |
| `TraverseGraph` | N-hop BFS (max 5) | `start_entity_id` |
| `QueryEntityGraph` | free-form read-only SQL (org-scoped) | `query` |
| `Chat` | Murakumo LLM 自由対話 | `message` |
| `SyncFromCrawler` | crawler 結果 batch ingest | `items[]` |
| `ScheduledScan` | OSINT scan trigger | — |
| `PlanCollection` | collection plan LLM 生成 | `objective` |
| `GetCollectionPlan` | plan 取得 | `plan_id` |

## 3 軸 INT Taxonomy (30 disciplines)

| source_family | collection_method | analytic_lens 例 |
|---|---|---|
| public | crawl, api-pull | OSINT, WEBINT, SOCMINT, DATAMININT |
| human | manual-report, upload | HUMINT, CULTINT, POLINT, RELINT |
| signals | sensor-feed | SIGINT, COMINT, ELINT |
| geospatial | sensor-feed | GEOINT, IMINT, SARINT, FMV |
| cyber | api-pull, crawl | CYBINT, DIGINT |
| finance | api-pull | FININT, ECONINT, TRADEINT |
| scientific | upload | MASINT, TECHINT, MEDINT |
| behavioral | location-feed | MOBINT, LOCINT, TRACKINT |

## Data Pipeline

```
SubmitAnalysis(title, source_text)
  → generateID → buildAnalysisPrompt
  → callMurakumo (qwen3-vl-8b)
  → parse JSON (classification, summary, entities, facts, findings)
  → upsertAnalysisNode (SQL MERGE IntelAnalysis)
  → extractAndLinkEntities (Entity node + INVOLVES edge)
  → pushEntityToYabai (best-effort risk evaluation)
```

**Retry pattern**: LLM 失敗 → `IntelPending` node に prompt 保存 → `GetAnalysisStatus` 時に自動 retry

## Follow Sources (reactive pipeline)

| Source | nanoid | Collections | 用途 |
|---|---|---|---|
| handotai.etzhayyim.com | `dtyy44cr` | `article`, `company`, `product` | 半導体 intel |
| kuruma.etzhayyim.com | `qewr7sl0` | `article`, `company`, `product` | 自動車 intel |
| malak.etzhayyim.com | `m4l4k001` | `threat_actor`, `intel_report`, `osint_finding`, `email_message` | Cybercrime intelligence |
| yabai.etzhayyim.com | `y8b41k0x` | `entity`, `alert`, `risk` | Risk intelligence (AML/CTI) |
| ct-monitor.etzhayyim.com | `ctm0n1t0` | `ct_alert`, `bgp_alert`, `kev_entry` | CT/BGP/CVE 監視 |
| ipaddress.etzhayyim.com | `n7w1p4d0` | `ip_address`, `ip_analysis` | IP/ASN intelligence |
| natural-person.etzhayyim.com | `np02priv9` | `cohortPerson`, `identifiedPerson` | Demographics intel (cohort cross-reference, person identification) |

## Cross-actor Integration (outbound)

| Target | 用途 |
|---|---|
| yabai.etzhayyim.com (`y8b41k0x`) | Entity risk evaluation (best-effort push via XRPC) |

## Reactive Pipeline (handleComAtprotoSyncSubscribeReposCommit)

```
Follow source commit → handleComAtprotoSyncSubscribeReposCommit switch
  ├── com.etzhayyim.apps.handotai.* → onPeerIntelCommit("handotai", "semiconductor")
  ├── com.etzhayyim.apps.kuruma.*   → onPeerIntelCommit("kuruma", "automotive")
  ├── com.etzhayyim.apps.malak.*    → onPeerIntelCommit("malak", "cybercrime")
  ├── com.etzhayyim.apps.yabai.*    → onPeerIntelCommit("yabai", "risk-intelligence")
  ├── com.etzhayyim.apps.ct_monitor.* → onPeerIntelCommit("ct-monitor", "infrastructure-security")
  ├── com.etzhayyim.apps.naturalPerson.* → onNaturalPersonCommit (cohort cross-ref + demographics intel)
  ├── com.etzhayyim.apps.ipaddress.*  → onPeerIntelCommit("ipaddress", "network-intelligence")
  └── com.etzhayyim.apps.intel.{report|source|indicator} → domain record ingest

onPeerIntelCommit flow:
  1. Parse payload → extract title/content
  2. callMurakumo (LLM analysis) → entities, classification, summary
  3. upsertAnalysisNode (IntelAnalysis graph node)
  4. extractAndLinkEntities (Entity nodes + INVOLVES edges)
  5. pushEntityToYabai (best-effort risk enrichment)
  6. AppBskyFeedPost (social announce)
```

## Heartbeat (60s interval)

```
handleHeartbeat(feedJSON, engagementJSON)
  1. Parse feed items from followed apps
  2. For each create action with payload:
     → ComAtprotoRepoCreateRecord("feedObservation")
     → upsertAnalysisNode (pending, awaiting analysis)
     → createDerivedFromEdge (source tracking)
  3. Persist engagement snapshot (App node)
  4. FollowAckFeed (cursor advance)
```

## Governance (RACI)

| Command | Responsible | Accountable | BPMN Task |
|---|---|---|---|
| SubmitCollectionRun | intel-collector | intel-lead | intel.collection.run |
| RegisterObservation | intel-analyst | intel-lead | intel.observation.register |
| AcknowledgeAlert | watch-officer | intel-duty-manager | intel.alert.acknowledge |

## Inference Coverage Engine

**統計推論 → 交差検証 → 実データ安定化** の 3-Phase で `etzhayyim coverage` domain に推定 entity 数を供給する。natural-person の cohort パターンを経済/産業 intelligence に適用。

### Graph Schema (Inference)

| Node Label | ID Pattern | 用途 |
|---|---|---|
| `InferenceChain` | `ic-{ts}-{seq}` | 推論チェーン (subject + steps + industry) |
| `InferredCohort` | `infer-{domain}-{djb2_hash}` | 推論 cohort entity (DJB2 hash dedup) |
| `InferenceEvidence` | `evi-{ts}-{seq}` | 推論根拠 (URL, 統計値, commit) |

| Edge | 意味 |
|---|---|
| `INFERRED_FROM` | InferredCohort → InferenceChain |
| `EVIDENCED_BY` | InferenceChain → InferenceEvidence |
| `SUPERSEDED_BY` | InferredCohort → 実 DID/Record |
| `CORROBORATES` | InferenceChain → InferenceChain |

### Status Lifecycle

`inferred` (single source, c≥0.5) → `corroborated` (2+ sources within 10%, c≥0.7) → `stable` (実データ verified) → `revision` (deviation>20%)

### Confidence Decay

L1=0.95 (直接導出), L2=0.80 (統計), L3=0.60 (波及), L4=0.40 (LLM), L5=0.20 (仮説)。90日 half-life。

### Coverage Weight

`EFFECTIVE = ACTUAL×1.0 + CORROBORATED×0.7×confidence + INFERRED×0.3×confidence`

### Industry Templates

`automotive`, `semiconductor`, `finance`, `healthcare`, `logistics` — 業界比率 (ratios) を LLM コンテキストに注入。

### XRPC Methods (Inference, 6)

| Method | 用途 | Params |
|---|---|---|
| `InferCoverage` | subject entity → Murakumo LLM → 推論チェーン → cohort 生成 | `subject_name`, `source_text`, `source_url?`, `industry?` |
| `GetInferenceChain` | チェーン + cohorts + evidence 取得 | `chain_id` |
| `ListInferredCohorts` | domain/status/confidence filter 一覧 | `domain?`, `status?`, `min_confidence?` |
| `CorroborateChain` | 2 chain 交差検証 → cohort status 昇格 | `chain_id_a`, `chain_id_b` |
| `StabilizeCohort` | 実データで cohort 安定化 | `cohort_id`, `actual_count`, `actual_source_app?` |
| `GetCoverageProjection` | domain 別推論 coverage サマリ | `domain?` |

### Reactive Inference (Follow → 自動推論)

| Source | Trigger | Industry |
|---|---|---|
| `com.etzhayyim.apps.handotai.company` | company commit → `inferFromCompanyCommit` | semiconductor |
| `com.etzhayyim.apps.kuruma.company` | company commit → `inferFromCompanyCommit` | automotive |

設計: `260329-intel-inference-coverage-design.md`

## Known Limitations

- `kotodama.jsonld` の `interfaces.package` が `etzhayyim:intel@0.1.0` (古い) — WIT は `etzhayyim:intel-i7n73l0x` に移行済み
- HTTP routing (`kotodama.Handle(handleHTTP)`) と `app.Command` が二重 init — 要統一

## Dependency Graph Inference (2026-04-25)

`intel.etzhayyim.com` now also owns a BPMN-as-actor dependency inference surface:

- Lexicons: `00-contracts/lexicons/com/etzhayyim/apps/intel/`
- BPMN: `etzhayyim-root/00-contracts/bpmn/com/etzhayyim/intel/`
- Schema and BPMN binding seed: `30-graph/graph-schema/migrations/20260425193000_intel_dependency_graph.ts`
- K8s worker: `50-infra/k8s/intel-dependency-worker/`

First slice:

- infer `Building -> owned_by / operated_by / constructed_by -> LegalEntity`
- upgrade confidence when owner has LEI evidence
- persist candidates in `edge_intel_dependency`
- split `confidence >= 0.85` to `active`, otherwise `candidate`

Reasoning split:

- SQL/RisingWave creates bulk candidates.
- OWL/SHACL constrains type-valid relations.
- LangGraph/LLM is reserved for ambiguous resolution and explanation.

Kubernetes resources must use namespace `intel`; creating resources in
`default` is prohibited.
