import { Router, Request, Response } from 'express';
import { getKommoCredentialsForCustomer, createKommoClient } from '../../lib/api-kommo.js';
import { 
  getKommoLeadsFromDb, 
  syncKommoLeads,
  getLastSyncTime 
} from '../../lib/kommo-leads-storage.js';

const router = Router();

// Helper para obtener parámetro de query como string
const getQueryParam = (param: any): string | null => {
  if (!param) return null;
  if (Array.isArray(param)) return param[0] || null;
  if (typeof param === 'string') return param;
  return null;
};

// Obtener métricas generales del dashboard
router.get('/', async (req: Request, res: Response) => {
  try {
    const daysParam = getQueryParam(req.query.days);
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    // Por ahora devolvemos datos mock/dummy con la estructura correcta
    // TODO: Implementar lógica real para obtener métricas de PostgreSQL
    return res.json({
      success: true,
      totalLeads: 0,
      activeLeads: 0,
      closedLeads: 0,
      conversionRate: 0,
      averageResponseTime: 0,
      totalActivities: 0,
      activitiesByType: {},
      leadsByStatus: {},
      trends: [],
      period: days,
      generales: {
        respuestasAutomaticasCorrectas: 0,
        porcentajeRespuestasCorrectas: 0,
      },
    });
  } catch (error) {
    console.error('Error al obtener métricas:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener métricas',
    });
  }
});

// Obtener métricas de ubicaciones
router.get('/locations', async (req: Request, res: Response) => {
  try {
    const daysParam = getQueryParam(req.query.days);
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    // Por ahora devolvemos datos mock/dummy con la estructura correcta
    // TODO: Implementar lógica real para obtener métricas de ubicaciones
    return res.json({
      success: true,
      total: 0,
      locations: [], // Array vacío pero presente para evitar errores
      dataSource: 'kommo',
    });
  } catch (error) {
    console.error('Error al obtener métricas de ubicaciones:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener métricas de ubicaciones',
    });
  }
});

// ==================== RUTAS DE KOMMO ====================

// Obtener estadísticas generales de Kommo
router.get('/kommo', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    const refresh = getQueryParam(req.query.refresh) === 'true';

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Obteniendo estadísticas para customerId: ${customerId}, refresh: ${refresh}`);

    // Obtener credenciales del cliente
    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    // Crear cliente de Kommo
    const kommoClient = createKommoClient(credentials);

    // Obtener estadísticas
    const stats = await kommoClient.getLeadsStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener estadísticas:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener estadísticas de Kommo',
    });
  }
});

// Obtener usuarios de Kommo
router.get('/kommo/users', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Obteniendo usuarios para customerId: ${customerId}`);

    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    const users = await kommoClient.getUsers();

    return res.json({
      success: true,
      data: { users },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener usuarios:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener usuarios de Kommo',
    });
  }
});

// Obtener pipelines de Kommo
router.get('/kommo/pipelines', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Obteniendo pipelines para customerId: ${customerId}`);

    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    const pipelines = await kommoClient.getPipelines();

    return res.json({
      success: true,
      data: { pipelines },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener pipelines:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener pipelines de Kommo',
    });
  }
});

// Obtener etiquetas de Kommo
router.get('/kommo/tags', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Obteniendo etiquetas para customerId: ${customerId}`);

    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    const tags = await kommoClient.getTags();

    return res.json({
      success: true,
      data: { tags },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener etiquetas:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener etiquetas de Kommo',
    });
  }
});

// Obtener leads de Kommo (desde BD, mucho más rápido)
router.get('/kommo/leads', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    const refresh = getQueryParam(req.query.refresh) === 'true';

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Obteniendo leads para customerId: ${customerId}, refresh: ${refresh}`);

    // Usar funciones de almacenamiento importadas

    // Si se solicita refresh, sincronizar primero
    if (refresh) {
      console.log(`[KOMMO API] Sincronizando leads desde API para customerId: ${customerId}...`);
      
      const credentials = await getKommoCredentialsForCustomer(customerId);
      if (!credentials) {
        return res.status(404).json({
          success: false,
          error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
        });
      }

      const kommoClient = createKommoClient(credentials);
      
      // Obtener todos los leads desde la API (esto puede tardar, pero solo cuando se solicita refresh)
      const apiLeads = await kommoClient.getLeadsWithFilters({});
      
      // Sincronizar a BD
      await syncKommoLeads(customerId, apiLeads, true);
      
      console.log(`[KOMMO API] Sincronización completada. Leads sincronizados: ${apiLeads.length}`);
    }

    // Construir filtros desde query params
    const filters: any = {};

    // Filtros de fecha
    const dateFrom = getQueryParam(req.query.dateFrom);
    const dateTo = getQueryParam(req.query.dateTo);
    const closedDateFrom = getQueryParam(req.query.closedDateFrom);
    const closedDateTo = getQueryParam(req.query.closedDateTo);
    const dateField = getQueryParam(req.query.dateField) as 'created_at' | 'closed_at' | undefined;

    if (dateFrom) filters.dateFrom = parseInt(dateFrom, 10);
    if (dateTo) filters.dateTo = parseInt(dateTo, 10);
    if (closedDateFrom) filters.closedDateFrom = parseInt(closedDateFrom, 10);
    if (closedDateTo) filters.closedDateTo = parseInt(closedDateTo, 10);
    if (dateField) filters.dateField = dateField;

    // Filtros de usuario, pipeline, status
    const responsibleUserId = getQueryParam(req.query.responsibleUserId);
    const pipelineId = getQueryParam(req.query.pipelineId);
    const statusId = getQueryParam(req.query.statusId);

    if (responsibleUserId) filters.responsibleUserId = parseInt(responsibleUserId, 10);
    if (pipelineId) filters.pipelineId = parseInt(pipelineId, 10);
    if (statusId) filters.statusId = parseInt(statusId, 10);

    // Filtros de etiquetas (puede ser múltiple)
    const tagIds = req.query.tagIds;
    if (tagIds) {
      if (Array.isArray(tagIds)) {
        filters.tagIds = tagIds.map(id => parseInt(String(id), 10));
      } else {
        filters.tagIds = [parseInt(String(tagIds), 10)];
      }
    }

    // Paginación
    const page = parseInt(getQueryParam(req.query.page) || '1', 10);
    const limit = parseInt(getQueryParam(req.query.limit) || '50', 10);
    filters.skip = (page - 1) * limit;
    filters.limit = limit;

    // Obtener leads desde BD (MUCHO más rápido)
    const { leads, total } = await getKommoLeadsFromDb(customerId, filters);

    // Obtener última sincronización
    const lastSync = await getLastSyncTime(customerId);

    return res.json({
      success: true,
      data: { 
        leads,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        lastSync: lastSync?.toISOString() || null,
      },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener leads:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener leads de Kommo',
    });
  }
});

// Endpoint para sincronizar leads en background
router.post('/kommo/leads/sync', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId || req.body?.customerId);
    const forceFullSync = getQueryParam(req.query.forceFullSync || req.body?.forceFullSync) === 'true';

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Iniciando sincronización de leads para customerId: ${customerId}`);

    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    // Responder inmediatamente y sincronizar en background
    res.json({
      success: true,
      message: 'Sincronización iniciada en background',
    });

    // Sincronizar en background (no bloquear la respuesta)
    (async () => {
      try {
        const kommoClient = createKommoClient(credentials);
        const apiLeads = await kommoClient.getLeadsWithFilters({});
        
        const result = await syncKommoLeads(customerId, apiLeads, forceFullSync);
        
        console.log(`[KOMMO API] Sincronización completada:`, result);
      } catch (error: any) {
        console.error('[KOMMO API] Error en sincronización background:', error);
      }
    })();

  } catch (error: any) {
    console.error('[KOMMO API] Error al iniciar sincronización:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al iniciar sincronización',
    });
  }
});

export default router;
