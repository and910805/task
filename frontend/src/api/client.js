import axios from 'axios';

axios.defaults.withCredentials = true;

const api = axios.create({
  baseURL: import.meta.env.PROD ? '/api' : 'http://localhost:5000/api',
  withCredentials: true,
});

export default api;
