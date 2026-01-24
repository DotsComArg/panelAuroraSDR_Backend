import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/api/auth.js';
import customersRoutes from './routes/api/customers.js';
import usersRoutes from './routes/api/users.js';
import customersCredentialsRoutes from './routes/api/customers-credentials.js';
import customersUsersRoutes from './routes/api/customers-users.js';
import metricsRoutes from './routes/api/metrics.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configurado para permitir múltiples orígenes
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://panel.aurorasdr.ai',
  'https://www.panel.aurorasdr.ai',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

// Manejar preflight OPTIONS requests antes de CORS para evitar redirecciones
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  
  // Verificar si el origen está permitido
  const isAllowed = !origin || 
    allowedOrigins.includes(origin) ||
    origin.includes('vercel.app') ||
    origin.includes('localhost') ||
    origin.includes('aurorasdr.ai');
  
  if (isAllowed) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With, x-user-id, x-customer-id, x-user-email');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400'); // 24 horas
    return res.status(200).end();
  }
  
  return res.status(403).json({ error: 'CORS not allowed' });
});

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origen (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Si el origen está en la lista permitida
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // En desarrollo, permitir localhost con cualquier puerto
      if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
        callback(null, true);
      } else {
        // En producción, permitir dominios de Vercel y aurorasdr.ai
        if (origin.includes('vercel.app') || 
            origin.includes('localhost') || 
            origin.includes('aurorasdr.ai')) {
          callback(null, true);
        } else {
          callback(new Error('No permitido por CORS'));
        }
      }
    }
  },
  credentials: true, // CRÍTICO: Permite que las cookies se envíen
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Cookie', 
    'X-Requested-With',
    'x-user-id',        // Header personalizado para autenticación
    'x-customer-id',    // Header personalizado para autenticación
    'x-user-email',     // Header personalizado para autenticación
  ],
  exposedHeaders: ['Set-Cookie'], // Exponer headers de cookies
  preflightContinue: false, // No continuar con otros middlewares después del preflight
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ruta raíz
app.get('/', (req, res) => {
  res.json({ 
    message: 'Aurora SDR Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/metrics', metricsRoutes);
// Rutas anidadas de customers deben ir antes de la ruta general
app.use('/api/customers/:customerId/credentials', customersCredentialsRoutes);
app.use('/api/customers/:customerId/users', customersUsersRoutes);
app.use('/api/customers', customersRoutes);

// 404 handler para rutas API
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.path });
});

// 404 handler general
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// Solo iniciar el servidor si no estamos en Vercel
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  });
}

// Exportar para Vercel
export default app;
