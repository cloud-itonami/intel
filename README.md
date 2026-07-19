# etzhayyim-project-intel

`etzhayyim-project-intel` は、複数の INT discipline を単独の分類表としてではなく、
共通 ingestion・evidence graph・fusion pipeline に載せて扱うための App
プロジェクトです。

## Scope

- Core 5: `OSINT`, `HUMINT`, `SIGINT`, `GEOINT`, `MASINT`
- Derived families: `COMINT`, `ELINT`, `FISINT`, `PROFORMA`, `IMINT`,
  `PHOTINT`, `SARINT`, `LIDARINT`, `FMV`, `CYBINT`, `SOCMINT`, `WEBINT`,
  `DIGINT`, `DATAMININT`, `FININT`, `ECONINT`, `TRADEINT`, `RESINT`,
  `TECHINT`, `WEAPINT`, `MEDINT`, `SCIINT`, `CULTINT`, `POLINT`, `DEMINT`,
  `RELINT`, `POL`, `MOBINT`, `LOCINT`, `TRACKINT`

## Design Principle

- 1 acronym = 1 service にはしない
- `source_family`, `collection_method`, `analytic_lens` の 3 軸で扱う
- command は Matrix、query は XRPC
- structured data は Cypher graph + Arrow schema
- lawful / consented data collection だけを正規フローにする

## Initial App Shape

- `intel-gateway`: Matrix command ingress, access control, workflow kickoff
- `intel-collector`: source connector orchestration and evidence normalization
- `intel-fusion`: multi-INT correlation, scoring, and projection update
- `intel-query`: typed read API for cases, observations, alerts, and graphs
- `intel-ui`: Matrix widget / miniapp static frontend

## Implemented MVP

- App component: [etzhayyim-wasm-intel-i7n73l0x](/Users/junkawasaki/etzhayyim/etzhayyim-root/60-apps/etzhayyim-project-intel/wasm/etzhayyim-wasm-intel-i7n73l0x)
- Murakumo integration: `https://murakumo.etzhayyim.com/api/openai/v1/chat/completions` with default model `qwen3-vl-8b`
- Private storage: intel analyses are readable only when `_org_id == "default"`
- Public export: safe summaries are emitted as JSON-LD candidates targeting `60-apps/etzhayyim-project-resources/content/intel/public/`
- Local pipeline tool: [analyze_and_export.go](/Users/junkawasaki/etzhayyim/etzhayyim-root/60-apps/etzhayyim-project-intel/tools/analyze_and_export.go)

詳細設計は project 内の 2026-03-12 設計書を参照。
