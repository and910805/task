# TaskGo 多租戶改造：盤點、隔離設計、遷移與分階段計畫

> 狀態（2026-09-29，本機未部署）：Phase 1 與 Phase 2 的 CRM、材料、報表隔離已實作，後端整合測試 113 項通過；LINE 與舊版通知設定仍限定舊工作區。Phase 3 推播尚待雲端簽署與實機驗收。
> 本文件不含任何密碼、連線字串或金鑰。

## 1. 改造前盤點（2026-09-24，非目前部署證明）

| 範圍 | 現況 | 多租戶影響 |
| --- | --- | --- |
| 後端 | Flask + SQLAlchemy，約 1.4 萬行；正式環境 PostgreSQL（Zeabur），開發 SQLite | 無任何公司概念；權限只看 `user.role` |
| 權限 | `role_required()` 從 DB 讀 `user.role`；tasks/materials 另外讀 JWT `role` claim | 需改為「工作區成員資格 + 工作區內角色」 |
| 資料 | task / task_update / attachment / task_assignee / site_location / CRM（customer、contact、quote、contract、invoice…）/ 材料 / audit_log / role_label / site_setting | 全部是全域資料，沒有歸屬欄位 |
| 唯一鍵 | `customer.name`、`quote.quote_no`、`invoice.invoice_no`、`contract.contract_no`、`service_catalog_item.name`、`material_item(name,spec)`、`site_location.name`、`role_label.role` 都是全域唯一 | 多公司會互撞；Phase 2 改成 (workspace_id, …) |
| 設定 | 品牌名稱/Logo、角色顯示名稱、回報範本、Email/LINE 通知規則都存在全域 `site_setting` / `role_label` | 需改為每個工作區一份 |
| 品牌 | 前端 12 處以上寫死「立翔水電行」；PWA manifest、offline 頁、SW cache 名稱亦同 | 平台品牌改 TaskGo，公司名稱由工作區設定 |
| 正式 DB | 另含非本系統的表（`users`、`groups`、`expenses`…） | 遷移腳本**只能動本系統的表**，不得碰其他表 |
| iOS | `kuanlin-mobile-apps/apps/taskgo`：Capacitor 8，打包 task 前端；**無任何原生外掛**、無推播、無 entitlements、無 PrivacyInfo；此 repo 另有他人正在修改 | 需補推播/相機外掛、深層連結、隱私清單；只動 `apps/taskgo` |
| 開發機 | Windows，無 Xcode | 本機只能做網頁預覽；iOS 模擬器/實機需 Mac 或 Codemagic |

## 2. 資料模型

新增表：

- `workspace`：`id, name, slug(唯一), industry, owner_user_id, plan, status, is_legacy, created_at, updated_at`
  - `plan`：`legacy | trial | free | pro`（只存方案代碼與上限，**不接付款**）
  - `is_legacy=true` 只給遷移而來的「立翔水電行」，用來標記尚未完成隔離的舊模組可用範圍
- `workspace_member`：`id, workspace_id, user_id, role, status, joined_at`，唯一 `(workspace_id, user_id)`
  - `role ∈ {admin, site_supervisor, hq_staff, worker}`；擁有者 = `workspace.owner_user_id`（一定同時是 admin）
  - 顯示名稱預設：擁有者/管理員/主管/辦公室人員/現場人員，每家公司可自訂（例：現場人員→水電工）
- `workspace_invitation`：`id, workspace_id, code(hash), role, email/備註, invited_by_id, expires_at, max_uses, used_count, revoked_at`
- `workspace_setting`：`(workspace_id, key)` 唯一，存品牌名稱、Logo 路徑、角色顯示名稱、回報範本、通知規則
- `device_token`：`user_id, platform, token, last_seen_at`（推播用，Phase 3）

既有表新增 `workspace_id`（可為 NULL 的外鍵 + 索引，**不改任何既有欄位**）：

- 核心：`task`、`site_location`、`audit_log`
- 其他模組（Phase 1 只補欄位與回填，Phase 2 才改查詢）：`customer`、`contact`、`website_booking`、`quote`、`contract`、`invoice`、`service_catalog_item`、`material_item`、`material_purchase_batch`、`material_stock_txn`
- 子表（`task_update`、`attachment`、`task_assignee`、`quote_item`…）透過父表判斷歸屬，不重複存欄位

`user.role` 保留不刪（回滾需要），但**不再用於授權**。帳號（`user`）是全域的，一個人可以加入多家公司。

## 3. API 隔離設計

1. **工作區解析**：每個需登入的 API 由 `workspace_required(*roles)` 解析：
   - `X-Workspace-Id` 標頭 → 否則使用者的預設工作區 → 否則唯一的成員資格
   - 必須是 `status=active` 的成員，否則 403；角色不符 403
   - 結果放在 `g.workspace / g.membership / g.role`，所有查詢一律加 `Task.workspace_id == g.workspace.id`
2. **跨工作區資源一律 404**（不是 403），避免洩漏「這個 ID 存在」。
3. **指派對象必須是同工作區成員**；工時、附件、下載、匯出都以任務的 `workspace_id` 驗證。
4. **附件下載**：短效下載 token 仍綁定檔案路徑，另外驗證下載者是該任務工作區的成員。
5. **舊模組（CRM、報價請款、材料、LINE 圖文選單、通知規則）**：Phase 1 在伺服器端限制「只有 `is_legacy` 工作區可用」，其他公司呼叫一律 403，前端同步隱藏；Phase 2 完成隔離後才開放。新建資料會由 SQLAlchemy `before_flush` 自動帶入目前工作區。
6. **路由稽核測試**：測試會列舉 Flask 全部 `/api/` 路由，每一條都必須標記為 `public`、`account`（帳號層級）或 `workspace`（工作區層級），漏標就測試失敗。

角色權限（工作區內）：

| 動作 | 擁有者 | 管理員 | 主管 | 辦公室人員 | 現場人員 |
| --- | --- | --- | --- | --- | --- |
| 看任務 | 全部 | 全部 | 自己建立/被指派 | 全部 | 被指派 |
| 建立/派工/改任務 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 接單、工時、拍照、完工回報 | ✅ | ✅ | ✅ | ✅ | 被指派的任務 |
| 邀請成員、改角色、品牌設定 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 移除管理員、轉移擁有者、刪除公司、方案 | ✅ | ❌ | ❌ | ❌ | ❌ |

## 4. 遷移方案（可回復）

工具：`backend/scripts/workspace_migration.py`（在 `backend/` 目錄執行，`DATABASE_URL` 只從環境變數讀取、不會印出）

| 指令 | 作用 | 會寫入嗎 |
| --- | --- | --- |
| `inventory` | 列出每張表筆數、既有角色分布、將被歸入的資料量 | 否 |
| `backup --out <dir>` | 將本系統相關表匯出為 JSONL.gz（PostgreSQL 另建議先用 `pg_dump`） | 只寫備份檔 |
| `upgrade --legacy-name 立翔水電行` | 單一交易：建立新表 → 補 `workspace_id` 欄位 → 建立「立翔水電行」工作區 → 回填所有既有資料 → 依 `user.role` 建立成員資格 → 複製品牌/角色名稱/範本/通知設定到工作區設定。可重複執行（冪等） | 是 |
| `verify` | 檢查必要工作區表、歸屬欄位、NULL 歸屬與工作區唯一鍵，拒絕殘留全域唯一鍵；回傳當下筆數及無成員資格帳號數。未自動比較遷移前筆數，也不會將未加入公司的新帳號當作錯誤 | 否 |
| `downgrade` | 移除新增欄位與新表，還原成單租戶。若已有其他公司的資料會拒絕執行（需 `--force-discard-other-workspaces` 明確確認） | 是 |

原則：不刪除、不覆寫任何既有欄位與資料；`site_setting`、`role_label` 保持原樣（只複製）。

**正式執行步驟（待你確認後才做，本次不執行）：**

1. 公告維護時段，停止所有應用寫入及排程（不只暫停 due reminders），遷移與驗證完成前維持維護狀態。
2. `pg_dump` 完整備份正式 DB，下載到安全位置並驗證可還原（在拋棄式 DB 上 restore 一次）。
3. `workspace_migration.py inventory` 保存輸出。
4. `workspace_migration.py backup --out <安全路徑>`。
5. `workspace_migration.py upgrade --legacy-name 立翔水電行`。此步驟也轉換唯一鍵，不可讓舊版無公司隔離的程式同時對外服務。
6. `workspace_migration.py verify`，比對第 3 步筆數。
7. 部署新版程式；用立翔管理員、工人帳號各登入一次確認。
8. 回滾：維持停止寫入與維護狀態 → 確認無其他公司資料與全域唯一值衝突 → `downgrade` → 用 `inventory` 比對原筆數 → 部署舊版程式後再開放服務。`verify` 是多租戶結構檢查，降版後預期失敗，不能作為回滾成功判據。必要時依經驗證的完整備份還原程序處理，不可直接覆蓋現況。

## 5. 分階段工作清單

- **Phase 1（本次）多租戶基礎 + 派工流程**
  - 資料模型、遷移/回滾腳本、SQLite 與 PostgreSQL 雙測
  - 工作區解析與授權、任務/工時/附件/下載/匯出/據點/品牌/角色名稱/回報範本全部隔離
  - 公司建立、邀請碼加入、成員管理、工作區切換
  - 舊模組限定立翔工作區（伺服器端）
  - 前端：TaskGo 平台品牌、工作區切換、公司建立/加入、成員邀請、「今日工作」手機頁
  - 測試：跨工作區越權測試、路由稽核測試、既有 62 個測試維持通過
- **Phase 2 其他模組隔離**：CRM/報價/合約/請款/材料/通知規則改查詢與唯一鍵，逐一開放給所有公司
- **Phase 3 iOS 原生體驗**：推播（APNs + device token）、通知點擊開任務、相機/相簿外掛、網路錯誤與重新登入狀態、PrivacyInfo.xcprivacy
- **Phase 4 上架準備**：帳號刪除、隱私權政策、App Privacy 資料揭露、審核帳號、真機測試、4.2 風險評估
- **Phase 5 方案**：方案上限（成員數/儲存量）與權限邊界；付款整合需另行決策

## 6. 驗證紀錄（2026-09-24）

- 後端測試：82 項全數通過（原 62 項＋新增 20 項：跨工作區越權、路由政策稽核、派工流程、遷移往返、推播）。
- PostgreSQL 18（本機拋棄式容器，還原 2026-07-22 備份）：`upgrade` 回填 9 個帳號、66 件任務與全部 CRM 資料；`verify` 通過；重跑 `upgrade` 無變更；新公司讀取立翔任務 404、呼叫 CRM 403；`downgrade` 在有其他公司資料時拒絕，強制後 schema 與遷移前逐行相同、1,504 筆資料內容完全一致；其他系統的表（users/groups/expenses）未被觸及。容器與資料副本已刪除。
- SQLite：單元測試涵蓋 upgrade → verify → downgrade 往返。

## 7. Phase 1 的已知限制

- CRM/報價/請款/材料/LINE 設定/通知規則仍是全域資料，伺服器端只開放給立翔工作區；新公司看不到也呼叫不到（403）。
- CRM PDF/Excel 仍寫死「立翔水電行」（目前僅立翔可用，Phase 2 改讀公司名稱）。
- LINE 綁定帳號的 `tasks`/本週行程會列出該帳號在所有公司被指派的工作（僅限本人）。
- 通知 Email/LINE 規則與任務連結網址為全域設定。
- 公開自助註冊（建立公司）預設開啟，可用 `ALLOW_PUBLIC_SIGNUP=0` 關閉；舊的 `ALLOW_PUBLIC_WORKER_REGISTRATION` 已不再使用（加入既有公司一律需邀請碼）。
