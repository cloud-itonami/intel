# Intel Inference Coverage Design

**Date**: 2026-03-29
**Status**: Design
**Author**: AI Agent (intel.etzhayyim.com)

## Problem

`etzhayyim coverage` は 403 world domains × real-world total で coverage gap を可視化する。現状は各 app が 1次ソース ingest した DID/Record のみをカウントするため、coverage は実データ依存で gap が大きい。

Intel は 30 INT disciplines + Murakumo LLM + follow source 6 app のデータを持つ。これを使い **推論による coverage 生成** を行い、natural-person の cohort パターンと同様に「統計推論 → 実データで安定化」の 2 phase で coverage を埋める。

## Core Concept: Inference Chain Coverage

### Toyota 例

```
[1次ソース: 公開データ]
  Toyota IR: 2025年度 グローバル販売台数 10,500,000 台
  Toyota IR: 生産台数 10,200,000 台
  Toyota IR: 連結子会社 541 社、関連会社 176 社

[推論 Layer 1: 直接導出]
  販売台数 10.5M → 販売契約 10.5M 件 (1台=1契約)
  販売台数 10.5M → ディーラー契約 ~170,000 件 (平均 62台/ディーラー/年)
  生産台数 10.2M → 部品調達契約 ~30,000 件 (Tier1 サプライヤー)
  連結子会社 541 → 法人エンティティ 541 DID
  関連会社 176 → 法人エンティティ 176 DID

[推論 Layer 2: 統計的導出]
  部品調達 30,000 → 物流契約 ~90,000 件 (1 Tier1 = ~3 物流ルート)
  販売 10.5M → アフターサービス契約 ~6.3M 件 (60% 加入率)
  販売 10.5M → 自動車保険契約 ~9.5M 件 (90% 付保率)
  販売 10.5M → 自動車ローン契約 ~5.3M 件 (50% ローン比率)
  生産 10.2M → 資源フロー: 鉄鋼 ~1.5M ton, アルミ ~0.3M ton, 樹脂 ~0.5M ton

[推論 Layer 3: 波及効果]
  ディーラー 170K → 雇用者 ~850,000 人 (平均 5名/店)
  Tier1 30K → Tier2 ~150,000 社 (平均 5 Tier2/Tier1)
  保険 9.5M → 保険金請求 ~0.5M 件/年 (事故率 5%)
```

### Coverage Domain への mapping

| 推論結果 | etzhayyim coverage domain | WorldTotal への寄与 | DID path |
|---|---|---|---|
| 販売契約 10.5M | `koyo_keiyaku` (契約) | 10,500,000 contracts | `intel:infer:toyota:sales_contract:{cohort_hash}` |
| 法人 717 | `legal_entity` | 717 entities | `intel:infer:toyota:entity:{slug}` |
| 部品調達 30K | `supply_chain` | 30,000 contracts | `intel:infer:toyota:procurement:{cohort_hash}` |
| 物流 90K | `resource_flow` | 90,000 flows | `intel:infer:toyota:logistics:{cohort_hash}` |
| 保険 9.5M | `insurance` | 9,500,000 policies | `intel:infer:toyota:insurance:{cohort_hash}` |
| 資源フロー | `resource_flow` | tonnage entries | `intel:infer:toyota:material:{material}:{cohort_hash}` |

## Architecture: Inference-to-Stable Pipeline

### Phase 1: Statistical Inference (Cohort Generation)

natural-person の cohort パターンを経済/産業 intelligence に適用する。

```
[Input Sources]
  1. Follow source commits (handotai/kuruma/malak/yabai/ct-monitor/ipaddress)
  2. 公開統計 (IR, 政府統計, 業界団体レポート)
  3. Murakumo LLM による推論

[Inference Engine]
  cmdInferCoverage(subject, source_data)
    → Murakumo LLM: 推論チェーン生成
    → 各推論ステップに confidence_score 付与
    → cohort record 生成 (path-based DID)

[Output: Cohort Records]
  ComAtprotoRepoCreateRecord("inferred_cohort", {
    subject_did: "did:web:intel.etzhayyim.com:org:toyota",
    inference_chain_id: "ic-{timestamp}-{seq}",
    layer: 1,                          // 推論の深さ
    source_type: "ir_report",          // 1次ソース種別
    source_url: "https://...",         // evidence link
    target_domain: "koyo_keiyaku",     // etzhayyim coverage domain
    entity_type: "contract",
    estimated_count: 10500000,
    confidence: 0.95,                  // Layer 1 = high confidence
    methodology: "direct_derivation",  // 推論手法
    assumptions: ["1_vehicle_1_contract"],
    cohort_hash: DJB2(canonical_string),
    status: "inferred",                // inferred → corroborated → stable
    org_id, user_id, actor_id
  })
```

### Phase 2: Corroboration (交差検証)

複数ソースからの推論が一致すると confidence が上昇し `corroborated` に昇格。

```
[Cross-INT Corroboration]
  FININT: Toyota 売上高 45兆円 ÷ 平均単価 430万円 ≈ 10.5M 台 → 販売台数と一致 (confidence +0.03)
  TRADEINT: 日本自動車工業会 統計 → Toyota 国内販売 1.5M + 海外 9.0M ≈ 10.5M → 一致 (confidence +0.02)
  OSINT: ディーラー web scraping → 推定 168,000 店舗 vs 推論 170,000 → 誤差 1.2% (confidence +0.01)

[Status Transition]
  inferred (single source) → corroborated (2+ sources agree within 10% margin)
    confidence = 1 - Π(1 - c_i)  // 各ソースの confidence の積の補数
```

### Phase 3: Stabilization (実データ置換)

実データが到着すると cohort record を `stable` に昇格し、実 DID にリンク。

```
[Stable Transition]
  kuruma.etzhayyim.com から Toyota ディーラー一覧 ingest
    → 実際の 168,432 ディーラー DID 作成
    → inferred_cohort (170,000 推定) を stable に更新
    → actual_count: 168,432, deviation: -0.9%
    → SUPERSEDED_BY edge: cohort → real DID 群

  legal-entity.etzhayyim.com から Toyota グループ法人 ingest
    → 実際の 717 法人 (541 連結 + 176 関連)
    → inferred_cohort (717 推定) を stable に更新
    → deviation: 0.0% (IR 数値が正確)
```

## Inference Chain Model

### Chain Structure

```
InferenceChain {
  id: "ic-{timestamp}-{seq}",
  subject: "did:web:intel.etzhayyim.com:org:toyota",
  trigger: "ir_report_2025" | "follow_commit" | "scheduled_scan",
  created_at: ISO8601,
  steps: InferenceStep[]
}

InferenceStep {
  layer: 1..5,
  input_fact: string,            // "Toyota 2025 global sales: 10.5M vehicles"
  inference_rule: string,         // "1 vehicle sale = 1 sales contract"
  output_entity_type: string,     // "contract"
  output_domain: string,          // etzhayyim coverage domain name
  estimated_count: number,
  confidence: 0.0..1.0,
  methodology: "direct_derivation" | "statistical_model" | "industry_ratio" | "llm_estimation",
  assumptions: string[],
  evidence_urls: string[]
}
```

### Confidence Decay by Layer

| Layer | 手法 | 基準 confidence | 例 |
|---|---|---|---|
| L1 | 直接導出 (1:1 mapping) | 0.90-0.99 | 販売台数 → 販売契約数 |
| L2 | 統計的導出 (業界比率) | 0.70-0.89 | 販売台数 × ローン比率 → ローン契約数 |
| L3 | 波及効果 (乗数推定) | 0.50-0.69 | Tier1 × 平均 Tier2 数 → Tier2 企業数 |
| L4 | LLM 推論 (類推) | 0.30-0.49 | 類似企業の比率から推定 |
| L5 | 仮説 (未検証) | 0.10-0.29 | 市場動向からの外挿 |

### Graph Schema (追加)

| Node Label | ID Pattern | 用途 |
|---|---|---|
| `InferenceChain` | `ic-{ts}-{seq}` | 推論チェーン (subject DID + steps) |
| `InferredCohort` | `infer-{domain}-{cohort_hash}` | 推論による cohort entity |
| `InferenceEvidence` | `evi-{ts}-{seq}` | 推論の根拠 (URL, 統計値, follow commit) |

| Edge | 意味 |
|---|---|
| `INFERRED_FROM` | InferredCohort → InferenceChain |
| `EVIDENCED_BY` | InferenceChain → InferenceEvidence |
| `SUPERSEDED_BY` | InferredCohort → (実 DID/Record) |
| `CORROBORATES` | InferenceChain → InferenceChain (交差検証) |

## Coverage Integration: `etzhayyim coverage` への反映

### 3-Tier Coverage Count

`etzhayyim coverage` の domain DID count に Intel inference を段階的に反映する。

| Tier | Source | Weight | 表示 |
|---|---|---|---|
| **Actual** | 各 app が ingest した実 DID | 1.0 | `COLLECTED` (現行) |
| **Corroborated** | Intel 推論 (2+ sources, confidence ≥ 0.7) | 0.7 | `INFERRED (C)` |
| **Inferred** | Intel 推論 (single source, confidence ≥ 0.5) | 0.3 | `INFERRED (I)` |

```
etzhayyim coverage 出力例:

DOMAIN          ACTUAL     INFERRED(C)  INFERRED(I)  EFFECTIVE   WORLD TOTAL   COVERAGE
koyo_keiyaku    12,000     8,500,000    15,200,000   5,972,000   33,000,000,000  0.018%
legal_entity    45,000     320,000      1,200,000    269,000     300,000,000     0.090%
insurance       0          9,500,000    22,000,000   6,650,000   116,000,000,000 0.006%
resource_flow   1,200      0            3,500,000    1,051,200   2,200,000,000   0.048%

EFFECTIVE = ACTUAL×1.0 + INFERRED(C)×0.7 + INFERRED(I)×0.3
```

### PDS Query Extension

Intel inference cohort は `intel.etzhayyim.com` の path-based DID として登録されるため、既存の `etzhayyim coverage` Cypher query で自然にカウントされる。ただし inference tier 区別のため、`InferredCohort` node に `status` property を付与。

```cypher
// Actual count (現行)
MATCH (d:Did) WHERE d.repo CONTAINS '{domain}.etzhayyim.com' RETURN count(d) LIMIT 1

// Intel inference count (追加)
MATCH (c:InferredCohort {target_domain: '{domain}', status: 'corroborated'})
RETURN sum(c.estimated_count) AS corroborated_total LIMIT 1

MATCH (c:InferredCohort {target_domain: '{domain}', status: 'inferred'})
RETURN sum(c.estimated_count) AS inferred_total LIMIT 1
```

## Command Design (app.ts 追加)

### 新規 XRPC Methods

| Method | 用途 | Params |
|---|---|---|
| `InferCoverage` | subject entity から coverage 推論チェーン生成 | `subject_did`, `source_text?`, `source_url?` |
| `GetInferenceChain` | 推論チェーン取得 | `chain_id` |
| `ListInferredCohorts` | domain 別 cohort 一覧 | `domain?`, `status?`, `min_confidence?` |
| `CorroborateChain` | 2つの chain を交差検証 | `chain_id_a`, `chain_id_b` |
| `StabilizeCohort` | cohort を実データで安定化 | `cohort_id`, `actual_count`, `actual_dids?` |
| `GetCoverageProjection` | domain 別の推論 coverage サマリ | `domain?` |

### Pipeline Integration

```
[Reactive: Follow source → 自動推論]
handleComAtprotoSyncSubscribeReposCommit
  ├── com.etzhayyim.apps.handotai.company → inferFromCompanyData("semiconductor")
  │     Toyota Semiconductor (仮): 半導体調達量 → 推論チェーン
  ├── com.etzhayyim.apps.kuruma.company  → inferFromCompanyData("automotive")
  │     Toyota: IR データ → 販売/生産/サプライチェーン推論
  └── com.etzhayyim.apps.malak.threat_actor → inferFromThreat("cybercrime")
        攻撃グループ → 標的業界 → 被害推定 → coverage

[Scheduled: 定期推論更新]
handleHeartbeat
  1. 既存 InferenceChain の confidence decay チェック (90日で -0.1)
  2. 新しい follow source commit と既存推論の交差検証
  3. stable 化可能な cohort の自動検出
```

## Inference Template Library

### 業界別推論テンプレート

各業界に特有の推論ルール (industry ratio) を Murakumo LLM のコンテキストとして提供する。

#### 自動車 (automotive)

```json
{
  "industry": "automotive",
  "ratios": {
    "sales_to_contract": 1.0,
    "sales_to_dealer": 62,
    "sales_to_loan_rate": 0.50,
    "sales_to_insurance_rate": 0.90,
    "sales_to_afterservice_rate": 0.60,
    "production_to_tier1": 340,
    "tier1_to_tier2": 5,
    "dealer_to_employee": 5,
    "production_to_steel_ton": 0.143,
    "production_to_aluminum_ton": 0.029
  },
  "sources": [
    "日本自動車工業会 統計",
    "OICA World Motor Vehicle Statistics",
    "各社 IR/有価証券報告書"
  ]
}
```

#### 半導体 (semiconductor)

```json
{
  "industry": "semiconductor",
  "ratios": {
    "revenue_to_wafer_starts": 0.000012,
    "fab_to_equipment_vendor": 15,
    "fab_to_chemical_supplier": 25,
    "design_house_to_ip_license": 3,
    "foundry_customer_per_fab": 50
  },
  "sources": [
    "SEMI World Fab Forecast",
    "IC Insights",
    "WSTS Semiconductor Market Statistics"
  ]
}
```

#### 金融 (finance)

```json
{
  "industry": "finance",
  "ratios": {
    "population_to_bank_account": 1.5,
    "gdp_to_loan_volume": 1.2,
    "insurance_penetration": 0.07,
    "securities_account_per_capita": 0.15,
    "transaction_per_account_per_year": 120
  },
  "sources": [
    "World Bank Global Findex",
    "BIS Statistics",
    "各国金融庁統計"
  ]
}
```

## Data Flow Summary

```
                                     ┌─────────────────┐
                                     │  etzhayyim coverage   │
                                     │  (world_coverage │
                                     │   .go)           │
                                     └────────┬────────┘
                                              │ Cypher query
                                              ▼
┌──────────────┐  Follow    ┌──────────────────────────────────┐
│ handotai     │──commit──▶│         intel.etzhayyim.com             │
│ kuruma       │──commit──▶│                                    │
│ malak        │──commit──▶│  1. Reactive inference             │
│ yabai        │──commit──▶│     (follow commit → LLM chain)   │
│ ct-monitor   │──commit──▶│                                    │
│ ipaddress    │──commit──▶│  2. Scheduled inference            │
└──────────────┘           │     (heartbeat → chain refresh)    │
                           │                                    │
┌──────────────┐           │  3. Cross-INT corroboration        │
│ Public Stats │──cmdInfer │     (2+ sources → confidence ↑)   │
│ (IR, 政府統計)│──────────▶│                                    │
└──────────────┘           │  4. Stabilization                  │
                           │     (real data → cohort → stable)  │
                           └─────────────┬──────────────────────┘
                                         │ ComAtprotoRepoCreateRecord
                                         │ ("inferred_cohort")
                                         ▼
                           ┌──────────────────────────────────┐
                           │  yata graph                       │
                           │  :InferredCohort nodes            │
                           │  :InferenceChain nodes            │
                           │  :InferenceEvidence nodes         │
                           │  → etzhayyim coverage が query         │
                           └──────────────────────────────────┘
```

## Status Transition Lifecycle

```
              ┌─────────┐
              │ inferred │  ← single source, confidence ≥ 0.5
              └────┬─────┘
                   │ 2+ sources agree (within 10%)
                   ▼
           ┌──────────────┐
           │ corroborated │  ← multi-source, confidence ≥ 0.7
           └──────┬───────┘
                  │ real data arrives from domain app
                  ▼
             ┌─────────┐
             │  stable  │  ← actual count verified, SUPERSEDED_BY edge
             └────┬─────┘
                  │ deviation > 20% from new data
                  ▼
            ┌──────────┐
            │ revision  │  ← re-inference triggered
            └───────────┘
```

## Confidence Calculation

```typescript
// Layer-based base confidence
const BASE_CONFIDENCE: Record<number, number> = {
  1: 0.95,  // direct derivation
  2: 0.80,  // statistical model
  3: 0.60,  // ripple effect
  4: 0.40,  // LLM analogy
  5: 0.20,  // hypothesis
};

// Corroboration boost
function corroborate(confidences: number[]): number {
  // P(all wrong) = Π(1 - c_i), P(at least one right) = 1 - P(all wrong)
  return 1 - confidences.reduce((acc, c) => acc * (1 - c), 1);
}

// Time decay (90-day half-life)
function decayConfidence(confidence: number, daysSinceUpdate: number): number {
  return confidence * Math.pow(0.5, daysSinceUpdate / 90);
}

// Effective coverage weight
function effectiveWeight(status: string, confidence: number): number {
  switch (status) {
    case "stable": return 1.0;
    case "corroborated": return 0.7 * confidence;
    case "inferred": return 0.3 * confidence;
    default: return 0;
  }
}
```

## Natural-Person Cohort Pattern との対比

| 軸 | natural-person | intel inference |
|---|---|---|
| **単位** | 1 cohort = 26次元の人口統計プロファイル | 1 cohort = 推論チェーンの 1 ステップ出力 |
| **DID hash** | DJB2(26 dimensions) | DJB2(subject + domain + entity_type + layer) |
| **Phase 1** | 国連 WPP/WHO 等の統計 → cohort 生成 | IR/業界統計 → 推論チェーン → cohort 生成 |
| **Phase 2** | 実個人が register → cohort_did にリンク | 実データ ingest → cohort を SUPERSEDED_BY |
| **Dedup** | 同一 26次元 → 同一 hash → MERGE | 同一 subject+domain+type+layer → MERGE |
| **Confidence** | privacy classification (public/internal/confidential) | numeric confidence 0.0-1.0 + status lifecycle |
| **Coverage 寄与** | natural_person domain の DID count | 複数 domain への estimated_count |
| **Decay** | なし (統計は更新) | 90日 half-life (古い推論は信頼度低下) |

## Implementation Priority

| Priority | 実装 | 効果 |
|---|---|---|
| **P1** | `cmdInferCoverage` + Murakumo LLM 推論チェーン生成 | 手動トリガーで任意 entity の coverage 推論 |
| **P2** | Follow source reactive inference (L1-L2) | handotai/kuruma commit → 自動推論 |
| **P3** | Inference template library (automotive, semiconductor, finance) | 業界比率による高精度推論 |
| **P4** | Cross-INT corroboration | 複数ソース交差検証で confidence 向上 |
| **P5** | `etzhayyim coverage` integration (world_coverage.go 拡張) | 推論 coverage の可視化 |
| **P6** | Stabilization pipeline (実データ到着 → cohort 安定化) | 推論 → 実データの自動遷移 |
| **P7** | Confidence decay + heartbeat refresh | 古い推論の自動劣化 + 更新 |

## Example: Full Toyota Inference

```
cmdInferCoverage({
  subject_did: "did:web:intel.etzhayyim.com:org:toyota",
  source_text: "Toyota Motor Corporation FY2025 IR: Global sales 10.5M vehicles, production 10.2M, 541 consolidated subsidiaries, 176 affiliated companies, revenue ¥45.1T",
  source_url: "https://global.toyota/en/ir/"
})

→ Murakumo LLM generates inference chain:

Chain ic-20260329-001:
  L1: 10.5M sales → 10.5M sales contracts (koyo_keiyaku, c=0.98)
  L1: 541+176=717 group companies → 717 legal entities (legal_entity, c=0.99)
  L1: 10.2M production → 10.2M VINs (gtin, c=0.97)
  L2: 10.5M sales ÷ 62 = 169,355 dealers (supply_chain, c=0.82)
  L2: 10.5M × 0.90 = 9.45M insurance policies (insurance, c=0.85)
  L2: 10.5M × 0.50 = 5.25M auto loans (bank, c=0.80)
  L2: 10.2M × 340 = ~30,000 Tier1 suppliers (supply_chain, c=0.75)
  L3: 169,355 × 5 = 846,775 dealer employees (natural_person, c=0.60)
  L3: 30,000 × 5 = 150,000 Tier2 suppliers (supply_chain, c=0.55)
  L3: 10.2M × 0.143 ton = 1.46M ton steel (resource_flow, c=0.65)

→ 11 InferredCohort records created
→ Total coverage contribution across 7 domains
→ AppBskyFeedPost: "Toyota FY2025 inference chain: 11 cohorts across 7 domains (avg confidence 0.81)"
```
