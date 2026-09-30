# 立翔水電行 開發說明

本文件提供專案開發、維運與除錯的完整指引。請在變更前後端時同步維持規範一致性。

## 目錄
- [當前狀況與注意事項](#當前狀況與注意事項)
- [專案架構概述](#專案架構概述)
- [API 文件（JSON 預設）](#api-文件json-預設)
- [資料庫結構說明（SQLite）](#資料庫結構說明sqlite)
- [已知錯誤與修正建議](#已知錯誤與修正建議)
- [部署環境設定範例](#部署環境設定範例)
- [開發者調試指南](#開發者調試指南)
- [任務模型與前端功能擴充](#任務模型與前端功能擴充)
- [2026-01 更新：完工規則與 LINE 流程](#2026-01-更新完工規則與-line-流程)

---

## 當前狀況與注意事項
- 前後端品牌名稱請統一顯示為「立翔水電行」，登入頁與應用程式頂部需顯示一致的 Logo 與字樣。
- 圖片上傳雖可成功，但前端仍無法顯示預簽名連結內容，需持續排查 S3 URL 或授權流程。
- 管理員後台已提供「角色顯示名稱」自訂功能（例如「工人」→「水電工」），請確保前後端一致。
- 管理員後台已新增「品牌設定」，可自訂登入畫面標題並上傳網站 Logo；登入頁與內部頁面會同步顯示最新品牌資訊。
- 任務支援多重指派，API 會回傳 `assignee_ids` 與 `assignees` 陣列，前端需使用多選元件調整對象。
- 使用者可在個人資料頁設定任務通知方式（Email 或 LINE Notify），指派與狀態更新會觸發通知。
- Flask 會在處理請求前檢查 JWT：未驗證的非 API 流量會被重新導向至登入頁；所有非 `/api/` 路由回傳 React build 的 `index.html`，避免重新整理後 404。
- 前端改以 `localStorage` 儲存 JWT，Axios 會自動附加 `Authorization: Bearer` 標頭並在登出時清除 Token。

## 專案架構概述
- **backend/**：Flask + SQLAlchemy + SQLite，提供 RESTful API、JWT 驗證與檔案上傳功能。
- **frontend/**：React（Vite）打造的單頁應用程式，使用 Axios 呼叫後端 `/api` 端點。

---

## API 文件（JSON 預設）
> 除 `/api/auth/login` 與匿名 worker 註冊（`/api/auth/register` with `role=worker`）外，其他路由皆需在 `Authorization: Bearer <JWT>` 中攜帶存取權杖。

### POST `/api/auth/register`
- **權限**：
  - 匿名使用者僅能建立 `worker` 帳號。
  - 已登入 `admin` 可建立任意角色並指定密碼。
- **Body**：`{ "username": str, "password"?: str, "role": "worker" | "site_supervisor" | "hq_staff" | "admin" }`
- **Response**：
  ```json
  {
    "msg": "User created",
    "user": { "id": 1, "username": "worker1", "role": "worker" },
    "generated_password": "Temp#123" // 僅在 admin 未提供密碼時回傳
  }
  ```

### POST `/api/auth/login`
- **權限**：公開。
- **Body**：`{ "username": str, "password": str }`
- **Response**：
  ```json
  {
    "token": "<JWT>",
    "user": { "id": 1, "username": "worker1", "role": "worker" }
  }
  ```

### GET `/api/auth/users`
- **權限**：需 `admin` JWT。
- **Response**：
  ```json
  {
    "users": [
      {
        "id": 1,
        "username": "worker1",
        "role": "worker",
        "created_at": "2024-05-01T04:00:00Z",
        "assigned_tasks": [
          { "id": 12, "title": "鋪設電纜", "status": "進行中" }
        ]
      }
    ],
    "total": 8
  }
  ```

### GET `/api/tasks`
- **權限**：任一已登入使用者。
- **行為**：
  - `worker` 只會收到指派給自己的任務。
  - `site_supervisor` 看到自己建立或指派的任務。
  - `hq_staff` 與 `admin` 看到全部。
- **Response**：陣列，每個元素皆為 `Task.to_dict()` 的輸出（詳見下節）。

### POST `/api/tasks`（沿用舊版）
- **權限**：`site_supervisor`、`hq_staff`、`admin`。
- **Body**：同 `/api/tasks/create`，若使用舊端點仍可建立任務。

### POST `/api/tasks/create`
- **權限**：`site_supervisor`、`hq_staff`、`admin`。
- **Body 必填欄位**：
  ```json
  {
    "title": "吊裝設備",
    "description": "使用 50 噸吊車完成機具進場",
    "location": "台北廠房 A 區",
    "expected_time": "2024-06-01T09:00:00+08:00",
    "status": "尚未接單",
    "assigned_to_id": 3 // 可為 null
  }
  ```
- **Response**：新建任務物件。

### GET `/api/tasks/<id>`
- **權限**：任一已登入使用者。
- **行為**：
  - `worker` 僅能讀取被指派的任務，否則回傳 403。
- **Response**：包含附件與更新紀錄的完整任務資訊。

### PUT `/api/tasks/<id>`
- **權限**：`site_supervisor`、`hq_staff`、`admin`。
- **用途**：調整標題、描述、地點、預計完成時間、截止時間、指派對象與進度。
- **注意**：狀態需落在允許值（尚未接單/進行中/已完成），更新成功後回傳最新任務物件。

### PATCH `/api/tasks/update/<id>`
- **權限**：`site_supervisor`、`hq_staff`、`admin`。
- **Body**：可單獨更新 `status`、`location`、`description`、`expected_time` 等欄位。
- **行為**：狀態由非「已完成」變更為「已完成」時自動寫入 `completed_at`。

### POST `/api/tasks/<id>/time/start`
- **權限**：任一能檢視該任務的登入者（工人僅能操作被指派任務）。
- **行為**：建立一筆進行中的工時紀錄（`TaskUpdate.start_time`），若同一使用者已有未結束的紀錄則回傳 400。
- **Response**：目前進行中的工時資訊，含 `start_time`、`user_id`。

### POST `/api/tasks/<id>/time/stop`
- **權限**：同上。
- **行為**：將最近一筆尚未結束的工時紀錄寫入 `end_time` 與 `work_hours`（四捨五入到小數點兩位）。
- **Response**：更新後的工時紀錄。

### POST `/api/upload/tasks/<id>/images`
- **權限**：任務負責人或具管理角色者。
- **傳入**：`multipart/form-data`，欄位 `file`（圖片檔）與選填 `note`。
- **行為**：儲存至 `/uploads/images/` 或對應 S3 bucket，建立 `Attachment`（`file_type=image`）。
- **Response**：附件資訊（`url`、`uploaded_at` 等）。

### POST `/api/upload/tasks/<id>/audio`
- **權限**：同上。
- **傳入**：`multipart/form-data`，欄位 `file`（音訊檔）、選填 `note`、`transcript`。
- **行為**：儲存語音檔並新增 `Attachment`（`file_type=audio`、含 `transcript`）。

### POST `/api/upload/tasks/<id>/signature`
- **權限**：同上。
- **Body**：`{ "data_url": "data:image/png;base64,...", "note"?: str }`
- **行為**：覆蓋任務既有簽名附件，僅保留最新一筆（`file_type=signature`）。

### GET `/api/upload/files/<path>`
- **權限**：須登入；若後端為 S3 模式則回傳重新導向到預先簽名網址。
- **行為**：下載附件或簽名檔。

### GET `/api/export/tasks`
- **權限**：`admin`、`hq_staff`、`site_supervisor`。
- **行為**：產出 Excel 報表，內容含任務基本資料、附件列表、工時明細；檔案儲存於 `/uploads/reports/` 或 S3 對應位置。
- **Response**：`{ "url": "/api/upload/files/reports/<filename>.xlsx", "filename": "...xlsx" }`。

### GET `/api/export/download/<filename>`
- **權限**：與 `GET /api/export/tasks` 相同。
- **行為**：對於使用本地儲存時提供直接下載（S3 模式仍會重新導向到簽名 URL）。

---

## 資料庫結構說明（SQLite）

### `user` 表
| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| id | INTEGER | ✅ | 主鍵 |
| username | TEXT | ✅ | 唯一帳號 |
| password_hash | TEXT | ✅ | Bcrypt 雜湊 |
| role | TEXT | ✅ | `worker` / `site_supervisor` / `hq_staff` / `admin` |
| created_at | DATETIME |  | 預設 `datetime.utcnow` |
| updated_at | DATETIME |  | 異動自動更新 |

### `task` 表
| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| id | INTEGER | ✅ | 主鍵 |
| title | TEXT | ✅ | 任務標題 |
| description | TEXT | ✅ | 任務內容描述 |
| status | TEXT | ✅ | 預設「尚未接單」，限定三種狀態 |
| location | TEXT | ✅ | 任務發生地點 |
| expected_time | DATETIME | ✅ | 預計完成時間（ISO 字串轉 datetime 儲存） |
| completed_at | DATETIME |  | 狀態變更為「已完成」時自動填入 |
| assigned_to_id | INTEGER |  | 指派對象，對應 `user.id`，允許 NULL |
| assigned_by_id | INTEGER |  | 建立任務者，對應 `user.id`，允許 NULL |
| due_date | DATETIME |  | 任務截止時間，允許 NULL |
| total_work_hours | Virtual |  | 非資料庫欄位，`Task.to_dict()` 會回傳累計工時（小時） |
| created_at | DATETIME |  | 預設 `datetime.utcnow` |
| updated_at | DATETIME |  | 異動自動更新 |

### `task_update` 表
| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| id | INTEGER | ✅ | 主鍵 |
| task_id | INTEGER | ✅ | 關聯 `task.id` |
| user_id | INTEGER |  | 回報者，刪除使用者時設為 NULL |
| status | TEXT |  | 回報狀態（可重複使用任務狀態值） |
| note | TEXT |  | 備註 |
| start_time | DATETIME |  | 工時開始時間 |
| end_time | DATETIME |  | 工時結束時間 |
| work_hours | FLOAT |  | 工時長度（小時），`stop` 時自動計算 |
| created_at | DATETIME |  | 預設 `datetime.utcnow` |

### `attachment` 表
| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| id | INTEGER | ✅ | 主鍵 |
| task_id | INTEGER | ✅ | 關聯 `task.id` |
| uploaded_by_id | INTEGER |  | 上傳者，允許 NULL |
| file_type | TEXT |  | `image` / `audio` / `signature` / `other` |
| original_name | TEXT |  | 原始檔名 |
| file_path | TEXT | ✅ | 儲存路徑 |
| transcript | TEXT |  | 語音逐字稿（僅 `audio` 類型） |
| note | TEXT |  | 附件說明 |
| uploaded_at | DATETIME |  | 預設 `datetime.utcnow` |

> 目前角色資訊存放於 `user.role` 欄位，尚未拆分獨立 `role` 表。

---

## 已知錯誤與修正建議
- **Subject must be a string**：
  - 成因：舊版 JWT 將 `identity` 設為整數，導致 PyJWT 驗證 `sub` claim 時丟出 `TypeError`。
  - 修正方式：登入時使用 `create_access_token(identity=str(user.id), additional_claims={"role": user.role})`，並在伺服端解析時透過 `int()` 轉回使用者 ID。若仍遇到錯誤，請清除舊 JWT（重新登入即可）。
- **AdminPage 使用者清單為空**：
  1. 後端執行 `User.query.count()` 確認資料確實存在。
  2. 使用 `flask --app app shell` 呼叫 `/api/auth/users` 對應的 view，或以 Postman / curl 發送帶有管理員 JWT 的請求。
  3. 檢查回傳 JSON 是否包含 `users` 陣列與 `total` 欄位；React 端的 `AdminPage` 會同時兼容陣列或含 `users` 欄位的物件。
  4. 若收到 401，確認 Token 是否過期或角色是否為 `admin`。

---

## 部署環境設定範例
- **systemd (`/etc/systemd/system/taskgo.service`)**
  ```ini
  [Unit]
  Description=立翔水電行 Gunicorn Service
  After=network.target

  [Service]
  User=ubuntu
  WorkingDirectory=/opt/taskgo/backend
  Environment="PATH=/opt/taskgo/venv/bin"
  ExecStart=/opt/taskgo/venv/bin/gunicorn -w 4 -b 127.0.0.1:5000 app:app
  Restart=on-failure

  [Install]
  WantedBy=multi-user.target
  ```
- **Gunicorn 指令**：`gunicorn -w 4 -b 127.0.0.1:5000 app:app`
- **Nginx 反向代理**：
  ```nginx
  server {
      listen 80;
      server_name example.com;

      location /api/ {
          proxy_pass http://127.0.0.1:5000/api/;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      }

      location / {
          root /opt/taskgo/frontend/dist;
          try_files $uri /index.html;
      }
  }
  ```

---

## 開發者調試指南
- **啟動服務**：
  - 後端：`cd backend && pip install -r requirements.txt && flask --app app run --debug`
  - 前端：`cd frontend && npm install && npm run dev`
- **取得最新程式碼**：`git pull origin codex/fix-task-assignment-and-user-registration`
- **建置前端**：`npm run build --prefix frontend`（輸出至 `frontend/dist`，由 Flask 伺服靜態檔）。
- **清除 SQLite 舊資料**：停止服務後刪除或重新命名 `backend/task_manager.db`，再執行 `flask --app app shell` 內的 `db.create_all()`；或於 shell 執行：
  ```python
  from app import db
  db.drop_all()
  db.create_all()
  ```
- **同時監看日誌**：
  - VSCode Remote：開啟兩個終端分頁，分別跑 `npm run dev` 與 `flask --app app run`。
  - EC2 上：`journalctl -u taskgo.service -f` 觀察後端；`tail -f /var/log/nginx/access.log /var/log/nginx/error.log` 追蹤前端/代理請求。

---

## 任務模型與前端功能擴充

### 1. `Task` 模型最新欄位表
| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| title | TEXT | ✅ | 任務名稱 |
| description | TEXT | ✅ | 任務內容描述 |
| status | TEXT | ✅ | 只能為「尚未接單」→「進行中」→「已完成」之一 |
| location | TEXT | ✅ | 任務地點 |
| expected_time | DATETIME | ✅ | 前端以 `datetime-local` 輸入，後端儲存為 UTC |
| completed_at | DATETIME |  | 自動記錄任務完成時間 |
| assigned_to_id | INTEGER |  | 被指派者（可為 NULL） |
| assigned_by_id | INTEGER |  | 建立者（可為 NULL） |
| due_date | DATETIME |  | 任務截止（可為 NULL） |
| attachments / updates | 關聯 |  | 同前述關係；`time_entries` 會在序列化時提供工時清單 |
| total_work_hours | 虛擬欄位 |  | `Task.to_dict()` 加總所有工時紀錄（小時） |

### 2. 新增／修改的 API 說明
- **POST `/api/tasks/create`**：強制驗證 `title`、`description`、`location`、`expected_time`、`status`，並禁止將任務指派給 `admin`。`status` 僅允許三種中文值。
- **PATCH `/api/tasks/update/<id>`**：允許局部更新；當 `status` 由非「已完成」變為「已完成」時會寫入 `completed_at = datetime.utcnow()`，若狀態改回其他值會清空完成時間。
- **PUT `/api/tasks/<id>`**：沿用原有行為，但同樣套用必填欄位驗證與完成時間邏輯。
- **POST `/api/tasks/<id>/time/start` / `/stop`**：由被指派工人或管理者觸發工時開始/結束，後端負責建立或結束 `TaskUpdate` 的工時欄位。
- **POST `/api/upload/tasks/<id>/images` / `/audio` / `/signature`**：分別處理照片、語音、簽名上傳，簽名僅保留最近一筆。
- **GET `/api/export/tasks`**：產出任務報表並回傳下載連結（同時支援本地與 S3 儲存）。

### 3. 任務狀態流轉邏輯
1. 預設建立時為「尚未接單」。
2. 管理員或主管可透過列表/詳細頁更新為「進行中」。
3. 當狀態改成「已完成」：
   - `Task.completed_at` 立即寫入目前 UTC 時間。
   - 後續若狀態調整回其他值，`completed_at` 會被清除，以確保資料一致性。
4. 任務更新紀錄（`TaskUpdate`）的狀態欄位亦使用相同值，確保前後端顯示一致。

### 4. 前端任務建立與驗證
- `TaskListPage` 的建立表單新增「地點、內容描述、預計完成時間、任務進度」欄位，皆為必填。
- 未填寫必填欄位或時間格式無法解析時，會顯示錯誤訊息並阻擋提交。
- 管理員在列表中可直接透過下拉選單更新任務進度；更新成功後會重新載入任務清單。
- 詳細頁 (`TaskDetailPage`) 改為多分頁介面：
  - 「📷 照片」：可預覽縮圖並上傳圖片檔。
  - 「🎤 語音」：支援檔案上傳與瀏覽器錄音，並可填寫逐字稿。
  - 「✍️ 簽名」：提供 Canvas 簽名板，提交後自動覆蓋舊簽名。
  - 「⏱ 工時」：顯示總工時、歷史紀錄，並提供開始/結束工作按鈕。
- 任務基本資訊頁仍顯示狀態、地點、預計/完成時間與總工時；狀態選項同步使用中文值。
- 管理員頁 (`AdminPage`) 新增「匯出報表」按鈕，呼叫 `/api/export/tasks` 產出 Excel。

### 5. 新增欄位的資料庫調整建議
- **開發用**：刪除 `backend/task_manager.db` 並重新 `db.create_all()`。
- **既有環境**（需備份）：
  ```sql
  ALTER TABLE task ADD COLUMN location TEXT;
  ALTER TABLE task ADD COLUMN description TEXT;
  ALTER TABLE task ADD COLUMN expected_time DATETIME;
  ALTER TABLE task ADD COLUMN completed_at DATETIME;
  UPDATE task SET status = '尚未接單' WHERE status IS NULL;
  UPDATE task SET description = COALESCE(description, '');
  ```
  之後依需求填入地點、預計完成時間與描述，或透過管理介面重新建立任務。

---

## 2026-01 更新：完工規則與 LINE 流程

### 完工規則（後端強制 + 前端預檢）
- 適用對象：`role=worker`
- 觸發條件：`POST /api/tasks/<id>/updates` with `status=已完成`
- 必備條件：
  1) `note` 必填（trim 後不得為空）
  2) 任務至少存在 1 張由該 worker 自己上傳的 image 附件（`file_type=image` 且 `uploaded_by_id == worker.id`）

### 上傳權限（支援多重指派）
- worker 只要符合其一即可上傳：
  - `assigned_to_id == user_id`
  - `task.assignees` 內含 `user_id`（`task_assignee` 關聯）

### 前端行為（TaskDetailPage）
- worker 在 Web UI 選「已完成」送出前會檢查：`note` + 至少 1 張照片；不符合會提示並導到 photos tab。

### LINE 指令流程（Webhook）
- `tasks` / `start <id>` / `done <id> <說明>`
- `done` 進 pending，收到照片後：下載 bytes → 存 image 附件 → 寫 `TaskUpdate(已完成, note)` → 更新 `task.completed_at`

### LINE 相關環境變數
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`

### PDF 印章預覽（2026-09-30）

- 報價／請款列表的「印章預覽」支援自動、手動拖曳、頁碼、恢復自動與儲存並下載；只預覽已儲存的單據內容。
- `GET /api/crm/<quotes|invoices>/<id>/stamp-preview?page=1` 回傳無章的 PDF 頁面圖片、原尺寸印章及實際表格座標；`PUT .../stamp-position` 儲存 `mode=auto` 或 `mode=manual` 加 `page/x/y/fingerprint`。座標單位是 PDF points，原點在左下。
- 正式站單公司版本使用既有 `site_setting` 的 `pdf_stamp_quotes_<id>`／`pdf_stamp_invoices_<id>`，不新增資料表或欄位；不要混入多公司版本的資料庫遷移。複製／轉請款預設重新自動排版。
- 後端驗證登入角色、表格邊界與文字／非零金額碰撞；已轉請款的報價與已簽名的請款禁止改章。手動位置失效時下載回傳 409，須重新預覽確認或恢復自動。
- PDFium 預覽使用 `pypdfium2` 並以程序內鎖串行化渲染；部署需安裝更新後的 `backend/requirements.txt`。
- 驗證：`tests/test_pdf_stamp_editor.py`、`tests/test_crm_pdf_stamp.py`，包含權限、無效座標、多頁、舊版面、簽名鎖定與下載座標一致性。
