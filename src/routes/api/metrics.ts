import { Router, Request, Response } from 'express';
import { getKommoCredentialsForCustomer, createKommoClient } from '../../lib/api-kommo.js';
import { 
  getKommoLeadsFromDb, 
  syncKommoLeads,
  getLastSyncTime 
} from '../../lib/kommo-leads-storage.js';
import { getMongoDb } from '../../lib/mongodb.js';

const router = Router();

// Helper para obtener parámetro de query como string
const getQueryParam = (param: any): string | null => {
  if (!param) return null;
  if (Array.isArray(param)) return param[0] || null;
  if (typeof param === 'string') return param;
  return null;
};

/** Convierte dateFrom/dateTo a timestamp Unix en segundos. Acepta "YYYY-MM-DD" o número. */
function parseDateToTimestamp(val: string | null | undefined, endOfDay = false): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  // Si es solo dígitos, tratar como timestamp en segundos
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return undefined;
  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return Math.floor(d.getTime() / 1000);
}

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

    // Limpiar customerId
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO API] Obteniendo estadísticas para customerId: ${cleanCustomerId}, refresh: ${refresh}`);

    // Obtener credenciales del cliente
    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    // Si no se solicita refresh, intentar obtener estadísticas desde MongoDB primero (más rápido)
    // Si no hay datos, devolver estadísticas vacías en lugar de cargar desde API (evita demoras)
    if (!refresh) {
      const { getKommoLeadsFromDb } = await import('../../lib/kommo-leads-storage.js');
      const { leads: dbLeads, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, {});
      
      // Si hay datos en BD, calcular estadísticas desde ahí (más rápido)
      if (dbLeads.length > 0 && totalAll > 0) {
        const kommoClient = createKommoClient(credentials);
        const stats = await kommoClient.getFilteredLeadsStats(dbLeads);
        
        // Asegurar que el total incluya todos los leads (incluyendo eliminados si están en BD)
        // Si totalAll es mayor que el total calculado, usar totalAll
        if (totalAll > stats.totals.total) {
          stats.totals.total = totalAll;
        }
        
        return res.json({
          success: true,
          data: stats,
        });
      } else {
        // Si no hay datos en BD, devolver estadísticas vacías (NO cargar desde API automáticamente)
        // El usuario debe hacer clic en "Actualizar" para sincronizar
        return res.json({
          success: true,
          data: {
            totals: {
              total: 0,
              won: 0,
              lost: 0,
              active: 0,
            },
            pipelines: [],
            users: [],
            tags: [],
            conversionRate: 0,
            lossRate: 0,
          },
          needsSync: true, // Indicar que necesita sincronización
        });
      }
    }

    // SOLO si se solicita refresh explícitamente, obtener desde API
    const kommoClient = createKommoClient(credentials);
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
    const sync = getQueryParam(req.query.sync) === 'true'; // Nuevo parámetro para sincronizar a BD

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    // Limpiar customerId (eliminar espacios y caracteres extra)
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO API] Obteniendo leads para customerId: ${cleanCustomerId}, refresh: ${refresh}, sync: ${sync}`);
    console.log(`[KOMMO API] CustomerId length: ${cleanCustomerId.length}, type: ${typeof cleanCustomerId}`);

    // Si se solicita refresh, obtener desde API de Kommo
    let apiLeads: any[] = [];
    if (refresh) {
      console.log(`[KOMMO API] Obteniendo leads desde API de Kommo para customerId: ${cleanCustomerId}...`);
      
      const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
      if (!credentials) {
        return res.status(404).json({
          success: false,
          error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
        });
      }

      const kommoClient = createKommoClient(credentials);
      
      // Obtener todos los leads desde la API
      apiLeads = await kommoClient.getLeadsWithFilters({});
      
      console.log(`[KOMMO API] Leads obtenidos desde API: ${apiLeads.length}`);
      
      // Solo sincronizar a BD si se solicita explícitamente (sync=true)
      if (sync) {
        console.log(`[KOMMO API] Sincronizando leads a BD para customerId: ${cleanCustomerId}...`);
        await syncKommoLeads(cleanCustomerId, apiLeads, true);
        console.log(`[KOMMO API] Sincronización completada. Leads sincronizados: ${apiLeads.length}`);
      } else {
        console.log(`[KOMMO API] Leads obtenidos desde API pero NO sincronizados a BD (sync=false)`);
      }
    }

    // Si se obtuvo desde API (refresh=true), devolver esos leads directamente
    if (refresh && apiLeads.length > 0) {
      // Si no se especifica paginación o se solicita explícitamente todos, devolver todos los leads
      const page = parseInt(getQueryParam(req.query.page) || '1', 10);
      const limitParam = getQueryParam(req.query.limit);
      const limit = limitParam ? parseInt(limitParam, 10) : apiLeads.length; // Si no hay limit, devolver todos
      
      // Si el limit es mayor o igual al total, devolver todos
      const paginatedLeads = limit >= apiLeads.length 
        ? apiLeads 
        : apiLeads.slice((page - 1) * limit, page * limit);
      
      console.log(`[KOMMO API] Devolviendo ${paginatedLeads.length} de ${apiLeads.length} leads desde API`);
      
      return res.json({
        success: true,
        data: { 
          leads: paginatedLeads,
          total: apiLeads.length,
          page,
          limit,
          totalPages: Math.ceil(apiLeads.length / limit),
          lastSync: null,
          needsSync: false,
        },
      });
    }

    // Si no se solicitó refresh, obtener desde BD (más rápido)
    // Construir filtros desde query params
    const filters: any = {};

    // Filtros de fecha (aceptar "YYYY-MM-DD" o timestamp en segundos)
    const dateFromParam = getQueryParam(req.query.dateFrom);
    const dateToParam = getQueryParam(req.query.dateTo);
    const closedDateFromParam = getQueryParam(req.query.closedDateFrom);
    const closedDateToParam = getQueryParam(req.query.closedDateTo);
    const dateField = getQueryParam(req.query.dateField) as 'created_at' | 'closed_at' | undefined;

    if (dateFromParam) filters.dateFrom = parseDateToTimestamp(dateFromParam, false);
    if (dateToParam) filters.dateTo = parseDateToTimestamp(dateToParam, true);
    if (closedDateFromParam) filters.closedDateFrom = parseDateToTimestamp(closedDateFromParam, false);
    if (closedDateToParam) filters.closedDateTo = parseDateToTimestamp(closedDateToParam, true);
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
        const idsStr = String(tagIds).includes(',') ? String(tagIds).split(',') : [String(tagIds)];
        filters.tagIds = idsStr.map(id => parseInt(id.trim(), 10)).filter(n => !isNaN(n));
      }
    }

    // Paginación
    const page = parseInt(getQueryParam(req.query.page) || '1', 10);
    const limit = parseInt(getQueryParam(req.query.limit) || '50', 10);
    filters.skip = (page - 1) * limit;
    filters.limit = limit;

    // Obtener leads desde BD (MUCHO más rápido)
    const { leads, total, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, filters);
    
    console.log(`[KOMMO API] Leads encontrados: ${leads.length}, total: ${total}, totalAll: ${totalAll}`);

    // Si hay filtros activos, calcular y devolver estadísticas filtradas desde BD
    const hasFilters = !!(filters.dateFrom || filters.dateTo || filters.closedDateFrom || filters.closedDateTo ||
      filters.responsibleUserId || filters.pipelineId || filters.statusId || (filters.tagIds && filters.tagIds.length > 0));
    let stats: any = undefined;
    if (hasFilters) {
      try {
        const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
        if (credentials) {
          const statsFilters = { ...filters, skip: 0, limit: 50000 };
          const { leads: allFilteredLeads } = await getKommoLeadsFromDb(cleanCustomerId, statsFilters);
          const kommoClient = createKommoClient(credentials);
          stats = await kommoClient.getFilteredLeadsStats(allFilteredLeads);
          console.log(`[KOMMO API] Stats filtradas calculadas: total=${stats?.totals?.total}, won=${stats?.totals?.won}, lost=${stats?.totals?.lost}`);
        }
      } catch (statsErr: any) {
        console.warn('[KOMMO API] No se pudieron calcular stats filtradas:', statsErr?.message || statsErr);
      }
    }

    // Obtener última sincronización
    const lastSync = await getLastSyncTime(cleanCustomerId);

    // Si no hay datos y no se solicitó refresh, indicar que necesita sincronización
    const needsSync = total === 0 && !refresh && !lastSync;

    const data: any = { 
      leads,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      lastSync: lastSync?.toISOString() || null,
      needsSync,
    };
    if (stats) data.stats = stats;

    return res.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener leads:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener leads de Kommo',
    });
  }
});

// Endpoint para sincronización inicial completa - trae TODOS los leads con TODOS sus campos
router.post('/kommo/leads/full-sync', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId || req.body?.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    // Limpiar customerId
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO FULL SYNC] ==========================================`);
    console.log(`[KOMMO FULL SYNC] Iniciando sincronización completa inicial`);
    console.log(`[KOMMO FULL SYNC] CustomerId: ${cleanCustomerId}`);
    console.log(`[KOMMO FULL SYNC] Timestamp: ${new Date().toISOString()}`);
    console.log(`[KOMMO FULL SYNC] ==========================================`);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
    if (!credentials) {
      console.error(`[KOMMO FULL SYNC] ❌ No se encontraron credenciales para customerId: ${cleanCustomerId}`);
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    console.log(`[KOMMO FULL SYNC] ✅ Credenciales obtenidas correctamente`);
    console.log(`[KOMMO FULL SYNC] BaseUrl: ${credentials.baseUrl}`);
    console.log(`[KOMMO FULL SYNC] HasAccessToken: ${!!credentials.accessToken}`);

    // Limpiar documentos con id/leadId null ANTES de empezar (importante para evitar errores de índice único)
    // También eliminar el índice antiguo si existe
    console.log(`[KOMMO FULL SYNC] Limpiando índices antiguos y documentos con id/leadId null en la BD...`);
    try {
      const { getMongoDb } = await import('../../lib/mongodb.js');
      const db = await getMongoDb();
      const collection = db.collection('kommo_leads');
      
      // Eliminar índices antiguos que puedan causar problemas
      const indexesToDrop = ['customerId_1_leadId_1', 'customerId_1_id_1'];
      for (const indexName of indexesToDrop) {
        try {
          await collection.dropIndex(indexName);
          console.log(`[KOMMO FULL SYNC] ✅ Índice antiguo eliminado: ${indexName}`);
        } catch (error: any) {
          if (!error.message?.includes('index not found')) {
            console.warn(`[KOMMO FULL SYNC] ⚠️  Error al eliminar índice ${indexName}:`, error.message);
          }
        }
      }
      
      // Limpiar documentos con id/leadId null PERO solo si AMBOS son null
      // NO eliminar si solo uno es null, porque puede ser un lead válido con el otro campo presente
      const cleanupResult = await collection.deleteMany({
        customerId: cleanCustomerId,
        $and: [
          {
            $or: [
              { id: { $eq: null as any } },
              { id: { $exists: false } },
              { id: { $type: 'null' } },
            ],
          },
          {
            $or: [
              { leadId: { $eq: null as any } },
              { leadId: { $exists: false } },
              { leadId: { $type: 'null' } },
            ],
          },
        ],
      } as any);
      if (cleanupResult.deletedCount > 0) {
        console.log(`[KOMMO FULL SYNC] ✅ ${cleanupResult.deletedCount} documentos con id/leadId null eliminados`);
      }
    } catch (cleanupError: any) {
      console.warn(`[KOMMO FULL SYNC] ⚠️  Error al limpiar documentos con id/leadId null:`, cleanupError.message);
      // Continuar de todas formas
    }

    // IMPORTANTE: En Vercel, las funciones serverless se detienen después de responder
    // Por lo tanto, debemos procesar TODO antes de responder, pero de forma optimizada
    // Usaremos el endpoint /kommo/leads/sync?forceFullSync=true para procesamiento en background
    // Este endpoint está diseñado específicamente para eso
    try {
      const kommoClient = createKommoClient(credentials);
      
      console.log(`[KOMMO FULL SYNC] Cliente de Kommo creado`);
      console.log(`[KOMMO FULL SYNC] Obteniendo todos los leads con todos sus campos (etiquetas, contactos, empresas, etc.)...`);
      console.log(`[KOMMO FULL SYNC] ⏳ Esto puede tardar varios minutos para grandes volúmenes de datos...`);
      
      // Obtener todos los leads con todos los campos relacionados
      // El método getLeadsWithFilters ya incluye with=contacts,companies
      const apiLeads = await kommoClient.getLeadsWithFilters({});
      
      console.log(`[KOMMO FULL SYNC] ✅ Leads obtenidos desde API: ${apiLeads.length}`);
      console.log(`[KOMMO FULL SYNC] Iniciando guardado en MongoDB en lotes de 50...`);
      console.log(`[KOMMO FULL SYNC] CustomerId que se usará: "${cleanCustomerId}" (length: ${cleanCustomerId.length})`);
      
      // Verificar que tenemos leads antes de sincronizar
      if (apiLeads.length === 0) {
        console.warn(`[KOMMO FULL SYNC] ⚠️  No se obtuvieron leads desde la API`);
        return res.json({
          success: true,
          message: 'No se encontraron leads en Kommo para sincronizar',
          totalProcessed: 0,
        });
      }

      // Sincronizar con forceFullSync=true para asegurar que todos los campos se guarden
      // PROCESAR TODO ANTES DE RESPONDER para evitar que Vercel detenga el proceso
      console.log(`[KOMMO FULL SYNC] Llamando a syncKommoLeads con forceFullSync=true...`);
      console.log(`[KOMMO FULL SYNC] Procesando ${apiLeads.length} leads en lotes de 50 (aprox. ${Math.ceil(apiLeads.length / 50)} lotes)...`);
      console.log(`[KOMMO FULL SYNC] ⚠️  NOTA: Este proceso puede tardar varios minutos. El frontend puede mostrar timeout, pero el backend continuará procesando.`);
      
      const startTime = Date.now();
      const result = await syncKommoLeads(cleanCustomerId, apiLeads, true);
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log(`[KOMMO FULL SYNC] ✅ Sincronización completada exitosamente en ${totalTime}s:`, {
        totalProcessed: result.totalProcessed,
        newLeads: result.newLeads,
        updatedLeads: result.updatedLeads,
        deletedLeads: result.deletedLeads,
        errors: result.errors,
        duration: `${result.duration}s`,
      });
      
      // Verificar que los leads se guardaron correctamente
      const { getKommoLeadsFromDb } = await import('../../lib/kommo-leads-storage.js');
      const { total, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, { limit: 1 });
      console.log(`[KOMMO FULL SYNC] Verificación en BD:`);
      console.log(`[KOMMO FULL SYNC]   - Total activos: ${total}`);
      console.log(`[KOMMO FULL SYNC]   - Total todos: ${totalAll}`);
      console.log(`[KOMMO FULL SYNC] ==========================================`);

      // Responder SOLO después de que todo se haya procesado
      return res.json({
        success: true,
        message: `Sincronización completa finalizada exitosamente. ${result.totalProcessed} leads procesados en ${totalTime}s`,
        data: {
          totalProcessed: result.totalProcessed,
          newLeads: result.newLeads,
          updatedLeads: result.updatedLeads,
          deletedLeads: result.deletedLeads,
          errors: result.errors,
          duration: result.duration,
          totalInDb: total,
          totalAllInDb: totalAll,
        },
      });
    } catch (syncError: any) {
      console.error(`[KOMMO FULL SYNC] ❌ Error durante la sincronización:`, syncError);
      console.error(`[KOMMO FULL SYNC] Error message: ${syncError.message}`);
      console.error(`[KOMMO FULL SYNC] Stack trace:`, syncError.stack);
      console.log(`[KOMMO FULL SYNC] ==========================================`);
      
      return res.status(500).json({
        success: false,
        error: syncError.message || 'Error durante la sincronización',
        details: process.env.NODE_ENV === 'development' ? syncError.stack : undefined,
      });
    }

  } catch (error: any) {
    console.error('[KOMMO FULL SYNC] ❌ Error al iniciar sincronización completa:', error);
    console.error('[KOMMO FULL SYNC] Stack trace:', error.stack);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al iniciar sincronización completa',
    });
  }
});

// Endpoint para sincronizar leads en background (sincronización incremental)
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

    // Limpiar customerId
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO API] Iniciando sincronización de leads para customerId: ${cleanCustomerId}`);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    // Iniciar la obtención de leads ANTES de responder para asegurar que el proceso se ejecute
    // En Vercel/serverless, necesitamos que el proceso async se inicie antes de enviar la respuesta
    console.log(`[KOMMO API] Iniciando proceso de sincronización para customerId: ${cleanCustomerId}`);
    
    const kommoClient = createKommoClient(credentials);
    
    // Iniciar la obtención de leads (esto puede tardar, pero al menos se inicia el proceso)
    const leadsPromise = kommoClient.getLeadsWithFilters({});
    
    // Responder inmediatamente después de iniciar el proceso
    res.json({
      success: true,
      message: 'Sincronización iniciada. Los leads se están guardando en la base de datos.',
    });
    
    // Continuar con la sincronización en background
    (async () => {
      try {
        console.log(`[KOMMO API] Esperando leads desde API de Kommo...`);
        const apiLeads = await leadsPromise;
        
        console.log(`[KOMMO API] Leads obtenidos desde API: ${apiLeads.length}. Iniciando guardado en MongoDB...`);
        
        const result = await syncKommoLeads(cleanCustomerId, apiLeads, forceFullSync);
        
        console.log(`[KOMMO API] ✅ Sincronización completada exitosamente para customerId ${cleanCustomerId}:`, {
          totalProcessed: result.totalProcessed,
          newLeads: result.newLeads,
          updatedLeads: result.updatedLeads,
          deletedLeads: result.deletedLeads,
          errors: result.errors,
          duration: `${result.duration}s`,
        });
        
        // Verificar que los leads se guardaron correctamente
        const { getKommoLeadsFromDb } = await import('../../lib/kommo-leads-storage.js');
        const { total } = await getKommoLeadsFromDb(cleanCustomerId, { limit: 1 });
        console.log(`[KOMMO API] Verificación: ${total} leads encontrados en BD para customerId ${cleanCustomerId}`);
      } catch (error: any) {
        console.error(`[KOMMO API] ❌ Error en sincronización para customerId ${cleanCustomerId}:`, error);
        console.error('[KOMMO API] Stack trace:', error.stack);
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

// Endpoint para webhook de Kommo - recibe actualizaciones de leads
// Kommo envía webhooks cuando hay cambios en leads, contactos, etc.
// Documentación: https://www.kommo.com/developers/content/webhooks/
router.post('/kommo/webhook', async (req: Request, res: Response) => {
  const webhookLogId = new Date().toISOString() + '_' + Math.random().toString(36).substr(2, 9);
  const startTime = Date.now();
  let customerId: string | null = null;
  let accountId: string | null | undefined = null;
  let success = false;
  let errorMessage: string | null = null;
  let processedLeads = 0;
  let deletedLeads = 0;
  
  try {
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ==========================================`);
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Recibida petición de webhook`);
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Method: ${req.method}`);
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] URL: ${req.url}`);
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Headers keys:`, Object.keys(req.headers));
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Content-Type:`, req.headers['content-type']);
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Body type:`, typeof req.body);
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Body is array:`, Array.isArray(req.body));
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Body keys:`, req.body && typeof req.body === 'object' ? Object.keys(req.body) : 'N/A');
    
    // Log del body completo (limitado para no saturar logs)
    try {
      const bodyStr = JSON.stringify(req.body, null, 2);
      if (bodyStr.length > 10000) {
        console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Body (primeros 10000 chars):`, bodyStr.substring(0, 10000));
      } else {
        console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Body completo:`, bodyStr);
      }
    } catch (e) {
      console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Body (no serializable):`, String(req.body).substring(0, 1000));
    }
    
    // Kommo envía los datos en el body
    const webhookData = req.body;
    
    // Kommo puede enviar diferentes tipos de webhooks
    // Estructura típica: { account: { id: ... }, leads: { add: [...], update: [...], delete: [...] } }
    if (!webhookData) {
      console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] Body vacío o inválido`);
      // Guardar log del error antes de responder
      const duration = Date.now() - startTime;
      try {
        await saveWebhookLog({
          logId: webhookLogId,
          customerId: 'unknown',
          accountId: null,
          success: false,
          processedLeads: 0,
          deletedLeads: 0,
          duration,
          headers: req.headers,
          body: null,
          error: 'Body vacío o inválido',
          timestamp: new Date(),
        });
      } catch (logError) {
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al guardar log:`, logError);
      }
      return res.status(400).json({
        success: false,
        error: 'Body vacío o inválido',
      });
    }

    // Extraer accountId del webhook
    // Kommo puede enviarlo en diferentes lugares según el tipo de webhook
    accountId = webhookData.account?.id || 
                webhookData.account_id || 
                webhookData.accountId ||
                (req.headers['x-account-id'] as string) ||
                null;

    if (!accountId) {
      console.warn('[KOMMO WEBHOOK] No se encontró accountId en el webhook');
      // Intentar extraer de la URL base si está disponible
      console.log('[KOMMO WEBHOOK] Intentando buscar customerId por otros métodos...');
    }

    // Buscar el customerId por accountId de Kommo o por URL base
    const db = await getMongoDb();
    const { ObjectId } = await import('mongodb');
    const customers = await db.collection('customers').find({}).toArray();
    
    // Si tenemos accountId, buscar por él (método principal y más seguro)
    if (accountId) {
      console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Buscando cliente por accountId: ${accountId}`);
      for (const customer of customers) {
        if (customer.kommoCredentials) {
          const baseUrl = customer.kommoCredentials.baseUrl || '';
          // La URL de Kommo es típicamente: https://{accountId}.kommo.com
          // También puede ser: https://{accountId}.kommo.com/ o con subdominios
          const urlMatch = baseUrl.match(/https?:\/\/([^.]+)\.kommo\.com/i);
          if (urlMatch) {
            const urlAccountId = urlMatch[1];
            // Comparar accountId (puede ser string o number)
            if (urlAccountId === accountId.toString() || urlAccountId === String(accountId)) {
              customerId = customer._id.toString();
              console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ Cliente identificado: ${customerId} (${customer.nombre || customer.email || 'Sin nombre'}) por accountId: ${accountId}`);
              break;
            }
          }
        }
      }
      
      if (!customerId) {
        console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ No se encontró cliente con accountId: ${accountId}`);
      }
    } else {
      console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ No se recibió accountId en el webhook`);
    }
    
    // Si no encontramos por accountId, intentar identificar por otros métodos
    // IMPORTANTE: Solo usar fallback si hay UN SOLO cliente con credenciales de Kommo
    // Si hay múltiples, rechazar el webhook para evitar actualizar la cuenta incorrecta
    if (!customerId) {
      const customersWithKommo = customers.filter(c => c.kommoCredentials);
      
      if (customersWithKommo.length === 0) {
        console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ No hay clientes con credenciales de Kommo configuradas`);
      } else if (customersWithKommo.length === 1) {
        // Solo si hay UN cliente, usar fallback (útil para desarrollo/testing con una sola cuenta)
        customerId = customersWithKommo[0]._id.toString();
        console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ Usando fallback: cliente único encontrado: ${customerId} (${customersWithKommo[0].nombre || customersWithKommo[0].email || 'Sin nombre'})`);
        console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ NOTA: Este webhook no tenía accountId. Se recomienda configurar webhooks con accountId para múltiples cuentas.`);
      } else {
        // Si hay múltiples clientes y no tenemos accountId, rechazar el webhook
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] ❌ ERROR: Hay ${customersWithKommo.length} clientes con credenciales de Kommo, pero el webhook no incluye accountId. No se puede determinar qué cuenta actualizar.`);
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Clientes encontrados:`, customersWithKommo.map(c => ({
          id: c._id.toString(),
          nombre: c.nombre || c.email || 'Sin nombre',
          baseUrl: c.kommoCredentials?.baseUrl || 'Sin URL'
        })));
        
        // Guardar log del error antes de responder
        const duration = Date.now() - startTime;
        try {
          await saveWebhookLog({
            logId: webhookLogId,
            customerId: 'unknown',
            accountId: null,
            success: false,
            processedLeads: 0,
            deletedLeads: 0,
            duration,
            headers: req.headers,
            body: webhookData,
            error: `No se puede identificar la cuenta: hay ${customersWithKommo.length} clientes con Kommo pero el webhook no incluye accountId`,
            timestamp: new Date(),
          });
        } catch (logError) {
          console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al guardar log:`, logError);
        }
        
        // Responder 200 para que Kommo no reintente, pero loguear el error
        return res.status(200).json({
          success: false,
          message: `No se puede identificar la cuenta: hay ${customersWithKommo.length} clientes con Kommo pero el webhook no incluye accountId. Verifica la configuración del webhook en Kommo.`,
        });
      }
    }

    if (!customerId) {
      console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ No se encontró cliente con credenciales de Kommo`);
      // Guardar log del error antes de responder
      const duration = Date.now() - startTime;
      try {
        await saveWebhookLog({
          logId: webhookLogId,
          customerId: 'unknown',
          accountId: accountId || null,
          success: false,
          processedLeads: 0,
          deletedLeads: 0,
          duration,
          headers: req.headers,
          body: webhookData,
          error: 'Cliente no encontrado para este webhook',
          timestamp: new Date(),
        });
      } catch (logError) {
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al guardar log:`, logError);
      }
      
      // Responder 200 para que Kommo no reintente, pero loguear el error
      return res.status(200).json({
        success: false,
        message: 'Cliente no encontrado para este webhook',
      });
    }

    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Procesando webhook para customerId: ${customerId}`);
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Webhook data structure:`, JSON.stringify({
      hasLeads: !!webhookData.leads,
      leadsType: Array.isArray(webhookData.leads) ? 'array' : typeof webhookData.leads,
      leadsKeys: webhookData.leads && typeof webhookData.leads === 'object' ? Object.keys(webhookData.leads) : [],
    }));

    // Procesar los eventos del webhook
    // Kommo envía eventos en diferentes formatos según el tipo
    const leadsEvents = webhookData.leads || {};
    const leadsToAdd = leadsEvents.add || [];
    const leadsToUpdate = leadsEvents.update || [];
    const leadsToDelete = leadsEvents.delete || [];
    
    // También puede venir directamente como array
    const allLeadsEvents = Array.isArray(webhookData.leads) ? webhookData.leads : [];
    
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Eventos detectados:`, {
      leadsToAdd: leadsToAdd.length,
      leadsToUpdate: leadsToUpdate.length,
      leadsToDelete: leadsToDelete.length,
      allLeadsEvents: allLeadsEvents.length,
    });
    
    // Combinar todos los eventos de leads
    const allLeadIds = new Set<number>();
    
    [...leadsToAdd, ...leadsToUpdate, ...allLeadsEvents].forEach((lead: any) => {
      const leadId = lead.id || lead.lead_id || lead;
      if (leadId && typeof leadId === 'number') {
        allLeadIds.add(leadId);
      } else if (leadId && typeof leadId === 'string') {
        // Intentar convertir string a number
        const parsedId = parseInt(leadId, 10);
        if (!isNaN(parsedId)) {
          allLeadIds.add(parsedId);
        }
      }
    });
    
    // Procesar leads eliminados (pueden venir como números o objetos)
    leadsToDelete.forEach((leadIdOrObj: any) => {
      const leadId = typeof leadIdOrObj === 'number' ? leadIdOrObj : (leadIdOrObj?.id || leadIdOrObj?.lead_id || leadIdOrObj);
      if (leadId && typeof leadId === 'number') {
        allLeadIds.add(leadId);
      } else if (leadId && typeof leadId === 'string') {
        const parsedId = parseInt(leadId, 10);
        if (!isNaN(parsedId)) {
          allLeadIds.add(parsedId);
        }
      }
    });
    
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Total lead IDs únicos a procesar: ${allLeadIds.size}`, Array.from(allLeadIds));

    if (allLeadIds.size === 0) {
      console.log(`[KOMMO WEBHOOK] [${webhookLogId}] No hay eventos de leads para procesar`);
      // Guardar log incluso cuando no hay eventos (para monitoreo)
      const duration = Date.now() - startTime;
      try {
        await saveWebhookLog({
          logId: webhookLogId,
          customerId: customerId,
          accountId: accountId,
          success: true,
          processedLeads: 0,
          deletedLeads: 0,
          duration,
          headers: req.headers,
          body: webhookData,
          response: {
            success: true,
            message: 'Webhook recibido pero no hay eventos de leads para procesar',
          },
          timestamp: new Date(),
        });
      } catch (logError) {
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al guardar log:`, logError);
      }
      return res.status(200).json({
        success: true,
        message: 'Webhook recibido pero no hay eventos de leads para procesar',
      });
    }

    console.log(`[KOMMO WEBHOOK] Procesando ${allLeadIds.size} leads: ${Array.from(allLeadIds).join(', ')}`);

    // Obtener credenciales del cliente
    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      console.error(`[KOMMO WEBHOOK] [${webhookLogId}] No se encontraron credenciales para customerId: ${customerId}`);
      // Guardar log del error antes de responder
      const duration = Date.now() - startTime;
      try {
        await saveWebhookLog({
          logId: webhookLogId,
          customerId: customerId,
          accountId: accountId,
          success: false,
          processedLeads: 0,
          deletedLeads: 0,
          duration,
          headers: req.headers,
          body: webhookData,
          error: 'Credenciales no encontradas',
          timestamp: new Date(),
        });
      } catch (logError) {
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al guardar log:`, logError);
      }
      return res.status(200).json({
        success: false,
        message: 'Credenciales no encontradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    
    // Procesar cada lead
    let leadsToSync: any[] = [];
    let leadsDeleted = 0;
    let leadsError = 0;
    
    // Convertir leadsToDelete a Set para búsqueda rápida
    const deletedLeadIdsSet = new Set<number>();
    leadsToDelete.forEach((leadIdOrObj: any) => {
      const leadId = typeof leadIdOrObj === 'number' ? leadIdOrObj : (leadIdOrObj?.id || leadIdOrObj?.lead_id || leadIdOrObj);
      if (leadId && typeof leadId === 'number') {
        deletedLeadIdsSet.add(leadId);
      } else if (leadId && typeof leadId === 'string') {
        const parsedId = parseInt(leadId, 10);
        if (!isNaN(parsedId)) {
          deletedLeadIdsSet.add(parsedId);
        }
      }
    });
    
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Procesando ${allLeadIds.size} leads (${deletedLeadIdsSet.size} para eliminar, ${allLeadIds.size - deletedLeadIdsSet.size} para actualizar/crear)`);
    
    for (const leadId of allLeadIds) {
      try {
        // Si es un lead eliminado, marcarlo como eliminado en BD
        if (deletedLeadIdsSet.has(leadId)) {
          const db = await getMongoDb();
          const deleteResult = await db.collection('kommo_leads').updateOne(
            { customerId: customerId.trim(), id: leadId },
            { $set: { is_deleted: true, syncedAt: new Date(), lastModifiedAt: new Date() } }
          );
          console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Lead ${leadId} marcado como eliminado (matched: ${deleteResult.matchedCount}, modified: ${deleteResult.modifiedCount})`);
          leadsDeleted++;
          continue;
        }

        // Obtener el lead completo desde la API de Kommo
        console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Obteniendo lead ${leadId} desde API de Kommo...`);
        const leadResponse: any = await kommoClient.authenticatedRequest(
          `/leads/${leadId}?with=contacts,companies`
        );
        
        if (leadResponse && leadResponse._embedded && leadResponse._embedded.leads) {
          const lead = leadResponse._embedded.leads[0];
          if (lead) {
            console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ Lead ${leadId} obtenido: "${lead.name || 'Sin nombre'}"`);
            leadsToSync.push(lead);
          } else {
            console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️  Lead ${leadId} obtenido pero array vacío`);
            leadsError++;
          }
        } else if (leadResponse && leadResponse.id) {
          // A veces Kommo devuelve el lead directamente
          console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ Lead ${leadId} obtenido directamente: "${leadResponse.name || 'Sin nombre'}"`);
          leadsToSync.push(leadResponse);
        } else {
          console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️  Lead ${leadId} no se pudo obtener correctamente. Respuesta:`, {
            hasResponse: !!leadResponse,
            hasEmbedded: !!(leadResponse?._embedded),
            hasLeads: !!(leadResponse?._embedded?.leads),
            leadsLength: leadResponse?._embedded?.leads?.length || 0,
            hasId: !!leadResponse?.id,
          });
          leadsError++;
        }
      } catch (error: any) {
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] ❌ Error al obtener lead ${leadId}:`, {
          message: error.message,
          status: error.status || error.statusCode,
          response: error.response?.data || error.response,
        });
        leadsError++;
        // Continuar con el siguiente lead
      }
    }
    
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Resumen de procesamiento:`, {
      totalLeads: allLeadIds.size,
      leadsObtenidos: leadsToSync.length,
      leadsEliminados: leadsDeleted,
      leadsError: leadsError,
    });

    // Si hay leads para actualizar, sincronizarlos
    if (leadsToSync.length > 0) {
      console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Sincronizando ${leadsToSync.length} leads a MongoDB...`);
      try {
        const syncResult = await syncKommoLeads(customerId, leadsToSync, false);
        console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ Sincronización completada:`, {
          totalProcessed: syncResult.totalProcessed,
          newLeads: syncResult.newLeads,
          updatedLeads: syncResult.updatedLeads,
          deletedLeads: syncResult.deletedLeads,
          errors: syncResult.errors,
          duration: syncResult.duration,
        });
        processedLeads = syncResult.totalProcessed || leadsToSync.length;
      } catch (syncError: any) {
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] ❌ Error al sincronizar leads:`, {
          message: syncError.message,
          stack: syncError.stack,
        });
        // Continuar para guardar el log del error
        processedLeads = 0;
        errorMessage = `Error al sincronizar leads: ${syncError.message}`;
        success = false;
      }
    } else {
      console.log(`[KOMMO WEBHOOK] [${webhookLogId}] No hay leads para sincronizar (todos fueron eliminados o hubo errores)`);
      processedLeads = 0;
    }
    
    deletedLeads = leadsDeleted;
    if (success === undefined || success === null) {
      success = true; // Solo establecer a true si no hubo error en sync
    }

    // Guardar log del webhook
    const duration = Date.now() - startTime;
    await saveWebhookLog({
      logId: webhookLogId,
      customerId: customerId!,
      accountId: accountId,
      success: true,
      processedLeads,
      deletedLeads,
      duration,
      headers: req.headers,
      body: webhookData,
      response: {
        success: true,
        message: `Webhook procesado: ${processedLeads} leads actualizados, ${deletedLeads} eliminados`,
        processed: processedLeads,
        deleted: deletedLeads,
      },
      timestamp: new Date(),
    });

    // Responder rápidamente a Kommo (200 OK)
    // Kommo espera una respuesta rápida, por eso procesamos en background si es necesario
    res.status(200).json({
      success: true,
      message: `Webhook procesado: ${processedLeads} leads actualizados, ${deletedLeads} eliminados`,
      processed: processedLeads,
      deleted: deletedLeads,
    });

  } catch (error: any) {
    console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al procesar webhook:`, error);
    console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Stack:`, error.stack);
    
    errorMessage = error.message || 'Error al procesar webhook';
    success = false;

    // Guardar log del error
    const duration = Date.now() - startTime;
    try {
      await saveWebhookLog({
        logId: webhookLogId,
        customerId: customerId || 'unknown',
        accountId: accountId || undefined,
        success: false,
        processedLeads: 0,
        deletedLeads: 0,
        duration,
        headers: req.headers,
        body: req.body,
        error: errorMessage || undefined,
        stack: error.stack,
        timestamp: new Date(),
      });
    } catch (logError) {
      console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al guardar log:`, logError);
    }

    // Responder 200 para que Kommo no reintente en caso de errores temporales
    // pero loguear el error para debugging
    return res.status(200).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Función helper para guardar logs de webhooks
async function saveWebhookLog(logData: {
  logId: string;
  customerId: string;
  accountId: string | null | undefined;
  success: boolean;
  processedLeads: number;
  deletedLeads: number;
  duration: number;
  headers: any;
  body: any;
  response?: any;
  error?: string | null;
  stack?: string;
  timestamp: Date;
}) {
  try {
    const db = await getMongoDb();
    const logsCollection = db.collection('kommo_webhook_logs');
    
    // Limitar el tamaño del body y headers para no exceder límites de MongoDB
    let limitedBody: string;
    let limitedHeaders: string;
    
    try {
      limitedBody = logData.body ? JSON.stringify(logData.body).substring(0, 50000) : '{}'; // Máximo 50KB
    } catch (e) {
      limitedBody = String(logData.body || '{}').substring(0, 50000);
    }
    
    try {
      limitedHeaders = logData.headers ? JSON.stringify(logData.headers).substring(0, 10000) : '{}'; // Máximo 10KB
    } catch (e) {
      limitedHeaders = String(logData.headers || '{}').substring(0, 10000);
    }
    
    const logDocument = {
      logId: logData.logId,
      customerId: logData.customerId,
      accountId: logData.accountId || null,
      success: logData.success,
      processedLeads: logData.processedLeads,
      deletedLeads: logData.deletedLeads,
      duration: logData.duration,
      headers: limitedHeaders,
      body: limitedBody,
      response: logData.response || null,
      error: logData.error || null,
      stack: logData.stack || null,
      timestamp: logData.timestamp,
      createdAt: logData.timestamp,
    };
    
    const result = await logsCollection.insertOne(logDocument);
    console.log(`[KOMMO WEBHOOK] [${logData.logId}] ✅ Log guardado en BD: ${result.insertedId}, customerId: ${logData.customerId}, success: ${logData.success}, processed: ${logData.processedLeads}, deleted: ${logData.deletedLeads}`);
    
    // Limpiar logs antiguos (mantener solo los últimos 1000) - hacerlo de forma asíncrona para no bloquear
    setImmediate(async () => {
      try {
        const totalLogs = await logsCollection.countDocuments();
        if (totalLogs > 1000) {
          const logsToDelete = totalLogs - 1000;
          const oldestLogs = await logsCollection
            .find({})
            .sort({ createdAt: 1 })
            .limit(logsToDelete)
            .toArray();
          
          if (oldestLogs.length > 0) {
            const idsToDelete = oldestLogs.map(log => log._id);
            await logsCollection.deleteMany({ _id: { $in: idsToDelete } });
            console.log(`[KOMMO WEBHOOK] Limpiados ${logsToDelete} logs antiguos (total antes: ${totalLogs})`);
          }
        }
      } catch (cleanupError) {
        console.error('[KOMMO WEBHOOK] Error al limpiar logs antiguos:', cleanupError);
      }
    });
  } catch (error: any) {
    console.error(`[KOMMO WEBHOOK] [${logData.logId}] ❌ Error al guardar log en BD:`, error);
    console.error(`[KOMMO WEBHOOK] [${logData.logId}] Error details:`, {
      message: error.message,
      stack: error.stack,
      customerId: logData.customerId,
      accountId: logData.accountId,
    });
    // No lanzar el error para no interrumpir el flujo del webhook
  }
}

// Endpoint para obtener logs de webhooks
router.get('/kommo/webhook/logs', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    const limit = parseInt(getQueryParam(req.query.limit) || '50', 10);
    const skip = parseInt(getQueryParam(req.query.skip) || '0', 10);
    
    const db = await getMongoDb();
    const logsCollection = db.collection('kommo_webhook_logs');
    
    // Construir query
    const query: any = {};
    if (customerId) {
      query.customerId = customerId.trim();
    }
    
    // Obtener logs ordenados por fecha descendente (más recientes primero)
    const logs = await logsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();
    
    // Contar total
    const total = await logsCollection.countDocuments(query);
    
    // Obtener información de clientes para enriquecer los logs
    const customers = await db.collection('customers').find({}).toArray();
    const customersMap = new Map(customers.map(c => [c._id.toString(), c]));
    
    // Enriquecer logs con información del cliente
    const enrichedLogs = logs.map((log: any) => {
      const customer = customersMap.get(log.customerId);
      return {
        ...log,
        customerName: customer ? `${customer.nombre || ''} ${customer.apellido || ''}`.trim() : 'Cliente desconocido',
        customerEmail: customer?.email || null,
      };
    });
    
    return res.json({
      success: true,
      data: enrichedLogs,
      total,
      limit,
      skip,
    });
  } catch (error: any) {
    console.error('[KOMMO WEBHOOK] Error al obtener logs:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener logs de webhooks',
    });
  }
});

// Endpoint para verificar customerIds de leads y clientes
router.get('/kommo/leads/check-customer-ids', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    
    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    const cleanCustomerId = customerId.trim();
    const db = await getMongoDb();
    const { ObjectId } = await import('mongodb');

    // Verificar si el cliente existe
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(cleanCustomerId)
    });

    // Obtener todos los customerIds únicos de los leads
    const kommoLeadsCollection = db.collection('kommo_leads');
    const distinctCustomerIds = await kommoLeadsCollection.distinct('customerId');
    
    // Contar leads por customerId
    const leadsByCustomerId: any = {};
    for (const cid of distinctCustomerIds) {
      const count = await kommoLeadsCollection.countDocuments({ customerId: cid });
      leadsByCustomerId[cid] = count;
    }

    // Verificar si hay leads con el customerId del usuario
    const leadsForCurrentCustomer = await kommoLeadsCollection.countDocuments({ 
      customerId: cleanCustomerId 
    });

    return res.json({
      success: true,
      data: {
        currentCustomerId: cleanCustomerId,
        customerExists: !!customer,
        customerName: customer?.nombre || customer?.email || 'No encontrado',
        leadsForCurrentCustomer,
        allCustomerIdsInLeads: distinctCustomerIds,
        leadsByCustomerId,
      },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al verificar customerIds:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al verificar customerIds',
    });
  }
});

// Endpoint para restaurar leads marcados como eliminados
// Útil cuando se marcaron incorrectamente como eliminados durante una sincronización incompleta
router.post('/kommo/leads/restore-deleted', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.body?.customerId || req.query.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    const cleanCustomerId = customerId.trim();

    console.log(`[KOMMO API] Restaurando leads marcados como eliminados para customerId: ${cleanCustomerId}`);

    const db = await getMongoDb();
    const collection = db.collection('kommo_leads');

    // Contar leads marcados como eliminados
    const deletedCount = await collection.countDocuments({ 
      customerId: cleanCustomerId, 
      is_deleted: true 
    });
    
    console.log(`[KOMMO API] Leads marcados como eliminados encontrados: ${deletedCount}`);

    if (deletedCount === 0) {
      return res.json({
        success: true,
        message: 'No se encontraron leads marcados como eliminados',
        restored: 0,
      });
    }

    // Restaurar todos los leads marcados como eliminados
    const result = await collection.updateMany(
      { 
        customerId: cleanCustomerId, 
        is_deleted: true 
      },
      { 
        $set: { 
          is_deleted: false,
          syncedAt: new Date(),
        } 
      }
    );

    console.log(`[KOMMO API] Restauración completada: ${result.modifiedCount} leads restaurados`);

    return res.json({
      success: true,
      message: `Restauración completada: ${result.modifiedCount} leads restaurados`,
      restored: result.modifiedCount,
      totalDeleted: deletedCount,
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al restaurar leads:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al restaurar leads marcados como eliminados',
    });
  }
});

// Endpoint para migrar/actualizar customerId de leads existentes
// Útil cuando los leads fueron sincronizados con un customerId incorrecto
router.post('/kommo/leads/migrate-customer-id', async (req: Request, res: Response) => {
  try {
    const oldCustomerId = getQueryParam(req.body?.oldCustomerId || req.query.oldCustomerId);
    const newCustomerId = getQueryParam(req.body?.newCustomerId || req.query.newCustomerId);

    if (!oldCustomerId || !newCustomerId) {
      return res.status(400).json({
        success: false,
        error: 'oldCustomerId y newCustomerId son requeridos',
      });
    }

    const cleanOldCustomerId = oldCustomerId.trim();
    const cleanNewCustomerId = newCustomerId.trim();

    console.log(`[KOMMO API] Migrando leads de customerId "${cleanOldCustomerId}" a "${cleanNewCustomerId}"`);

    const db = await getMongoDb();
    const collection = db.collection('kommo_leads');

    // Contar leads con el customerId antiguo
    const countOld = await collection.countDocuments({ customerId: cleanOldCustomerId });
    console.log(`[KOMMO API] Leads encontrados con customerId antiguo: ${countOld}`);

    if (countOld === 0) {
      return res.json({
        success: true,
        message: 'No se encontraron leads con el customerId antiguo',
        migrated: 0,
      });
    }

    // Actualizar todos los leads
    const result = await collection.updateMany(
      { customerId: cleanOldCustomerId },
      { $set: { customerId: cleanNewCustomerId } }
    );

    console.log(`[KOMMO API] Migración completada: ${result.modifiedCount} leads actualizados`);

    return res.json({
      success: true,
      message: `Migración completada: ${result.modifiedCount} leads actualizados`,
      migrated: result.modifiedCount,
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al migrar customerId:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al migrar customerId de leads',
    });
  }
});

export default router;
