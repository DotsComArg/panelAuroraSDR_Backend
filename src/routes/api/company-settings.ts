/**
 * Configuración de la empresa (nuestras muestras): Meta CAPI, etc.
 * Solo SuperAdmin. Storage en MongoDB collection company_settings.
 */

import { Router, Request, Response } from 'express';
import { getMongoDb } from '../../lib/mongodb.js';
import { encrypt, decrypt } from '../../lib/encryption-utils.js';

const router = Router();
const COLLECTION = 'company_settings';
const META_CAPI_ID = 'meta_capi';

// Middleware para verificar que el usuario es SuperAdmin
const requireSuperAdmin = async (req: Request, res: Response, next: Function) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'No autorizado' });
    }
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
};

router.use(requireSuperAdmin);

interface MetaCapiDoc {
  _id: string;
  pixelId: string;
  accessToken: string; // encrypted
  adAccountId?: string;
  updatedAt: Date;
}

// GET /api/admin/company-settings/meta-capi — config enmascarada (para UI)
router.get('/meta-capi', async (req: Request, res: Response) => {
  try {
    const db = await getMongoDb();
    const doc = await db.collection<MetaCapiDoc>(COLLECTION).findOne({
      _id: META_CAPI_ID,
    });

    if (!doc) {
      return res.json({
        success: true,
        data: {
          configured: false,
          pixelId: '',
          hasAccessToken: false,
          adAccountId: '',
        },
      });
    }

    return res.json({
      success: true,
      data: {
        configured: true,
        pixelId: doc.pixelId,
        hasAccessToken: !!doc.accessToken,
        adAccountId: doc.adAccountId || '',
      },
    });
  } catch (error) {
    console.error('Error al obtener company Meta CAPI:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener configuración Meta CAPI de la empresa',
    });
  }
});

// PUT /api/admin/company-settings/meta-capi — guardar/actualizar
router.put('/meta-capi', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      pixelId?: string;
      accessToken?: string;
      adAccountId?: string;
    };

    const pixelId = typeof body.pixelId === 'string' ? body.pixelId.trim() : '';
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
    const adAccountId = typeof body.adAccountId === 'string' ? body.adAccountId.trim() : undefined;

    if (!pixelId || !accessToken) {
      return res.status(400).json({
        success: false,
        error: 'Pixel ID y Access Token son requeridos',
      });
    }

    const db = await getMongoDb();
    const update: Record<string, unknown> = {
      pixelId,
      accessToken: encrypt(accessToken),
      updatedAt: new Date(),
    };
    if (adAccountId) update.adAccountId = adAccountId;

    await db.collection<{ _id: string }>(COLLECTION).updateOne(
      { _id: META_CAPI_ID as any },
      { $set: update },
      { upsert: true }
    );

    return res.json({
      success: true,
      data: {
        configured: true,
        pixelId,
        hasAccessToken: true,
        adAccountId: adAccountId || '',
      },
    });
  } catch (error) {
    console.error('Error al guardar company Meta CAPI:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al guardar configuración Meta CAPI de la empresa',
    });
  }
});

// GET /api/admin/company-settings/meta-capi/credentials — desencriptado (uso interno)
export async function getCompanyMetaCapiCredentials(): Promise<{
  pixelId: string;
  accessToken: string;
  adAccountId?: string;
} | null> {
  try {
    const db = await getMongoDb();
    const doc = await db.collection<MetaCapiDoc>(COLLECTION).findOne({
      _id: META_CAPI_ID,
    });
    if (!doc?.accessToken) return null;
    return {
      pixelId: doc.pixelId,
      accessToken: decrypt(doc.accessToken),
      adAccountId: doc.adAccountId,
    };
  } catch (e) {
    console.error('getCompanyMetaCapiCredentials:', e);
    return null;
  }
}

export default router;
