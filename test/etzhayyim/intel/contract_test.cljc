(ns etzhayyim.intel.contract-test
  "規則が**実際に落ちる**ことを fixture で見せる。

  repo-test が『実物が規則を通ること』を見るのに対し、こちらは『規則が壊れた
  入力で本当に violation を返すこと』を見る。この向きのテストが無いと、規則の
  実装を骨抜きにしても（:when に false を挟むなど）実物は緑のままなので、
  誰も気づかない —— scripts/maturity-loop の mutation はまさにそこを撃つ。"
  (:require [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [etzhayyim.intel.contract :as c]))

;; ── fixture ─────────────────────────────────────────────────────────────────
;; 実物と同型の最小データ。fixture 自身が check を通ることを最初に固定する
;; —— 通らない fixture の上の「落ちるテスト」は何も証明しない。

(def registry-src
  (str "// ─── Coverage projection (PLAINTEXT) ───\n"
       "  const receipt = await e.write({ collection: COVERAGE_COLLECTION });\n"
       "  const resp = await e.read<CoverageProjectionRecord>({ cursor });\n"
       "// ─── Inferred cohort (E2E-ENCRYPTED, CUI) ───\n"
       "  const receipt = await e.encryptedWrite<Record<string, unknown>>({ rkey });\n"
       "  const page = await e.encryptedRead<InferredCohortBody>({ cursor });\n"
       "// ─── Coverage rollup ───\n"
       "  const page = await e.read<CoverageProjectionRecord>({ cursor });\n"))

(def paths
  ["README.md" "README.edn" "migration.edn" "PROJECT.jsonld"
   "kotoba/src/registry.ts"
   "appview/etzhayyim-wasm-intel-i7n73l0x/etzhayyim.json"
   "appview/etzhayyim-wasm-intel-i7n73l0x/kotodama.jsonld"])

(def appview-dir "etzhayyim-wasm-intel-i7n73l0x")
(def ez {"name" "intel" "nanoid" "i7n73l0x" "project" "intel"})
(def kotodama {"@id" "did:web:intel.etzhayyim.com" "name" "intel" "nanoid" "i7n73l0x"})

(def readme {:schema "etzhayyim.repository/v1" :name "com-etzhayyim-app-intel" :kind :app})
(def migration
  {:schema "etzhayyim.migration/v1"
   :destination {:repository "etzhayyim/com-etzhayyim-app-intel"}
   :identity {:allowed-additions ["README.edn" "migration.edn"]}})

(def fixture
  {:registry-src registry-src :paths paths :appview-dir appview-dir
   :ez ez :kotodama kotodama :readme readme :migration migration})

(defn- rules-of [violations] (set (map :rule violations)))

(deftest the-fixture-itself-is-conformant
  (is (= [] (c/check fixture))))

;; ── E2E 境界 ────────────────────────────────────────────────────────────────

(deftest a-plaintext-write-in-the-cui-section-is-a-violation
  (let [broken (str/replace registry-src
                            "e.encryptedWrite<Record<string, unknown>>({ rkey })"
                            "e.write({ rkey })")]
    (is (contains? (rules-of (c/check-e2e-boundary broken))
                   :e2e/cohort-write-not-encrypted))
    (is (contains? (rules-of (c/check-e2e-boundary broken))
                   :e2e/plaintext-call-in-cui-section))))

(deftest a-plaintext-read-in-the-cui-section-is-a-violation
  (let [broken (str/replace registry-src
                            "e.encryptedRead<InferredCohortBody>({ cursor })"
                            "e.read<InferredCohortBody>({ cursor })")]
    (is (contains? (rules-of (c/check-e2e-boundary broken))
                   :e2e/cohort-read-not-encrypted))
    (is (contains? (rules-of (c/check-e2e-boundary broken))
                   :e2e/plaintext-call-in-cui-section))))

(deftest a-missing-cui-section-is-a-violation-not-a-pass
  (testing "セクションが見つからないことは『検査できなかった』であって『適合』ではない"
    (is (= #{:e2e/cui-section-missing}
           (rules-of (c/check-e2e-boundary "// nothing here\n"))))))

(deftest the-plaintext-coverage-section-is-allowed-to-stay-plaintext
  (testing "coverage projection の e.write / e.read は CUI セクション外なので違反ではない"
    (is (= [] (c/check-e2e-boundary registry-src)))))

;; ── DID シェル ──────────────────────────────────────────────────────────────

(deftest a-did-shell-file-is-a-violation
  (doseq [shell [".well-known/did.json" "did.json" "actor-manifest.jsonld"
                 "somewhere/actor-manifest.jsonld"]]
    (is (contains? (rules-of (c/check-did-shell (conj paths shell)))
                   :identity/did-shell-file)
        (str shell " が violation にならなかった"))))

(deftest ordinary-files-are-not-did-shell
  (is (= [] (c/check-did-shell paths))))

;; ── appview identity ────────────────────────────────────────────────────────

(deftest a-nanoid-drift-between-manifests-is-a-violation
  (is (contains? (rules-of (c/check-appview-identity
                            appview-dir ez (assoc kotodama "nanoid" "i7n73l0y")))
                 :appview/nanoid-mismatch)))

(deftest a-dir-rename-that-forgets-the-nanoid-is-a-violation
  (is (contains? (rules-of (c/check-appview-identity
                            "etzhayyim-wasm-intel" ez kotodama))
                 :appview/dir-nanoid-mismatch)))

(deftest naming-another-actors-host-is-a-violation
  (is (contains? (rules-of (c/check-appview-identity
                            appview-dir ez
                            (assoc kotodama "@id" "did:web:intel-actor.etzhayyim.com")))
                 :appview/did-host-mismatch)))

;; ── migration 契約 ──────────────────────────────────────────────────────────

(deftest a-readme-name-drift-is-a-violation
  (is (contains? (rules-of (c/check-migration-identity
                            (assoc readme :name "com-etzhayyim-app-intel-2") migration))
                 :migration/name-mismatch)))

(deftest a-migration-that-forgets-its-own-additions-is-a-violation
  (is (contains? (rules-of (c/check-migration-identity
                            readme (assoc-in migration [:identity :allowed-additions]
                                             ["README.edn"])))
                 :migration/allowed-additions)))
