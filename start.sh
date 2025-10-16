#!/bin/bash
# =========================
# 立翔水電行專案一鍵啟動腳本
# =========================

echo "🚀 啟動 Flask 後端 ..."
cd ~/taskgo/backend
source venv/bin/activate
nohup python3 app.py > backend.log 2>&1 &
BACK_PID=$!
echo "✅ Flask 已啟動 (PID: $BACK_PID)"

echo "🌐 啟動 React 前端 ..."
cd ~/taskgo/frontend
nohup npm run dev -- --host 0.0.0.0 > frontend.log 2>&1 &
FRONT_PID=$!
echo "✅ React 已啟動 (PID: $FRONT_PID)"

echo "🎯 所有服務已啟動完成！"

