(ns intel.app-test
  (:require [cljs.test :refer [deftest is testing]]
            [re-frame.core :as rf]
            [intel.app :as app]))

(deftest default-db-matches-original-scaffold-text
  (testing "app-db data holds the exact heading/description text App.svelte
            used to render as markup literals, before the migration"
    (is (= "etzhayyim-wasm-intel-i7n73l0x" (:page/heading app/default-db)))
    (is (= "Vite entry scaffold after SvelteKit cleanup."
           (:page/description app/default-db)))))

(deftest initialize-db-event-sets-heading-sub
  (testing "dispatching the :initialize-db reg-event-db handler makes the
            :page/heading reg-sub resolve to default-db's value"
    (rf/dispatch-sync [:initialize-db])
    (is (= (:page/heading app/default-db) @(rf/subscribe [:page/heading])))))

(deftest initialize-db-event-sets-description-sub
  (testing "same, for :page/description"
    (rf/dispatch-sync [:initialize-db])
    (is (= (:page/description app/default-db) @(rf/subscribe [:page/description])))))

(deftest initialize-db-is-idempotent
  (testing "dispatching :initialize-db twice leaves subs unchanged"
    (rf/dispatch-sync [:initialize-db])
    (rf/dispatch-sync [:initialize-db])
    (is (= (:page/heading app/default-db) @(rf/subscribe [:page/heading])))
    (is (= (:page/description app/default-db) @(rf/subscribe [:page/description])))))
