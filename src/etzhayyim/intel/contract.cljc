(ns etzhayyim.intel.contract
  "intel repo の適合規則。**純粋** —— ファイルも network も読まない。

   入力は parse 済みのデータ / ソーステキスト / ファイル一覧:

     registry-src   kotoba/src/registry.ts のソーステキスト
     paths          repo-relative なファイルパスの列（.git 除外）
     appview-dir    appview/ 配下の component ディレクトリ名
     ez             etzhayyim.json 由来。キーは**文字列のまま**扱う
     kotodama       kotodama.jsonld 由来。キーは文字列のまま
                    （keywordize すると \"@id\" / \"@context\" が壊れるので
                    境界で変換しない —— airshed / cargo と同じ規約）
     readme         README.edn 由来。EDN なのでキーワードキー
     migration      migration.edn 由来。EDN なのでキーワードキー

   出力は違反の vector。空なら適合。

   ## この repo の契約は 3 つの実退行の形からできている

   1. **E2E 境界** —— kotoba/src/registry.ts は自分の冒頭コメントで
      『coverageProjection は plaintext、inferredCohort (CUI) は E2E 封緘。
      substrate は subject PII を plaintext で見ない』と宣言し、founder の
      E2E-migration set の canonical template を名乗っている。だが 2026-08-22
      までこの宣言を検査するものは無かった —— `encryptedWrite` を `write` に
      変える 1 語の編集で、CUI が plaintext で流れ始めても何も落ちない。

   2. **DID シェル再出現** —— 2026-08-03、bare name での twin 突合せが
      identity 一式（.well-known/did.json / actor-manifest.jsonld / deps.edn …）
      をこの repo へ複製した。正しい所有者は cloud-itonami/intel-actor で、
      撤去に 3 commit を要した（1 つ目の revert は失敗したまま『撤去した』と
      題されていた）。同じ複製が再来しても、検査が無ければ誰も報告しない。

   3. **appview identity 割れ** —— nanoid `i7n73l0x` は appview のディレクトリ名・
      etzhayyim.json・kotodama.jsonld の 3 箇所に書かれており、どれか 1 つだけ
      変わる（改名半端）と配備面が別 component を指す。CLAUDE.md の Known
      Limitations が記録する interfaces.package の drift と同じ入口。

   ここでは規則を純粋関数として書き、fixture で「規則が実際に落ちる」ことを
   見せてから実ファイルに当てる。"
  (:require [clojure.string :as str]))

(defn- v [rule detail] {:rule rule :detail detail})

;; ── E2E 境界（kotoba/src/registry.ts）───────────────────────────────────────

(def cui-section-start "Inferred cohort (E2E-ENCRYPTED, CUI)")
(def cui-section-end "Coverage rollup")

(defn cui-section
  "registry.ts の CUI セクション（E2E 封緘が義務の範囲）。無ければ nil。"
  [registry-src]
  (let [a (str/index-of registry-src cui-section-start)
        b (when a (str/index-of registry-src cui-section-end a))]
    (when (and a b) (subs registry-src a b))))

(defn check-e2e-boundary
  "CUI セクションの書き込みは encryptedWrite、読み出しは encryptedRead で
   なければならない。plaintext の e.write( / e.read< がセクション内に現れたら、
   registry.ts 冒頭の『substrate は subject PII を plaintext で見ない』が
   嘘になっている。"
  [registry-src]
  (if-let [sec (cui-section registry-src)]
    (vec
     (concat
      (when-not (str/includes? sec "e.encryptedWrite")
        [(v :e2e/cohort-write-not-encrypted
            "CUI セクションに e.encryptedWrite が無い — cohort の書き込みが封緘されていない")])
      (when-not (str/includes? sec "e.encryptedRead")
        [(v :e2e/cohort-read-not-encrypted
            "CUI セクションに e.encryptedRead が無い — cohort の読み出しが封緘されていない")])
      (when (or (str/includes? sec "e.write(")
                (str/includes? sec "e.read(")
                (str/includes? sec "e.read<"))
        [(v :e2e/plaintext-call-in-cui-section
            "CUI セクションに plaintext の e.write / e.read 呼び出しがある — subject PII が substrate に平文で渡る")])))
    [(v :e2e/cui-section-missing
        (str "registry.ts に \"" cui-section-start "\" 〜 \"" cui-section-end
             "\" のセクションが無い — E2E 境界の検査対象を見失った"))]))

;; ── DID シェル不在 ──────────────────────────────────────────────────────────

(defn- did-shell-file?
  "identity シェルの構成ファイルか。2026-08-03 に複製されたのは
   .well-known/did.json と actor-manifest.jsonld —— どちらも intel-actor が
   所有すべきもので、この repo に在ること自体が違反。"
  [p]
  (or (= p "did.json")
      (str/ends-with? p "/did.json")
      (= p "actor-manifest.jsonld")
      (str/ends-with? p "/actor-manifest.jsonld")
      (str/includes? p ".well-known/")))

(defn check-did-shell
  "DID シェルの再出現。identity は cloud-itonami/intel-actor が所有する。"
  [paths]
  (vec (for [p paths
             :when (did-shell-file? p)]
         (v :identity/did-shell-file
            (str p " — identity は intel-actor が所有する（2026-08-03 の複製撤去を参照）")))))

;; ── appview identity 一致 ───────────────────────────────────────────────────

(defn check-appview-identity
  "appview のディレクトリ名・etzhayyim.json・kotodama.jsonld が同じ component を
   名指ししていること。nanoid / name / did:web ホストの 3 点。"
  [appview-dir ez kotodama]
  (let [nanoid (get ez "nanoid")
        name*  (get ez "name")]
    (vec
     (concat
      (when (str/blank? (str nanoid))
        [(v :appview/nanoid-missing "etzhayyim.json に nanoid が無い")])
      (when (not= nanoid (get kotodama "nanoid"))
        [(v :appview/nanoid-mismatch
            (str "etzhayyim.json nanoid " (pr-str nanoid)
                 " ≠ kotodama.jsonld nanoid " (pr-str (get kotodama "nanoid"))))])
      (when (and nanoid (not (str/ends-with? (str appview-dir) (str nanoid))))
        [(v :appview/dir-nanoid-mismatch
            (str "appview dir " (pr-str appview-dir) " が nanoid " (pr-str nanoid)
                 " で終わっていない"))])
      (when (not= name* (get kotodama "name"))
        [(v :appview/name-mismatch
            (str "etzhayyim.json name " (pr-str name*)
                 " ≠ kotodama.jsonld name " (pr-str (get kotodama "name"))))])
      (let [expected (str "did:web:" name* ".etzhayyim.com")]
        (when (not= expected (get kotodama "@id"))
          [(v :appview/did-host-mismatch
              (str "kotodama @id " (pr-str (get kotodama "@id"))
                   " ≠ " (pr-str expected) " — 別 actor のホストを名乗っている"))]))))))

;; ── migration 契約（README.edn ↔ migration.edn）─────────────────────────────

(defn- repo-basename [s] (last (str/split (str s) #"/")))

(defn check-migration-identity
  "README.edn と migration.edn が同じ repository を名乗っていること。
   allowed-additions は移行イベントの記録（恒久の tree 凍結ではない）——
   宣言自身の自己整合だけを見る。"
  [readme migration]
  (vec
   (concat
    (when (not= "etzhayyim.repository/v1" (:schema readme))
      [(v :migration/readme-schema
          (str "README.edn :schema " (pr-str (:schema readme))))])
    (when (not= "etzhayyim.migration/v1" (:schema migration))
      [(v :migration/migration-schema
          (str "migration.edn :schema " (pr-str (:schema migration))))])
    (let [rn (:name readme)
          dn (repo-basename (get-in migration [:destination :repository]))]
      (when (not= rn dn)
        [(v :migration/name-mismatch
            (str "README.edn :name " (pr-str rn)
                 " ≠ migration destination basename " (pr-str dn)))]))
    (let [adds (set (get-in migration [:identity :allowed-additions]))]
      (when-not (and (contains? adds "README.edn") (contains? adds "migration.edn"))
        [(v :migration/allowed-additions
            (str ":identity :allowed-additions が自分自身を挙げていない: "
                 (pr-str (vec adds))))])))))

;; ── 全規則 ──────────────────────────────────────────────────────────────────

(defn check
  "全規則。空 vector なら適合。"
  [{:keys [registry-src paths appview-dir ez kotodama readme migration]}]
  (vec (concat (check-e2e-boundary registry-src)
               (check-did-shell paths)
               (check-appview-identity appview-dir ez kotodama)
               (check-migration-identity readme migration))))
