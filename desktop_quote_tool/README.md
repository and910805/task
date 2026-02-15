# Desktop Quote Tool (Local PC)

This folder provides a small desktop program for accounting staff to:

- Login to your existing TaskGo backend
- View quote list from system
- Open quote PDF/XLSX
- Create new quote quickly

## Why API instead of direct DB connection

Use backend API as the integration layer. Do **not** connect accountant PCs directly to PostgreSQL.

- Keeps DB credentials off staff PCs
- Preserves permission checks and business rules
- Avoids breaking changes when DB schema changes
- Easier audit and future maintenance

## Quick Start (Windows)

1. Open this folder.
2. Double-click `run.bat`.
3. The tool will create `.venv`, install requirements, and start.

## Manual Start

```powershell
cd desktop_quote_tool
py -3 -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Login

- `Base URL`: `https://task.kuanlin.pro`
- Use existing TaskGo username/password (admin/hq_staff/site_supervisor)

## Create Quote Item Format

In the `Items` box, one line = one item:

```text
Description,Unit,Quantity,UnitPrice
```

Example:

```text
Pipeline work,job,1,15000
8P8C setup,job,1,5000
```

## Optional: Build EXE for accountant

```powershell
cd desktop_quote_tool
.\.venv\Scripts\activate
pip install pyinstaller
pyinstaller --onefile --windowed app.py
```

Generated file: `desktop_quote_tool\dist\app.exe`
