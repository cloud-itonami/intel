# etzhayyim-wasm-intel-i7n73l0x

Murakumo-backed INT analysis App.

## Behavior

- `SubmitAnalysis`: calls `https://murakumo.etzhayyim.com/api/openai/v1/chat/completions` with `qwen3-vl-8b`
- stores the full analysis privately for `org_id=default`
- returns a public-safe JSON-LD candidate for `resources` when `publish_public=true`
- uses `public|unclassified|cui|confidential|secret|top_secret` as the information classification vocabulary
- requires `clearance`, `capability_ids`, and `need_to_know` on intel capabilities

## Endpoints

- `POST /xrpc/etzhayyim.intel.v1.IntelService/SubmitAnalysis`
- `POST /xrpc/etzhayyim.intel.v1.IntelService/GetAnalysis`
- `POST /xrpc/etzhayyim.intel.v1.IntelService/ListAnalyses`
- `POST /xrpc/etzhayyim.intel.v1.IntelService/GetPublicExport`
- `POST /xrpc/etzhayyim.intel.v1.IntelService/GetCapabilities`
- `GET /health`
- `GET /api/info`

## Example

```bash
curl -sS http://127.0.0.1:3000/xrpc/etzhayyim.intel.v1.IntelService/SubmitAnalysis \
  -H 'content-type: application/json' \
  -d '{
    "title":"Open source reporting on logistics hub activity",
    "source_url":"https://example.com/report",
    "source_text":"Public reporting says ...",
    "source_family":"public",
    "analytic_lens":"OSINT",
    "source_visibility":"public",
    "_clearance":"cui",
    "_capability_ids":"intel.submit-analysis",
    "_need_to_know":"mission-logistics",
    "publish_public":true
  }'
```
