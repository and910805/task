#!/bin/bash
# ============================================
#  TaskGo 專案自動更新腳本 (for EC2)
#  作者: ChatGPT x Eric
# ============================================

set -e  # 遇錯中斷
PROJECT_DIR="/home/ubuntu/taskgo"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"
BRANCH="codex/create-flask-react-sqlite-web-app"

echo "🔄 [1/5] 切換到專案目錄並更新 Git..."
cd $PROJECT_DIR
git fetch origin $BRANCH
git checkout $BRANCH
git pull origin $BRANCH

echo "🐍 [2/5] 更新 Flask 依賴..."
cd $BACKEND_DIR
if [ ! -d "$VENV_DIR" ]; then
  echo "建立新的虛擬環境..."
  python3 -m venv venv
fi
source $VENV_DIR/bin/activate
pip install --upgrade pip
pip install -r requirements.txt || pip install flask flask_sqlalchemy flask_jwt_extended gunicorn
deactivate

echo "⚙️ [3/5] 更新 React 依賴與 Build..."
cd $FRONTEND_DIR
npm install
npm run build

echo "🚀 [4/5] 重啟 systemd 服務..."
sudo systemctl restart taskgo.service

echo "✅ [5/5] 完成更新！"
sudo systemctl status taskgo.service --no-pager | head -n 5
