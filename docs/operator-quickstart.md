# operator quickstart — cloud-itonami/intel

**この repo で今日実際に走らせられるものと、走らせられないものを、測った上で並べる。**
README.md と CLAUDE.md は intel という *系* を説明していて、この repo はその 1 スライスである。
両者は同じものではない —— 下の §0 がその差を測った結果で、§1 以降が実際に踏める手順。

すべての手順は 2026-09-03 に、この checkout (`3515534e`) に対して実際に実行した。
所要時間を書いてある箇所は load average を併記してある（このマシンは並行 agent が走るので、
数値そのものではなく桁を読むこと）。

---

## 0. この repo に在るもの / 在らないもの

tracked file は 32 本。README.md / CLAUDE.md が名指しするパスのうち、**この repo に無いもの**:

| README / CLAUDE.md が名指しするもの | この repo での tracked 数 |
|---|---|
| `/Users/junkawasaki/etzhayyim/etzhayyim-root/…`（絶対パス 3 箇所） | — （repo 外） |
| `00-contracts/lexicons/` | 0 |
| `30-graph/graph-schema/migrations/` | 0 |
| `50-infra/k8s/intel-dependency-worker/` | 0 |
| `20-actors/intel/actor-manifest.jsonld` | 0 |
| `tools/analyze_and_export.go` | 0 |

**実際に在るのは 3 面。**

| 面 | 場所 | 何であるか | 検査 |
|---|---|---|---|
| **contract** | `src/etzhayyim/intel/contract.cljk` + `test/` + `run_tests.cljk` | 面と面の *あいだ* の不変条件。純関数（ファイルも network も読まない） | §1 |
| **kotoba** | `kotoba/` | E2E reference registry（TypeScript、export 6 関数） | §3 |
| **appview** | `appview/etzhayyim-wasm-intel-i7n73l0x/` | Worker entry `src/app.ts`（44 KB、command 18 本）+ cljs frontend shell | §4 |

⚠ **`app.ts` には自動検査が 1 つも無い。** contract 面が見ているのは manifest の identity で
あって、`app.ts` の振る舞いではない。§4 の cljs test が検査するのは frontend shell だけ。

---

## 1. 依存ゼロで踏める検査（1 秒）

```bash
cd orgs/cloud-itonami/intel
nbb --classpath src:test run_tests.cljk
```

期待する出力の末尾:

```
Ran 17 tests containing 24 assertions.
0 failures, 0 errors.

intel contract: all green
```

**緑の判定は最終行の marker で行う。** 落ちたときは exit 1 と `intel contract: FAILED` で、
marker は印字されない（`run_tests.cljk` の `:end-run-tests` 参照）。

固定しているのは 4 面で、どれも過去の実退行の形からできている:

| 規則 | 何を防ぐか |
|---|---|
| `check-e2e-boundary` | `registry.ts` の CUI セクションで `encryptedWrite` → `write` の 1 語書き換えが起きること |
| `check-did-shell` | identity 一式（`.well-known/did.json` / `actor-manifest.jsonld`）が再びこの repo に複製されること |
| `check-appview-identity` | nanoid `i7n73l0x` の 3 箇所（dir 名 / `etzhayyim.json` / `kotodama.jsonld`）が割れること |
| `check-migration-identity` | `README.edn` の `:name` と `migration.edn` の destination が食い違うこと |

実測: 2026-09-03、load 19.30 で 1 秒未満。

---

## 2. その検査自身が効いているかを見る（mutation gate）

検査が緑であることと、検査が何かを検出できることは別の主張である。後者は superproject 側の
mutation gate が答える —— 対象を 1 箇所ずつ壊して、**壊すたびに赤くなること**を確かめる。

```bash
cd ~/github/com-junkawasaki        # superproject root。worktree ではない（下記）
nbb scripts/maturity-loop/run.cljs --only cloud-itonami/intel
```

期待:

```
maturity-loop: 1 suite / policy maturity-loop/mutation/v1
   base 3515534e: 緑
   噛む :intel/cohort-write-goes-plaintext
   … （6 件）
maturity-loop: 噛む=6 噛まない=0 エラー=0 skip=0
```

**⚠ 2 つの罠がある。どちらも実測で踏んだ。**

1. **`--only` は `:repo` の部分文字列一致**（`run.cljs` の `str/includes?`）。`--only intel` と
   書くと `orgs/cloud-itonami/graph-sos-intel` も拾って **2 suite / 16 mutation** になる。
   この repo だけを見たいなら `--only cloud-itonami/intel` と書く。
2. **superproject の worktree からは回らない。** `run.cljs` は `<root>/orgs/<org>/<repo>` を
   読むが、worktree には west 管理の子リポが 1 本も無いので、全 suite が同じ形で ENOENT に
   なる。実 root から回すこと。

実測: 2026-09-03、load 19.30 で 6 秒（`--only cloud-itonami/intel`）。

---

## 3. kotoba 面（TypeScript）

### ⚠ 素の `npm install` はこのマシンでは通らない

```bash
cd kotoba
npm install
# npm error code 1
# npm error git dep preparation failed
# npm error   npm error code EALLOWSCRIPTS
# npm error   --allow-scripts is not allowed in project-scoped installs.
```

**これは intel の問題ではない。** `~/.npmrc` に

```
allow-scripts[]=@anthropic-ai/claude-code
```

が在り、npm 11.19.0 は git 依存を用意するとき **入れ子の project-scoped install** を走らせる。
その入れ子が user config 由来の `allow-scripts` を受け取って拒否する。したがって
**git 依存を持つ package すべてで起きる** —— `@etzhayyim/sdk` と `@etzhayyim/sdk-mock` の
それぞれ単独でも再現した。

効かない回避（測定済み。試して時間を溶かさないこと）:

| 試したこと | 結果 |
|---|---|
| `npm install --ignore-scripts` | 同じ `EALLOWSCRIPTS` |
| `package.json` に `"allowScripts": {…}` | 同じ。入れ子の install には届かない |
| `pnpm install`（10.26.2） | `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` |
| `pnpm` + `onlyBuiltDependencies` 許可 | pnpm の allowlist は通るが、pnpm は準備を `npm install` に委譲するので同じところで止まる |

### 効く回避（測定済み）

user config をこの 1 コマンドだけ外す:

```bash
: > /tmp/empty.npmrc
npm install --userconfig /tmp/empty.npmrc
npm test          # Test Files 1 passed (1) / Tests 5 passed (5)
npm run typecheck # tsc --noEmit —— 出力なしが成功
```

- cold install は git 依存を数本 clone するので **分単位**（2026-09-03、load 19 で約 9 分）。
  ハングではない。warm は 1 秒未満。
- `npm test` は 5 test / 314 ms。`MockEtzhayyim` を使うので network に出ない。
- **`kotoba/` には `.gitignore` が無い**ので、install 後 `node_modules/` と
  `package-lock.json` が untracked で残る。commit しないこと。
  （`appview/*/cljs/` の方には `.gitignore` が在る。）

---

## 4. appview の frontend（cljs）

```bash
cd appview/etzhayyim-wasm-intel-i7n73l0x/cljs
npm install                     # 素の npm install で通る（registry 依存だけ。git 依存が無い）
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- npm test
```

期待:

```
Ran 4 tests containing 6 assertions.
0 failures, 0 errors.
```

- `re-frame: Subscribe was called outside of a reactive context.` が 4 行出るが**失敗ではない**
  （`rf/dispatch-sync` + `@(rf/subscribe …)` を reactive context の外で呼んでいるため）。
- **`resource-guard.mjs` を通すこと。** shadow-cljs は JVM build で、workspace 規約が高負荷
  build を同時 1 本に制限している。ロックが埋まっていると
  `REFUSED build-lock held by pid=… ` と言って **exit 2** で何も走らない —— 実測でこれを
  1 回踏んだ。**exit 2 は緑ではない。** 空くまで待って回し直す。
- 実測: cold compile 112 files / 259 秒（load 19）。warm はもっと速い。
- 出荷用の bundle は `npm run build`（`public/js/` に出る）。

---

## 5. 触る前に知っておくこと

- **identity はこの repo のものではない。** `.well-known/did.json` / `actor-manifest.jsonld` の
  所有者は `cloud-itonami/intel-actor`。2026-08-03 に複製が入り、撤去に 3 commit かかった
  （1 つ目の revert は失敗したまま「撤去した」と題されていた）。`check-did-shell` が見張る。
- **CUI の E2E 封緘。** `kotoba/src/registry.ts` の `Inferred cohort (E2E-ENCRYPTED, CUI)` 〜
  `Coverage rollup` のあいだでは、書き込みは `e.encryptedWrite`、読み出しは `e.encryptedRead`
  でなければならない。`e.write(` に変えると CUI が平文で substrate に渡る。
  registry.ts 冒頭が「substrate は subject PII を plaintext で見ない」と名乗っているので、
  この 1 語が嘘になると宣言ごと嘘になる。
- **nanoid `i7n73l0x` は 3 箇所**（appview の dir 名 / `etzhayyim.json` / `kotodama.jsonld`）に
  書かれている。改名を 1 箇所で止めると配備面が別 component を指す。

## 6. 測った上での「まだ無い / まだ合っていない」

**不在を書いておくのは、次に読む者が「無い」を「見ていない」と取り違えないため。**

- **`app.ts` に自動検査が無い**（上記 §0）。
- **CLAUDE.md の XRPC 表と `app.ts` の登録が一致しない。** CLAUDE.md は 22 メソッド
  （16 + Inference 6）を `/xrpc/etzhayyim.intel.v1.IntelService/<PascalCase>` として挙げるが、
  `app.ts` が `.command(nsid(…))` で登録しているのは 18 本で、形は
  `com.etzhayyim.apps.intel.<camelCase>`。突き合わせると:

  | | 件数 |
  |---|---|
  | CLAUDE.md にあって app.ts に無い | 11（`Chat` `GetCapabilities` `GetPublicExport` `ListTools` `PlanCollection` `QueryEntityGraph` `ScheduledScan` `SyncFromCrawler` `TraverseGraph` `GetAnalysisStatus` `GetCollectionPlan`） |
  | app.ts にあって CLAUDE.md に無い | 7（`audit` `describe` `exportData` `ingest` `searchEntities` `stats` `summarize`） |
  | 両方に在る | 11 |

  文字列 `IntelService` は **`app.ts` に 1 度も現れない** —— 残っているのは
  `kotodama.jsonld` の HTTP route glob `/api/grpc/etzhayyim.intel.v1.IntelService/...` だけ。
  **どちらの面が正本かはオーナー判断**なので、ここでは測って記録するに留める。
  再測定:

  ```bash
  grep -oE '\.command\(nsid\("[^"]+"' appview/*/src/app.ts | sed 's/.*nsid("//' | sort
  ```

- **CLAUDE.md の Known Limitations は 2 件とも未解消。** `kotodama.jsonld` の
  `interfaces.package` は `etzhayyim:intel@0.1.0` のまま（`grep interfaces -A2` で確認できる）。
- **CLAUDE.md 冒頭は自分を DEPRECATED と宣言している**（actor は
  `20-actors/intel/actor-manifest.jsonld` へ移行、`app.ts` は T3 fallback）が、その移行先は
  この repo に無い（§0）。移行が済んでいるかどうかはここからは判定できない。
