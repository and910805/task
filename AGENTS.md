# TaskGo 開發說明

## 專案架構概述
- **backend/**：Flask + SQLAlchemy + SQLite，提供 RESTful API 與檔案上傳服務。
- **frontend/**：React（Vite）建置的前端單頁應用，透過 Axios 與後端 `/api` 介接。

## Flask 後端主要模組
- **routes/auth.py**：處理登入、註冊、使用者管理（列表、建立、刪除、密碼變更等）。
- **routes/tasks.py**：提供任務 CRUD、更新紀錄、附件上傳等相關 API。
- **routes/users.py**：目前邏輯合併於 `routes/auth.py`，若後續拆分請沿用角色驗證與回傳格式。

## React 前端主要頁面
- **LoginPage.jsx**：登入介面，呼叫 `/api/auth/login` 取得 JWT 與使用者資訊。
- **TaskListPage.jsx**：任務總覽，依角色顯示自己相關的任務並支援進度更新。
- **AdminPage.jsx**：管理員專用頁面，可檢視所有使用者、建立/刪除帳號與快速新增工人。
- **ProfilePage.jsx**：個人設定頁，提供密碼變更流程並顯示基本資訊。

## 使用說明
1. **啟動後端**：
   ```bash
   cd backend
   flask --app app run --debug
   ```
   - 需要 Python 3.10+ 與 `pip install -r requirement.txt`。
2. **啟動前端**：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   - 預設於 http://localhost:5173 提供開發伺服。

## 本地開發指南
- **取得最新程式碼**：`git pull origin codex/fix-task-assignment-and-user-registration`
- **建置前端**：`npm run build --prefix frontend`（輸出於 `frontend/dist`）
- **重啟服務**：後端使用 `Ctrl+C` 停止，再執行啟動指令；若使用 systemd/gunicorn，請依部署環境重啟服務。

## 常見問題排除
- **JWT 相關錯誤（例如 Subject must be a string）**：確認 `create_access_token` 的 identity 使用字串並在取用時轉回整數。
- **資料庫結構改變**：本專案使用 SQLite，若資料表需更新請先備份 `backend/task_manager.db`，再執行自訂 migration 或 `db.create_all()`。
- **`npm run build` 失敗**：確保已安裝相依套件與 Node.js 版本 >= 18，若出現路徑問題檢查 `vite.config.js` 的 `outDir` 設定。
