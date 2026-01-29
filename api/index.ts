// Este archivo es el entry point para Vercel serverless functions
// Importa el app de Express compilado
import app from '../src/index.js';

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'https://panel.aurorasdr.ai',
  'https://www.panel.aurorasdr.ai',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin || typeof origin !== 'string') return false;
  const o = origin.trim();
  if (!o) return false;
  if (ALLOWED_ORIGINS.includes(o)) return true;
  if (o.includes('vercel.app') || o.includes('localhost') || o.includes('127.0.0.1') || o.includes('aurorasdr.ai')) return true;
  return false;
}

/** Extrae origen (scheme+host+port) de Referer si se usa como fallback. Allow-Origin no puede llevar path. */
function originFromReferer(referer: string | undefined): string | null {
  if (!referer || typeof referer !== 'string') return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function setCorsHeaders(res: any, origin: string) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With, x-user-id, x-customer-id, x-user-email');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function getOrigin(req: any): string | null {
  const h = req?.headers || {};
  const o = h.origin ?? h.Origin ?? originFromReferer(h.referer ?? h.Referer);
  if (!o || typeof o !== 'string') return null;
  const t = o.trim();
  return t || null;
}

// Handler específico para Vercel que maneja OPTIONS antes de pasar a Express.
// El preflight OPTIONS debe devolver Access-Control-Allow-Origin con el origen exacto (scheme+host+port, sin path).
// Si tenés Deployment Protection: Vercel Dashboard → Project → Settings → Deployment Protection → OPTIONS Allowlist → añadí /api.
export default function handler(req: any, res: any) {
  try {
    const origin = getOrigin(req);

    if (req.method === 'OPTIONS') {
      if (origin && isOriginAllowed(origin)) {
        setCorsHeaders(res, origin);
        res.status(204).end();
        return;
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With, x-user-id, x-customer-id, x-user-email');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }

    return app(req, res);
  } catch (e) {
    console.error('[api/index] Handler error:', e);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With, x-user-id, x-customer-id, x-user-email');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(500).end();
  }
}
