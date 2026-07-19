# 260312 Intel App Design

Date: 2026-03-12

## Goal

`etzhayyim-project-intel` は、約 30 系統の INT discipline を個別の縦割り
サービスに分解するのではなく、単一の App 境界の中で
`collection -> normalization -> fusion -> query -> briefing`
へ流す設計を採用する。

この設計の主眼は次の 3 点。

- INT 分類の揺れに耐えること
- multi-INT fusion を first-class にすること
- Matrix command / XRPC query の標準 transport に従うこと

## Taxonomy Policy

INT は固定標準ではないため、プロダクト内部では次の 3 軸で扱う。

| Internal axis | Meaning | Examples |
|---|---|---|
| `source_family` | データの収集源 | human, public-web, comms, geospatial, telemetry, finance |
| `collection_method` | 実際の取得方法 | crawl, upload, manual-report, api-pull, sensor-feed |
| `analytic_lens` | 分析時の見方 | SIGINT, SOCMINT, FININT, TECHINT, TRACKINT |

### Canonical families

| Family | Included INT |
|---|---|
| `public` | OSINT, WEBINT, SOCMINT, DATAMININT |
| `human` | HUMINT, CULTINT, POLINT, RELINT, DEMINT |
| `signals` | SIGINT, COMINT, ELINT, FISINT, PROFORMA |
| `geospatial` | GEOINT, IMINT, PHOTINT, SARINT, LIDARINT, FMV |
| `cyber` | CYBINT, DIGINT |
| `economic` | FININT, ECONINT, TRADEINT, RESINT |
| `scientific` | MASINT, TECHINT, WEAPINT, MEDINT, SCIINT |
| `behavioral` | POL, MOBINT, LOCINT, TRACKINT |

これにより、新しい INT 名称が増えても table や service を増やさずに
吸収できる。

## Operational Boundary

この App は違法な interception を扱わない。`SIGINT` と `HUMINT` は
次の lawful scope のみに限定する。

- first-party / consented communication metadata
- 自組織保有の telemetry / sensor feed
- analyst が登録する manual report
- 契約済み provider から受ける lawful dataset

非合法な盗聴、侵入、マルウェア配布、credential theft を前提とする機能は
設計に含めない。

## App Topology

単一 project の中に 1 つの managed App を置き、その中を 5 component に分ける。

| Component | Role | Public surface |
|---|---|---|
| `intel-gateway` | Matrix command ingress, authz, workflow dispatch | Matrix routes, `/health` |
| `intel-collector` | connector orchestration, evidence ingest, dedupe | internal only |
| `intel-fusion` | correlation, scoring, event probability, projection update | internal only |
| `intel-query` | XRPC query service | `/xrpc/etzhayyim.intel.v1.IntelQueryService/*` |
| `intel-ui` | Matrix widget static assets via static delivery | `/` |

### Why one app

- command と query の policy を一つの app boundary に閉じ込められる
- case / observation / alert projection を同一 schema で保てる
- `OSINT` から `FININT` までを同一 correlation graph で扱える
- deployment は `replicas: 1` の project standard に従える

## Command / Query Split

### Command

正規 command は Matrix event。

- `org.etzhayyim.command.intel.case.open`
- `org.etzhayyim.command.intel.collection.run`
- `org.etzhayyim.command.intel.observation.attach`
- `org.etzhayyim.command.intel.hypothesis.score`
- `org.etzhayyim.command.intel.alert.acknowledge`

command payload の標準 fields:

- `command_id`
- `case_id`
- `correlation_id`
- `requested_by`
- `access_context`
- `access_policy`
- `payload`

### Query

typed read は XRPC に限定する。

- `IntelQueryService/ListCases`
- `IntelQueryService/GetCase`
- `IntelQueryService/ListObservations`
- `IntelQueryService/ListAlerts`
- `IntelQueryService/GetFusionGraph`
- `IntelQueryService/ListSources`
- `IntelQueryService/GetCoverage`

list 系はすべて `offset`, `limit`, `total` を持つ。

## Data Model

永続化は Tonbo Flight SQL。全 table に `org_id`, `user_id`, `actor_id` を持たせる。

### Core tables

| Table | Purpose |
|---|---|
| `intel_cases_current` | case current projection |
| `intel_case_events` | case append event log |
| `intel_observations_current` | normalized evidence / observation |
| `intel_sources_current` | source registry and connector status |
| `intel_entities_current` | entity resolution result |
| `intel_links_current` | graph edges between entities / observations / cases |
| `intel_alerts_current` | analyst-facing alert projection |
| `intel_fusion_scores_current` | hypothesis / event probability / confidence |
| `intel_collection_runs_current` | scheduled or manual collection execution state |

### Observation row

`intel_observations_current` の代表列:

- `observation_id`
- `case_id`
- `source_family`
- `collection_method`
- `analytic_lens`
- `source_ref`
- `subject_entity_id`
- `geo_cell`
- `observed_at`
- `ingested_at`
- `reliability_score`
- `credibility_score`
- `confidence_score`
- `content_json`
- `labels_json`

### Fusion row

`intel_fusion_scores_current` の代表列:

- `hypothesis_id`
- `case_id`
- `event_type`
- `probability`
- `confidence`
- `support_count`
- `contradiction_count`
- `last_scored_at`
- `evidence_refs_json`

## Fusion Model

内部 scoring は次を基準にする。

`I = sum(w_k * D_k)`

- `D_k`: 各 observation から抽出した signal
- `w_k`: source reliability, recency, corroboration, access trust に基づく重み

実装は単純な線形和から開始し、将来的にベイズ更新と graph centrality を追加する。

### Phase 1 scoring factors

- source reliability
- recency decay
- cross-family corroboration
- contradiction penalty
- analyst override

### Phase 2 extension

- Bayesian posterior update
- graph neighborhood propagation
- temporal burst detection
- geo-spatial anomaly score

## Source Connector Design

connector は INT 名ごとではなく取得形態ごとに実装する。

| Connector type | Typical INT coverage |
|---|---|
| `web-crawler` | OSINT, WEBINT, SOCMINT |
| `api-ingest` | FININT, ECONINT, TRADEINT, CYBINT |
| `sensor-ingest` | GEOINT, MASINT, ELINT, SARINT |
| `manual-report` | HUMINT, POLINT, CULTINT, RELINT |
| `file-upload` | IMINT, DIGINT, TECHINT, MEDINT |
| `location-feed` | MOBINT, LOCINT, TRACKINT |

connector は raw payload を app 内部 blob layer に置き、query 面には normalized
observation のみ出す。

## UI / Analyst Workflow

miniapp UI は Matrix widget として埋め込む。

### Main views

- case board
- observation timeline
- fusion graph
- source coverage dashboard
- alert queue
- collection run console

### Typical workflow

1. analyst が Matrix room から case を開く
2. UI が `GetCase`, `ListObservations`, `GetFusionGraph` を query
3. analyst が collection run command を送る
4. `intel-collector` が sources を収集し normalized observation を upsert
5. `intel-fusion` が score を更新
6. result/notification を Matrix timeline に返す

## WIT / Proto Plan

### WIT

追加候補:

- `packages/wasm/wit/intel/intel.wit`
- `packages/wasm/world/etzhayyim-business.wit` に `etzhayyim-intel-provider`

WIT では少なくとも次を定義する。

- `submit-collection-run`
- `register-observation`
- `score-hypothesis`
- `list-observations`
- `get-fusion-graph`

### Proto

`proto/etzhayyim/intel/v1/intel.proto` を追加し、public query contract を定義する。
command service は public には作らない。

## Deployment Shape

標準 path:

- project: `60-apps/etzhayyim-project-intel`
- app dir: `60-apps/etzhayyim-project-intel/wasm/etzhayyim-wasm-intel-<nanoid>`
- namespace: `kotodama-runtime`
- image: `ghcr.io/etzhayyim/*`

最低限の routes:

- `/`
- `/health`
- `/_matrix/*`
- `/xrpc/etzhayyim.intel.v1.IntelQueryService/*`

## Milestones

1. design: taxonomy / data model / transport contract
2. scaffold: App folder, `kotodama.toml`, `deploy config`, health route
3. contract: WIT + proto + query service stub
4. storage: Flight SQL schema + projection updater
5. ingest: `web-crawler`, `manual-report`, `api-ingest` の 3 connector
6. fusion: linear scoring + graph query
7. ui: Matrix widget case board

## Open Questions

- `HUMINT` manual report の access policy を case-by-case secrecy level とどう結ぶか
- blob layer を project-local に置くか、既存 shared blob API に寄せるか
- `SIGINT` lawful dataset の provider をどこまで project 内に持つか
- `threat-intelligence` / `collector` project と observation schema をどこまで共有するか
