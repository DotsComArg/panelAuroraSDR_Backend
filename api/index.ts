// Este archivo es el entry point para Vercel serverless functions
// Importa el app de Express compilado
import app from '../src/index.js';

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://panel.aurorasdr.ai',
  'https://www.panel.aurorasdr.ai',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.includes('vercel.app') || origin.includes('localhost') || origin.includes('aurorasdr.ai')) return true;
  return false;
}

function setCorsHeaders(res: any, origin: string | undefined) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With, x-user-id, x-customer-id, x-user-email');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Handler específico para Vercel que maneja OPTIONS antes de cualquier redirección.
// El preflight OPTIONS no puede recibir redirect (301/302) o el navegador bloquea CORS.
export default function handler(req: any, res: any) {
  const origin = req.headers?.origin || req.headers?.referer;
  
  // Responder a OPTIONS (preflight) aquí, sin pasar por Express y sin redirect
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, isOriginAllowed(origin) ? (origin || '*') : undefined);
    res.status(204).end(); // 204 No Content es válido para preflight
    return;
  }
  
  // Para todos los demás métodos, usar el app de Express
  return app(req, res);
}
