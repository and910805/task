import { useNavigate } from 'react-router-dom';
import api from './api'; // 假設這是您封裝好的 axios 實例

const LogoutButton = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      // 1. (選擇性) 呼叫後端登出 API，確認連線狀態
      await api.post('/api/auth/logout');
    } catch (error) {
      console.error('後端登出回應異常', error);
    } finally {
      // 2. 務必清除本地儲存的 Token
      localStorage.removeItem('token'); 
      localStorage.removeItem('role');

      // 3. 導向登入頁面
      navigate('/login');
      alert('您已成功登出');
    }
  };

  return <button onClick={handleLogout}>登出</button>;
};