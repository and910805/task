# TaskGo iOS：App Store 上架審查（2026-09-29）

> **現在還不能送審，也不能宣稱已符合全部上架條件。** Codemagic 模擬器建置及正式簽署上傳已成功；正式後端遷移、畫面驗收、TestFlight 實機操作與 Apple 審查仍未完成。

## 雲端建置紀錄（2026-09-29）

- 固定來源：`and910805/task` 的 `d14a97e3b6af4c2ccbcc4672f506d32da23ec814`；原生包裝：`and910805/kuanlin-mobile-apps` 的 `5f21e5bec1b2ba3816532981db827f29d470b580`。兩者皆推送至獨立 `codex/taskgo-ios-release` 分支，未合併正式分支或執行正式資料遷移。
- [模擬器建置](https://codemagic.io/app/6ab3b6a61cfcfc47b314f503/build/6abaa0fc083ff0a9a53a2835)：finished，2m13s；固定來源重建、同步、檢查、編譯、安裝啟動和 PNG 截圖命令成功。瀏覽器阻擋 artifacts ZIP 下載，截圖尚未目視驗收，不推定畫面正確。
- [簽署建置](https://codemagic.io/app/6ab3b6a61cfcfc47b314f503/build/6abaa2085a3a7169f3d38767)：finished，2m53s；TaskGo 1.0 (9)、bundle `online.kuanlin.taskgo`，產出 App.ipa，Apple 回傳 `UPLOAD SUCCEEDED with no errors`。
- 未送 App Review、未自動分派 TestFlight 測試者、未驗證實機推播及正式後端相容性。下方歷史準備清單不得取代以上建置證據與剩餘驗收。

## 目前驗證狀態（2026-09-29）

- App Store Connect 已有 TaskGo，Apple ID `6815704132`，版本 1.0「準備提交」；查核時無建置版本、截圖與完整商品資訊。
- Codemagic 專案是 `kuanlin-mobile-apps`，有 `bloombook-release` Apple 整合。使用者已同意 TaskGo 沿用該整合；TaskGo 仍使用自己的 bundle ID 與簽署描述檔。
- 本機 TaskGo 工作流程已改為固定 Xcode 26.6、指定 `TASKGO_SOURCE_COMMIT` 完整版本碼重新建置、產出來源紀錄、同步後驗證、遞增版號。非 TaskGo 工作流程經結構比較保持不變。尚未推送及雲端執行。
- 使用者同意後，TaskGo 圖示已以白底合成為 1024x1024 RGB PNG，不縮放、不重畫；`npm run verify -- --app=taskgo` 通過。模擬器啟動及截圖步驟已加入，尚未執行。
- 使用者重新登入後，TaskGo 的 Push Notifications 與 Associated Domains 已儲存，重新開啟識別碼頁確認兩者皆勾選。已沿用現有 Distribution 憑證建立 `taskgo-appstore`（ID `36675RSWG5`，到期 2027-09-28），並以相同 reference 匯入 Codemagic；頁面確認 bundle ID 為 `online.kuanlin.taskgo`。未修改 BloomBook 描述檔。這不代表 APNs 後端金鑰或實機推播已設定完成。
- 公開營運者 `kuanlin` 與客服 `goole910805@gmail.com` 已填入隱私權頁及服務條款；尚待正式部署與完整資料類別核對。
- CRM、材料及報表已在本機程式開放給新工作區；移除測試中的舊模組開放補丁後，後端全套 113 項通過。
- 唯一鍵遷移測試 SQLite 4 項通過，獨立本機 PostgreSQL 3 項通過、1 項 SQLite 專用測試跳過。覆蓋既有子資料、額外欄位、索引與觸發器保留，以及舊全域唯一鍵偵測；尚未批准或執行正式遷移。
- 公開隱私權頁與原生 PrivacyInfo 已補 CRM 聯絡資訊、報價請款及材料資料，共 12 類資料；XML 結構檢查通過。依據與剩餘核對見 `docs/taskgo-privacy-inventory.md`，ASC 尚未申報，不得沿用舊版六類清單直接送審。
- 本機獨立 SQLite 兩公司、相同管理員角色驗收：在 `/app` 原地切換 A → B，頁面由 A 任務更新成 B 任務；已用帳號/公司/角色組合重建路由內容，防止舊頁面狀態殘留。
- 首頁統一 UTC 解析後，同一任務從錯誤的 `09/28 16:36` 顯示為台灣當地 `09/29 00:36`，今日工作計數由 0 更正為 1。瀏覽器現場驗證及前端日期單元測試通過；擴充的自動瀏覽器腳本尚待完整重跑。
- `/legal/support` 已提供公開客服信箱；390px 手機畫面無橫向溢出，無須登入即可開啟。正式支援網址待部署後查驗，不能先聲稱已上線。
- 完整上架檢查與建置順序另見 mobile 專案的 `apps/taskgo/RELEASE.md`。以下部分為前一輪實作紀錄，未實測項目不能視為通過。

## 1. Apple 現行規範對照

| 規範 | 要求 | TaskGo 現況 | 結果 |
| --- | --- | --- | --- |
| SDK 最低版本（2026-04-28 起） | Xcode 26 + iOS 26 SDK 建置 | TaskGo 設定 Xcode 26.6；部署目標 iOS 15 | 待雲端建置紀錄驗證 |
| 2.1(a) 完整性 | 有登入的 App 必須提供審核帳號、後端要開著 | 新增 `flask create-review-workspace` 建立隔離的示範公司（擁有者＋現場人員＋4 件示範工作） | ⚠️ 需在正式環境執行並把帳密填入 ASC |
| 4.2 最低功能 | 不能只是打包的網站 | 原生推播、通知點擊開任務、Universal Links、相機、離線提示、登入過期處理、手機專用「今日工作」流程 | ⚠️ 主體仍是 WebView，需在審核備註說明；推播若未上線風險升高 |
| 4.8 登入服務 | 用第三方社群登入才需 Sign in with Apple | 只有自家帳號 | ✅ 不適用 |
| 5.1.1(i) 隱私權政策 | ASC 欄位與 App 內都要有連結，需說明蒐集、第三方、保存/刪除 | `/legal/privacy` 已補營運者聯絡方式 | 待資料類別核對、部署及 ASC 設定 |
| 5.1.1(v) 帳號刪除 | App 內可刪除帳號 | 「我的 → 刪除帳號」＋ `DELETE /api/auth/account`，測試通過 | ✅ |
| 5.1.1(ii)/(iii) 權限說明與最小化 | purpose strings 清楚；用系統選擇器 | 相機/相簿/麥克風說明為中文且具體；照片用系統 file picker（不要求整個相簿權限） | ✅ |
| 隱私清單（2024-05-01 起） | `PrivacyInfo.xcprivacy` 含 required-reason API | 已新增並加入 Xcode 專案；宣告 UserDefaults CA92.1 與蒐集資料類型 | ✅（需 Xcode Analyze 再確認外掛無其他 API） |
| 年齡分級新問卷（2026-01-31 起） | 依實際功能作答 | ASC 記錄已建立 | 待完成問卷，不預先保證分級 |
| 出口合規 | 宣告加密使用 | `ITSAppUsesNonExemptEncryption=false`（僅 HTTPS） | ✅ |
| 2.3.10 中繼資料 | 不含其他平台名稱/圖像 | 打包內容已移除立翔行銷網站（`salesite/`）；bundle 內已無「立翔」字樣 | ✅ |
| 5.1.2 資料使用 | 不追蹤、無廣告 SDK | 無任何第三方分析/廣告 SDK | ✅ |
| iPad | 若支援需 iPad 截圖與版面 | 已改為 **iPhone only**（`TARGETED_DEVICE_FAMILY = 1`）；日後要支援再改回 | ✅ |

來源：[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)、[Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)、[Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)、[Capacitor Privacy Manifest](https://capacitorjs.com/docs/ios/privacy-manifest)、[Capacitor Deep Links](https://capacitorjs.com/docs/guides/deep-links)。

## 2. 本次在 Windows 上完成並驗證的事

**iOS 專案（`kuanlin-mobile-apps/apps/taskgo`，只動 TaskGo 相關檔案）**
- `PrivacyInfo.xcprivacy` 新增並登錄到 `project.pbxproj`（Resources）。
- `App.entitlements`：`aps-environment`（development）＋ `applinks:task.kuanlin.online`；`CODE_SIGN_ENTITLEMENTS` 已指向它。
- `Info.plist`：`UIRequiredDeviceCapabilities` 由範本殘留的 `armv7` 改為 `arm64`。
- `AppDelegate.swift`：加入 Capacitor 官方要求的兩個 APNs 回呼（與官方文件逐字相符）。
- `capacitor.config.json`：`PushNotifications.presentationOptions`。
- `apps/taskgo/package.json` 加入 `@capacitor/app@8.1.1`、`@capacitor/push-notifications@8.1.2`；根目錄 lockfile 已更新（僅新增條目）。
- `npx cap sync ios` 在 Windows 成功：`Package.swift` 已含兩個外掛、`packageClassList` 已登錄。
- 建置腳本會移除 `salesite/`、`sw.js`、`manifest.webmanifest`；已重新打包最新前端（含 `viewport-fit=cover`，讓 iPhone 安全區 CSS 生效）。
- `npm run verify` 通過。
- `codemagic.yaml` 的 `taskgo-ios-testflight` 僅上傳到 ASC（`submit_to_testflight: false`、`submit_to_app_store: false`），經使用者同意沿用現有 `bloombook-release` Apple 整合。

**後端（`task/backend`）**
- `/.well-known/apple-app-site-association`：`APPLE_TEAM_ID` 設定後才回應（Team ID 非機密但屬環境設定，不進 repo）；`/tasks/*`、`/join` 兩種連結會開在 App 內。
- `flask create-review-workspace`：密碼只從 `REVIEW_ACCOUNT_PASSWORD` 或互動輸入取得，不印出。
- 測試 85 項全部通過（新增 AASA、原生 origin 的 `X-Workspace-Id` preflight、審核公司隔離與密碼不外露）。

## 3. 上架前必須由你／在 Mac 完成的事（依序）

1. **等同事提交** `kuanlin-mobile-apps` 的 bloombook 修改後，把 TaskGo 的變更合併進去（避免覆蓋）。
2. **Apple Developer**：App ID `online.kuanlin.taskgo` 開啟 Push Notifications 與 Associated Domains；建立 APNs Auth Key (.p8)。金鑰只放到 Zeabur 環境變數：`APNS_KEY_ID`、`APNS_TEAM_ID`、`APNS_BUNDLE_ID`、`APNS_PRIVATE_KEY`；另設 `APPLE_TEAM_ID` 讓 AASA 生效。正式版把 `aps-environment` 改為 `production`。
3. **隱私權政策定稿**：營運者名稱與聯絡 Email 已填入 `frontend/src/pages/LegalPage.jsx`；完整核對及法律審閱後部署，ASC 隱私權政策網址填 `https://task.kuanlin.online/legal/privacy`。
4. **部署新版後端＋執行遷移**（見 `docs/taskgo-multitenancy.md` §4），再執行 `flask create-review-workspace` 建立審核帳號。
5. **Mac / Codemagic**：`npm ci` → `npm run build:taskgo-web` → `npm run ios:sync -- taskgo` → Xcode 開專案確認 Signing 與兩個 capability 正常 → Product ▸ Analyze 檢查隱私報告 → 跑 `taskgo-ios-testflight` 產生簽名版。
6. **真機測試清單**：登入／登入過期重登、切換公司、接單→開始→拍照（相機與相簿）→完工、推播到達與點擊開啟任務、點 `https://task.kuanlin.online/join?code=…` 直接開 App、飛航模式提示、刪除帳號。
7. **App Store Connect**：
   - 類別：Business（次要 Productivity）；年齡分級問卷預期 4+。
   - 截圖：iPhone 6.9" 或 6.5" 至少 3 張（今日工作、派工、完工回報）；本文件附的網頁模擬截圖**不可**直接當上架截圖。
   - App Privacy 申報：以 `docs/taskgo-privacy-inventory.md` 的 12 類為本機準備清單，仍需核對正式主機日誌、第三方服務及最終 Xcode 隱私報告後填入 ASC；不可僅憑 manifest 宣稱已完成申報。
   - 審核備註草稿：
     > TaskGo is a field-service dispatch tool for small contractors. Sign in with the demo company: owner account (creates jobs, invites members) and worker account (accepts jobs, tracks time, uploads photos, completes jobs). Native features: APNs push for new assignments (tap opens the job), universal links for invitations, camera capture for job photos, offline handling, in-app account deletion (Profile → Delete account). No third-party login or analytics.
   - 審核帳號：`review-owner` / `review-worker` 與你設定的密碼；確認正式後端開著。

## 4. 尚未做、且會影響審核的風險

| 風險 | 等級 | 說明 |
| --- | --- | --- |
| 從未在 iOS 模擬器/實機執行 | 高 | 本機無 Xcode；Package.swift 與 pbxproj 為手動/CLI 產生，需第一次 Codemagic 建置確認 |
| 隱私權政策仍為草稿 | 高 | ASC 必填 |
| 推播尚未實際發送過 | 中 | 後端邏輯有單元測試（ES256 token、無效 token 清除），但未對 APNs 連線 |
| 4.2 WebView 疑慮 | 中 | 已具備原生功能，仍可能被要求補充說明 |
| 其他人正在修改同一 repo | 中 | 合併時請保留 `apps/taskgo/**`、`codemagic.yaml` 的 taskgo 區塊、`scripts/build-taskgo-web.mjs` 的清理步驤 |
| CRM 合約乙方預設值 | 低 | 原本寫死立翔名稱與統編，現改為讀公司名稱、統編留空；Phase 2 需補「公司資料（統編、地址）」欄位 |
