(ns etzhayyim.intel.repo-test
  "**この repo に実際に commit されているファイル**を検査する。

  contract-test が『規則が落ちること』を fixture で見せるのに対し、こちらは
  『実物がその規則を通ること』を見る。E2E 境界（registry.ts 冒頭の宣言）・
  DID シェル不在（2026-08-03 の複製撤去）・appview identity 3 点一致・
  migration 契約を固定する。"
  (:require [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [cljs.reader :as reader]
            [etzhayyim.intel.contract :as c]
            ["node:fs" :as fs]
            ["node:path" :as path]))

(def repo-root (.cwd js/process))

(defn- slurp* [rel] (.readFileSync fs (path/join repo-root rel) "utf8"))

(defn- walk
  "repo-relative なファイルパスの列。.git と node_modules は見ない。"
  ([] (walk ""))
  ([rel]
   (mapcat (fn [e]
             (let [n (.-name e)
                   r (if (str/blank? rel) n (str rel "/" n))]
               (cond
                 (contains? #{".git" "node_modules"} n) []
                 (.isDirectory e) (walk r)
                 :else [r])))
           (fs/readdirSync (path/join repo-root rel) #js {:withFileTypes true}))))

(def registry-src (slurp* "kotoba/src/registry.ts"))

(def appview-dir
  (first (filter #(str/starts-with? % "etzhayyim-wasm-")
                 (js->clj (fs/readdirSync (path/join repo-root "appview"))))))

(def ez (js->clj (js/JSON.parse (slurp* (str "appview/" appview-dir "/etzhayyim.json")))))
(def kotodama (js->clj (js/JSON.parse (slurp* (str "appview/" appview-dir "/kotodama.jsonld")))))
(def readme (reader/read-string (slurp* "README.edn")))
(def migration (reader/read-string (slurp* "migration.edn")))

;; ── 全規則 ──────────────────────────────────────────────────────────────────

(deftest the-committed-repo-has-no-violations
  (let [violations (c/check {:registry-src registry-src
                             :paths (walk)
                             :appview-dir appview-dir
                             :ez ez :kotodama kotodama
                             :readme readme :migration migration})]
    (is (= [] violations)
        (str "違反 " (count violations) " 件:\n"
             (str/join "\n" (map #(str "  " (:rule %) " — " (:detail %)) violations))))))

;; ── 個別（落ちたとき、どの面が割れたかを名指しするための細分）──────────────

(deftest the-cui-cohort-path-stays-e2e-encrypted
  (testing "CUI セクションが実在する（無いなら『適合』ではなく検査不能）"
    (is (some? (c/cui-section registry-src))))
  (testing "cohort の書き込み/読み出しは封緘、plaintext 呼び出しゼロ"
    (is (= [] (c/check-e2e-boundary registry-src)))))

(deftest no-did-shell-file-resurrects
  (let [violations (c/check-did-shell (walk))]
    (is (= [] violations)
        (str "identity は intel-actor が所有する。再出現: "
             (str/join ", " (map :detail violations))))))

(deftest appview-manifests-agree-on-identity
  (is (some? appview-dir) "appview/ に etzhayyim-wasm-* が無い")
  (is (= [] (c/check-appview-identity appview-dir ez kotodama))))

(deftest readme-and-migration-name-the-same-repository
  (is (= [] (c/check-migration-identity readme migration))))
