// Este archivo es el entry point para Vercel serverless functions
// Importa el app de Express compilado
import app from '../src/index.js';

// Handler específico para Vercel que maneja OPTIONS antes de cualquier redirección
export default function handler(req: any, res: any) {
  // Manejar OPTIONS requests directamente aquí para evitar redirecciones
  // Esto debe hacerse ANTES de que Express procese la request
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin || req.headers.referer;
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://panel.aurorasdr.ai',
      'https://www.panel.aurorasdr.ai',
      process.env.FRONTEND_URL,
    ].filter(Boolean) as string[];
    
    const isAllowed = !origin || 
      allowedOrigins.includes(origin) ||
      (typeof origin === 'string' && (
        origin.includes('vercel.app') ||
        origin.includes('localhost') ||
        origin.includes('aurorasdr.ai')
      ));
    
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With, x-user-id, x-customer-id, x-user-email');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(200).end();
      return;
    }
    
    res.status(403).json({ error: 'CORS not allowed' });
    return;
  }
  
  // Para todos los demás métodos, usar el app de Express
  return app(req, res);
}
