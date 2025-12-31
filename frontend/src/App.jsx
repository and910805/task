import { useState, useEffect } from 'react'
import api from './api'
import './App.css'

function App() {
  const [message, setMessage] = useState('載入中...')

  useEffect(() => {
    api.get('/api/health')
      .then(res => {
        const { status } = res.data
        setMessage(status === 'ok' ? '後端連線正常' : '健康檢查回應異常')
      })
      .catch(err => {
        console.error('連線失敗：', err)
        setMessage('連不到後端 QQ')
      })
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
