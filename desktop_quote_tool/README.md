# 地端會計報價工具

這個資料夾提供一個可在 Windows 電腦執行的小程式，讓會計可直接：

- 登入 TaskGo 系統
- 查詢報價單列表
- 開啟報價單 PDF / XLSX
- 建立新報價單

## 介面說明

- 已改為中文介面
- 分成「報價單查詢」與「建立報價單」兩個分頁
- 版面有清楚區塊（系統連線 / 列表 / 明細 / 輸入表單）
- 建立估價單改為表格操作，不用再手打逗號字串
- 品項可直接從系統「價目表」帶入
- 稅率固定 `0%`（未稅模式）
- PDF 提供兩種：
  - `PDF（地端繁中）`：在本機重建 PDF，優先確保中文字
  - `PDF（系統）`：直接開後端產生的 PDF

## 為什麼不用直接連資料庫

建議用 API，不要讓會計電腦直連 PostgreSQL。

- 不會把資料庫帳密散佈到每台電腦
- 可沿用你後端的權限與驗證
- DB schema 調整時，地端工具不用大改

## 快速啟動（Windows）

1. 進入 `desktop_quote_tool`
2. 雙擊 `run.bat`
3. 會自動建立 `.venv`、安裝套件、啟動程式

## 手動啟動

```powershell
cd desktop_quote_tool
py -3 -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## 登入設定

- 系統網址：`https://task.kuanlin.pro`
- 使用既有帳號密碼（admin / hq_staff / site_supervisor）

## 品項輸入格式

目前改為 UI 欄位與表格操作：

1. 先從「價目表」選品項按「帶入」，或手動填入一筆後按「手動新增」
2. 在下方表格確認品項
3. 需要時可刪除選取或清空全部
4. 系統會自動計算「未稅合計」

## 打包成 EXE（可選）

```powershell
cd desktop_quote_tool
.\.venv\Scripts\activate
pip install pyinstaller
pyinstaller --onefile --windowed app.py
```

輸出檔案：`desktop_quote_tool\dist\app.exe`
