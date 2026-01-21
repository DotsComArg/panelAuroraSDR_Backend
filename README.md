# Aurora SDR - Backend

Backend del panel de Aurora SDR construido con Express + TypeScript.

## Desarrollo

```bash
npm install
npm run dev
```

El servidor se ejecutará en `http://localhost:3001`

## Build

```bash
npm run build
npm start
```

## Variables de Entorno

Crear un archivo `.env` con:

```
PORT=3001
FRONTEND_URL=http://localhost:3000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
MONGODB_DB=AuroraSDR
DATABASE_URL=postgresql://user:pass@host:5432/db
```

## Scripts Disponibles

Los scripts de utilidad están en `scripts/`:
- `init-customers.ts` - Inicializar clientes en la base de datos
- `update-passwords.ts` - Actualizar contraseñas de usuarios
- `migrate-kommo-v2.ts` - Migrar caché de Kommo a v2
- etc.

Ejecutar con: `npx tsx scripts/nombre-script.ts`

## Deploy

Este backend puede deployarse en:
- Vercel (Serverless Functions)
- Railway
- Render
- Heroku
- Cualquier plataforma que soporte Node.js
