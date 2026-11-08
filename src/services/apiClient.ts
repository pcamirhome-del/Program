// src/services/apiClient.ts
// تحديد الرابط تلقائياً: localhost في التطوير، ورابط Vercel النسبي في الإنتاج
export const API_BASE_URL =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api'
    : '/api';

export function getApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.replace(/^\/api\/?/, '').replace(/^\//, '');
  return `${API_BASE_URL}/${cleanEndpoint}`;
}

export default API_BASE_URL;
