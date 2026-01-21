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
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

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
        // En producción, permitir dominios de Vercel
        if (origin.includes('vercel.app') || origin.includes('localhost')) {
          callback(null, true);
        } else {
          callback(null, true); // Temporalmente permitir todos para debug
          // callback(new Error('No permitido por CORS'));
        }
      }
    }
  },
  credentials: true, // CRÍTICO: Permite que las cookies se envíen
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With'],
  exposedHeaders: ['Set-Cookie'], // Exponer headers de cookies
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
