import os
from app import create_app

app = create_app()

if __name__ == "__main__":
    # 關鍵：從環境變數抓取 Zeabur 分配的 Port，預設 8080 是為了保險
    port = int(os.environ.get("PORT", 5000))
    
    # 資安提醒：部署到雲端時 debug 建議設為 False，避免外洩系統資訊
    app.run(host="0.0.0.0", port=port, debug=False)
