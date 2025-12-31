import { useState, useEffect } from 'react' // 加上 useEffect
import axios from 'axios' // 引入 axios
import './App.css'

// 1. 這裡填入妳在 Zeabur 後端服務拿到的那個「生成網域」
const API_URL = 'https://task.zeabur.internal/api/hello' 

function App() {
  const [message, setMessage] = useState('載入中...')

  // 2. 當網頁開啟時，自動去叫 Flask 起床工作
  useEffect(() => {
    axios.get(API_URL)
      .then(res => {
        setMessage(res.data.message); // 假設 Flask 回傳 { "message": "Hi" }
      })
      .catch(err => {
        console.error('連線失敗：', err);
        setMessage('連不到後端 QQ');
      });
  }, []);

  return (
    <div className="App">
      <h1>全端測試</h1>
      <div className="card">
        <p>後端回傳的訊息：<strong>{message}</strong></p>
      </div>
    </div>
  )
}

export default App
