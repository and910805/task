@echo off
setlocal
cd /d "%~dp0"

if not exist .venv (
  py -3 -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create virtual environment .venv
    pause
    exit /b 1
  )
)

call .venv\Scripts\activate
if errorlevel 1 (
  echo [ERROR] Failed to activate virtual environment
  pause
  exit /b 1
)

python -m pip install --upgrade pip
if errorlevel 1 (
  echo [WARN] pip upgrade failed. Continue anyway...
)

python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] Package installation failed. Check network or Python environment.
  pause
  exit /b 1
)

if exist qt_app.py (
  python qt_app.py
) else (
  python app.py
)

if errorlevel 1 (
  echo [ERROR] Application exited with error
  pause
  exit /b 1
)

endlocal
