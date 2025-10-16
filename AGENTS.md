# TaskGo 開發說明

## 專案架構概述
- **backend/**：Flask + SQLAlchemy + SQLite，提供 RESTful API 與檔案上傳服務。
- **frontend/**：React（Vite）建置的前端單頁應用，透過 Axios 與後端 `/api` 介接。

## Flask 後端主要模組
- **routes/auth.py**：處理登入、註冊、JWT 驗證、使用者列表、建立/刪除帳號與密碼變更。
- **routes/tasks.py**：提供任務 CRUD、更新紀錄、附件上傳與派工等 API。
- **routes/users.py**：目前邏輯合併於 `routes/auth.py`，若後續拆分請沿用現有的角色驗證、回傳格式與錯誤處理方式。

## React 前端主要頁面
- **LoginPage.jsx**：登入介面，呼叫 `/api/auth/login` 取得 JWT 與使用者資訊。
- **TaskListPage.jsx**：依角色顯示與使用者相關的任務列表，支援任務篩選、狀態更新與進度追蹤。
- **AdminPage.jsx**：管理員專用頁面，可檢視所有使用者、建立/刪除帳號與快速新增工人。
- **ProfilePage.jsx**：個人設定頁，提供密碼變更並顯示目前使用者的基本資訊。

## API 文件
> 所有 `/api/*` 路由皆回傳 JSON，除非另有註記。除 `/api/auth/login` 與 `/api/auth/register` 以外的路由皆需要在 `Authorization` header 內附帶 `Bearer <JWT>`。

### Auth 模組
- **POST `/api/auth/register`**
  - **需要權限**：匿名可註冊 `worker`；已登入的 `admin` 可建立任意角色。
  - **Body**：`{ "username": str, "password": str (可選), "role": str (預設 worker) }`
  - **回傳**：`{ "msg": "User created", "user": { ...User }, "generated_password"?: str }`
- **POST `/api/auth/login`**
  - **需要權限**：公開。
  - **Body**：`{ "username": str, "password": str }`
  - **回傳**：`{ "token": str, "user": { ...User } }`
- **GET `/api/auth/me`**
  - **需要權限**：JWT。
  - **回傳**：登入者的 `User` 資料。
- **GET `/api/auth/users`**
  - **需要權限**：`admin`。
  - **回傳**：`{ "users": [ { ...User, "assigned_tasks": [ { "id": int, "title": str, "status": str } ] } ], "total": int }`
- **POST `/api/auth/change-password`**
  - **需要權限**：JWT。
  - **Body**：`{ "current_password": str, "new_password": str, "confirm_password": str }`
  - **回傳**：`{ "msg": "密碼已更新" }`
- **DELETE `/api/auth/users/<user_id>`**
  - **需要權限**：`admin`。
  - **效果**：刪除使用者並將其相關的任務指派欄位設為 `null`。
  - **回傳**：`{ "msg": "User deleted" }`
- **GET `/api/auth/assignable-users`**
  - **需要權限**：`site_supervisor`、`hq_staff`、`admin`。
  - **回傳**：可指派任務的非 admin 使用者清單。

### Tasks 模組
- **GET `/api/tasks/`**
  - **需要權限**：JWT。
  - **說明**：依角色篩選任務（工人僅看到指派給自己的任務）。
  - **回傳**：`[ { ...Task } ]`
- **POST `/api/tasks/`**
  - **需要權限**：`site_supervisor`、`hq_staff`、`admin`。
  - **Body**：`{ "title": str, "description"?: str, "assigned_to_id"?: int, "due_date"?: ISOString }`
  - **回傳**：建立完成的 `Task`。
- **GET `/api/tasks/<id>`**
  - **需要權限**：JWT（工人僅能存取指派給自己的任務）。
  - **回傳**：指定任務完整資料與附件、更新紀錄。
- **PUT `/api/tasks/<id>`**
  - **需要權限**：`site_supervisor`、`hq_staff`、`admin`。
  - **Body**：可更新 `title`、`description`、`status`、`assigned_to_id`、`due_date`。
  - **回傳**：更新後的 `Task`。
- **POST `/api/tasks/<id>/updates`**
  - **需要權限**：JWT。
  - **Body**：`{ "status"?: str, "note"?: str }`
  - **回傳**：新增的 `TaskUpdate`。
- **POST `/api/tasks/<id>/attachments`**
  - **需要權限**：JWT。
  - **Form-Data**：`file`、`file_type`（image/audio/signature/other）、`note`。
  - **回傳**：新增的 `Attachment`。

## 資料庫結構
- **User (`user`)**
  - `id` INTEGER PK、`username` TEXT NOT NULL UNIQUE、`password_hash` TEXT NOT NULL、`role` TEXT NOT NULL（預設 `worker`）、`created_at` DATETIME、`updated_at` DATETIME。
  - 與 `Task.assigned_to_id`、`Task.assigned_by_id`、`TaskUpdate.user_id`、`Attachment.uploaded_by_id` 以外鍵關聯。
- **Task (`task`)**
  - `id` INTEGER PK、`title` TEXT NOT NULL、`description` TEXT NULLABLE、`status` TEXT NOT NULL、`assigned_to_id` INTEGER NULLABLE、`assigned_by_id` INTEGER NULLABLE、`due_date` DATETIME NULLABLE、`created_at` DATETIME、`updated_at` DATETIME。
  - 關聯：`assigned_to_id`、`assigned_by_id` 皆指向 `user.id`，`Attachment.task_id` 與 `TaskUpdate.task_id` 指回任務。
- **TaskUpdate (`task_update`)**
  - `id` INTEGER PK、`task_id` INTEGER NOT NULL、`user_id` INTEGER NULLABLE、`status` TEXT NULLABLE、`note` TEXT NULLABLE、`created_at` DATETIME。
  - `user_id` 採 `SET NULL`，允許刪除使用者後保留紀錄。
- **Attachment (`attachment`)**
  - `id` INTEGER PK、`task_id` INTEGER NOT NULL、`uploaded_by_id` INTEGER NULLABLE、`file_type` TEXT NULLABLE、`original_name` TEXT NULLABLE、`file_path` TEXT NOT NULL、`note` TEXT NULLABLE、`uploaded_at` DATETIME。
- **Role**：目前以文字欄位存於 `user.role`，未建立獨立資料表。若後續需要權限更細緻，可建立 `role` 表並透過多對多關聯管理。

## 使用說明
1. **啟動後端**：
   ```bash
   cd backend
   flask --app app run --debug
   ```
   - 需 Python 3.10+，安裝套件 `pip install -r requirements.txt`。
2. **啟動前端**：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   - 預設於 http://localhost:5173 提供開發伺服。

## 本地開發指南
- **取得最新程式碼**：`git pull origin codex/fix-task-assignment-and-user-registration`
- **建置前端**：`npm run build --prefix frontend`（輸出於 `frontend/dist`，供 Flask 伺服）。
- **重啟服務**：開發時使用 `Ctrl+C` 停止 Flask，再重新執行；伺服器上若以 systemd/gunicorn 執行，請重啟對應服務。

## 常見問題排除
- **Subject must be a string**：JWT `sub` 需為字串。登入時使用 `create_access_token(identity=str(user.id))`，取用時再轉為 `int`。若仍收到錯誤，可刪除舊 token 重新登入。
- **AdminPage 使用者列表為空**：
  1. 先確認後端 `User.query.count()` 是否大於 0。
  2. 以 `flask shell` 呼叫 `from routes.auth import list_users` 或透過 Postman 直接測試 `/api/auth/users`。
  3. 若回傳 401，檢查 JWT 是否過期或角色是否為 `admin`。
  4. 若回傳空陣列，確認資料庫路徑（`backend/task_manager.db`）是否與服務實際使用的相同。
- **資料庫結構調整**：SQLite 無自動 migration，請備份 `backend/task_manager.db` 後，使用 Alembic 或手動 SQL 更新欄位。
- **`npm run build` 失敗**：確保 Node.js >= 18 並已安裝依賴；若錯在 `vite`，檢查 `frontend/vite.config.js` 的 `outDir` 是否指向 `../frontend/dist`。

## 錯誤狀況與修正建議
- **JWT Subject must be a string**：成因為舊版 token 以整數作為 identity。修正方式：在產生 token 時 `identity=str(user.id)`，並在 `utils.get_current_user_id()` 轉回整數。
- **AdminPage 使用者清單為空**：請依照上述除錯步驟檢查 API 回傳、JWT 是否有效，以及 React 端是否正確解析 `data.users`。

## 部署環境設定範例
- **systemd（`/etc/systemd/system/taskgo.service`）**：
  ```ini
  [Unit]
  Description=TaskGo Gunicorn Service
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

## 開發者調試指南
- **清除 SQLite 測試資料**：刪除或重新命名 `backend/task_manager.db`，重新啟動 Flask 會自動建立新的資料庫。若僅需清空特定資料，可在 `flask shell` 中執行 `db.drop_all(); db.create_all()`。
- **同步查看日誌**：
  - VSCode Remote：同時開啟整個專案資料夾，使用分割終端啟動 `npm run dev` 與 `flask --app app run`，即可並排查看 React 與 Flask log。
  - EC2 伺服器：使用 `journalctl -u taskgo.service -f` 監看 Gunicorn log，前端若經由 Nginx 伺服，可用 `tail -f /var/log/nginx/access.log /var/log/nginx/error.log` 觀察請求。

