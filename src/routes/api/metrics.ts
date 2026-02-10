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

// Helper para accountIndex (0-based); default 0
const getAccountIndex = (param: any): number => {
  const s = getQueryParam(param);
  if (s === null || s === '') return 0;
  const n = parseInt(s, 10);
  return isNaN(n) || n < 0 ? 0 : n;
};

/** Convierte dateFrom/dateTo a timestamp Unix en segundos. Acepta "YYYY-MM-DD", "dd/mm/yyyy", "dd-mm-yyyy" o número. */
function parseDateToTimestamp(val: string | null | undefined, endOfDay = false): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  // Si es solo dígitos, tratar como timestamp en segundos
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let d = new Date(s);
  // Si falla el parseo (ej. "03/02/2026" en locale US = 2 de marzo), intentar dd/mm/yyyy o dd-mm-yyyy
  if (isNaN(d.getTime())) {
    const dmys = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmys) {
      const [, day, month, year] = dmys;
      // month es 1-based en Date
      d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
    }
  }
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

    const cleanCustomerId = customerId.trim();
    const accountIndex = getAccountIndex(req.query.accountIndex);
    console.log(`[KOMMO API] Obteniendo estadísticas para customerId: ${cleanCustomerId}, accountIndex: ${accountIndex}, refresh: ${refresh}`);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId, accountIndex);
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
      // Traer todos los leads de esta cuenta para estadísticas (sin límite para embudos completos)
      const { leads: dbLeads, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, {
        kommoAccountIndex: accountIndex,
      });
      
      // Si hay datos en BD, calcular estadísticas desde ahí (más rápido)
      if (dbLeads.length > 0 && totalAll > 0) {
        const kommoClient = createKommoClient(credentials);
        const stats = await kommoClient.getFilteredLeadsStats(dbLeads);
        // Totals: total = leads activos (no eliminados), won/lost/active según etapa (Cierre exitoso / Cierre perdido por type o nombre).
        // No mezclar con totalAll (incluye eliminados) para evitar métricas infladas.
        if (stats.totals && typeof stats.totals === 'object') {
          (stats as any).totalsIncludingDeleted = totalAll;
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
            totals: { total: 0, won: 0, lost: 0, active: 0 },
            distribution: [],
            lastUpdated: new Date().toISOString(),
          },
          needsSync: true,
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

    const accountIndex = getAccountIndex(req.query.accountIndex);
    console.log(`[KOMMO API] Obteniendo usuarios para customerId: ${customerId}, accountIndex: ${accountIndex}`);

    const credentials = await getKommoCredentialsForCustomer(customerId, accountIndex);
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

    const accountIndex = getAccountIndex(req.query.accountIndex);
    console.log(`[KOMMO API] Obteniendo pipelines para customerId: ${customerId}, accountIndex: ${accountIndex}`);

    const credentials = await getKommoCredentialsForCustomer(customerId, accountIndex);
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

    const accountIndex = getAccountIndex(req.query.accountIndex);
    console.log(`[KOMMO API] Obteniendo etiquetas para customerId: ${customerId}, accountIndex: ${accountIndex}`);

    const credentials = await getKommoCredentialsForCustomer(customerId, accountIndex);
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

    const cleanCustomerId = customerId.trim();
    const accountIndex = getAccountIndex(req.query.accountIndex);
    console.log(`[KOMMO API] Obteniendo leads para customerId: ${cleanCustomerId}, accountIndex: ${accountIndex}, refresh: ${refresh}, sync: ${sync}`);

    let apiLeads: any[] = [];
    let apiFilters: any = {};
    if (refresh) {
      console.log(`[KOMMO API] Obteniendo leads desde API de Kommo para customerId: ${cleanCustomerId}, accountIndex: ${accountIndex}...`);
      
      const credentials = await getKommoCredentialsForCustomer(cleanCustomerId, accountIndex);
      if (!credentials) {
        return res.status(404).json({
          success: false,
          error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
        });
      }

      const kommoClient = createKommoClient(credentials);
      // Construir filtros para la API desde query params (mismos que para BD)
      apiFilters = {};
      const dateFromParam = getQueryParam(req.query.dateFrom);
      const dateToParam = getQueryParam(req.query.dateTo);
      const closedDateFromParam = getQueryParam(req.query.closedDateFrom);
      const closedDateToParam = getQueryParam(req.query.closedDateTo);
      const dateFieldParam = getQueryParam(req.query.dateField) as 'created_at' | 'closed_at' | undefined;
      if (dateFromParam) apiFilters.dateFrom = parseDateToTimestamp(dateFromParam, false);
      if (dateToParam) apiFilters.dateTo = parseDateToTimestamp(dateToParam, true);
      if (closedDateFromParam) apiFilters.closedDateFrom = parseDateToTimestamp(closedDateFromParam, false);
      if (closedDateToParam) apiFilters.closedDateTo = parseDateToTimestamp(closedDateToParam, true);
      if (dateFieldParam) apiFilters.dateField = dateFieldParam;
      const responsibleUserId = getQueryParam(req.query.responsibleUserId);
      const pipelineId = getQueryParam(req.query.pipelineId);
      const statusId = getQueryParam(req.query.statusId);
      if (responsibleUserId) {
        const n = parseInt(responsibleUserId, 10);
        if (!isNaN(n)) apiFilters.responsibleUserId = n;
      }
      if (pipelineId) {
        const n = parseInt(pipelineId, 10);
        if (!isNaN(n)) apiFilters.pipelineId = n;
      }
      if (statusId) {
        const n = parseInt(statusId, 10);
        if (!isNaN(n)) apiFilters.statusId = n;
      }
      const tagIds = req.query.tagIds;
      if (tagIds) {
        if (Array.isArray(tagIds)) {
          apiFilters.tagIds = tagIds.map((id: any) => parseInt(String(id), 10)).filter((n: number) => !isNaN(n));
        } else {
          const idsStr = String(tagIds).includes(',') ? String(tagIds).split(',') : [String(tagIds)];
          apiFilters.tagIds = idsStr.map((id: string) => parseInt(id.trim(), 10)).filter((n: number) => !isNaN(n));
        }
      }

      apiLeads = await kommoClient.getLeadsWithFilters(apiFilters);
      console.log(`[KOMMO API] Leads obtenidos desde API: ${apiLeads.length}`);

      if (sync) {
        console.log(`[KOMMO API] Sincronizando leads a BD para customerId: ${cleanCustomerId}, accountIndex: ${accountIndex}...`);
        await syncKommoLeads(cleanCustomerId, apiLeads, true, accountIndex);
        console.log(`[KOMMO API] Sincronización completada. Leads sincronizados: ${apiLeads.length}`);
      } else {
        console.log(`[KOMMO API] Leads obtenidos desde API pero NO sincronizados a BD (sync=false)`);
      }
    }

    // Si se solicitó refresh, devolver respuesta desde API (aunque apiLeads esté vacío)
    if (refresh) {
      const page = parseInt(getQueryParam(req.query.page) || '1', 10);
      const limitParam = getQueryParam(req.query.limit);
      const limit = limitParam ? parseInt(limitParam, 10) : 50;
      const total = apiLeads.length;
      const paginatedLeads = total === 0 ? [] : apiLeads.slice((page - 1) * limit, page * limit);
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
      let payload: any = {
        leads: paginatedLeads,
        total,
        page,
        limit,
        totalPages,
        lastSync: null,
        needsSync: false,
      };
      const hasFilters = !!(apiFilters.dateFrom !== undefined || apiFilters.dateTo !== undefined || apiFilters.closedDateFrom !== undefined || apiFilters.closedDateTo !== undefined || apiFilters.responsibleUserId !== undefined || apiFilters.pipelineId !== undefined || apiFilters.statusId !== undefined || (apiFilters.tagIds && apiFilters.tagIds.length > 0));
      if (hasFilters && apiLeads.length > 0) {
        try {
          const creds = await getKommoCredentialsForCustomer(cleanCustomerId, accountIndex);
          if (creds) {
            const stats = await createKommoClient(creds).getFilteredLeadsStats(apiLeads);
            payload.stats = stats;
          }
        } catch (e) {
          // ignore
        }
      }
      console.log(`[KOMMO API] Devolviendo ${paginatedLeads.length} de ${total} leads desde API (página ${page})`);
      return res.json({ success: true, data: payload });
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

    // Filtros de usuario, pipeline, status (validar para evitar NaN que rompe la query)
    const responsibleUserId = getQueryParam(req.query.responsibleUserId);
    const pipelineId = getQueryParam(req.query.pipelineId);
    const statusId = getQueryParam(req.query.statusId);

    if (responsibleUserId) {
      const n = parseInt(responsibleUserId, 10);
      if (!isNaN(n)) filters.responsibleUserId = n;
    }
    if (pipelineId) {
      const n = parseInt(pipelineId, 10);
      if (!isNaN(n)) filters.pipelineId = n;
    }
    if (statusId) {
      const n = parseInt(statusId, 10);
      if (!isNaN(n)) filters.statusId = n;
    }

    // Filtros de etiquetas (puede ser múltiple); solo agregar IDs numéricos válidos
    const tagIds = req.query.tagIds;
    if (tagIds) {
      if (Array.isArray(tagIds)) {
        filters.tagIds = tagIds.map(id => parseInt(String(id), 10)).filter(n => !isNaN(n));
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
    filters.kommoAccountIndex = accountIndex;

    const { leads, total, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, filters);
    
    console.log(`[KOMMO API] Leads encontrados: ${leads.length}, total: ${total}, totalAll: ${totalAll}`);

    // Si hay filtros activos, calcular y devolver estadísticas filtradas
    // statsFromApi=true: obtener leads desde API Kommo (más lento pero coincide exactamente con Kommo)
    // statsFromApi=false/omitido: usar leads de MongoDB (más rápido; puede diferir si BD está desactualizada)
    const hasFilters = !!(filters.dateFrom || filters.dateTo || filters.closedDateFrom || filters.closedDateTo ||
      filters.responsibleUserId || filters.pipelineId || filters.statusId || (filters.tagIds && filters.tagIds.length > 0));
    const statsFromApi = getQueryParam(req.query.statsFromApi) === 'true';
    let stats: any = undefined;
    if (hasFilters) {
      try {
        const credentials = await getKommoCredentialsForCustomer(cleanCustomerId, accountIndex);
        if (credentials) {
          const kommoClient = createKommoClient(credentials);
          let allFilteredLeads: any[];

          if (statsFromApi) {
            // Fuente: API Kommo - garantiza coincidencia exacta con lo que muestra Kommo
            const apiFilters: any = {};
            if (filters.dateFrom) apiFilters.dateFrom = filters.dateFrom;
            if (filters.dateTo) apiFilters.dateTo = filters.dateTo;
            if (filters.closedDateFrom) apiFilters.closedDateFrom = filters.closedDateFrom;
            if (filters.closedDateTo) apiFilters.closedDateTo = filters.closedDateTo;
            if (filters.dateField) apiFilters.dateField = filters.dateField;
            if (filters.responsibleUserId) apiFilters.responsibleUserId = filters.responsibleUserId;
            if (filters.pipelineId) apiFilters.pipelineId = filters.pipelineId;
            if (filters.statusId) apiFilters.statusId = filters.statusId;
            if (filters.tagIds?.length) apiFilters.tagIds = filters.tagIds;
            allFilteredLeads = await kommoClient.getLeadsWithFilters(apiFilters);
            console.log(`[KOMMO API] Stats desde API Kommo: ${allFilteredLeads.length} leads`);
          } else {
            const statsFilters = { ...filters, skip: 0, limit: 50000 };
            const result = await getKommoLeadsFromDb(cleanCustomerId, statsFilters);
            allFilteredLeads = result.leads;
          }

          stats = await kommoClient.getFilteredLeadsStats(allFilteredLeads);
          console.log(`[KOMMO API] Stats filtradas: total=${stats?.totals?.total}, won=${stats?.totals?.won}, lost=${stats?.totals?.lost}, active=${stats?.totals?.active} (fromApi=${statsFromApi})`);
        }
      } catch (statsErr: any) {
        console.warn('[KOMMO API] No se pudieron calcular stats filtradas:', statsErr?.message || statsErr);
      }
    }

    const lastSync = await getLastSyncTime(cleanCustomerId, accountIndex);

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

// Endpoint de diagnóstico: trae UN lead completo desde la API de Kommo para ver la estructura (custom_fields_values, fuente, etiquetas, etc.)
router.get('/kommo/leads/sample', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    if (!customerId) {
      return res.status(400).json({ success: false, error: 'customerId es requerido' });
    }
    const cleanCustomerId = customerId.trim();
    const accountIndex = getAccountIndex(req.query.accountIndex);
    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId, accountIndex);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o sin credenciales Kommo',
      });
    }
    const kommoClient = createKommoClient(credentials);
    const listLeads = await kommoClient.getLeadsWithFilters({});
    if (!listLeads.length) {
      return res.json({
        success: true,
        message: 'No hay leads en esta cuenta',
        data: { lead: null, fromList: [], listCount: 0 },
      });
    }
    const firstId = listLeads[0].id;
    const fullLead = await kommoClient.getLeadById(firstId);
    return res.json({
      success: true,
      message: `Lead #${firstId} traído con GET /leads/:id (estructura completa para revisar custom_fields_values, _embedded.tags, etc.)`,
      data: {
        lead: fullLead ?? listLeads[0],
        listLead: listLeads[0],
        listCount: listLeads.length,
      },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error en /kommo/leads/sample:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al traer lead de muestra',
    });
  }
});

// Endpoint para sincronización por lotes - evita timeout en Vercel/serverless
// El frontend debe llamar en bucle con page=1, 2, 3... hasta que hasMore=false
router.post('/kommo/leads/sync-chunk', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId || req.body?.customerId);
    const pageParam = getQueryParam(req.query.page || req.body?.page) || '1';
    const page = Math.max(1, parseInt(pageParam, 10) || 1);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    const cleanCustomerId = customerId.trim();
    const accountIndex = getAccountIndex(req.query.accountIndex ?? req.body?.accountIndex);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId, accountIndex);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    const { leads, hasMore } = await kommoClient.getLeadsSinglePage(page, {});

    if (leads.length === 0 && page === 1) {
      return res.json({
        success: true,
        page,
        hasMore: false,
        totalInPage: 0,
        totalProcessed: 0,
        message: 'No hay leads en Kommo para sincronizar',
      });
    }

    const result = await syncKommoLeads(cleanCustomerId, leads, true, accountIndex);

    return res.json({
      success: true,
      page,
      hasMore,
      totalInPage: leads.length,
      totalProcessed: result.totalProcessed,
      newLeads: result.newLeads,
      updatedLeads: result.updatedLeads,
      errors: result.errors,
      message: hasMore
        ? `Página ${page} sincronizada. Llamar nuevamente con page=${page + 1}`
        : `Sincronización completada. ${result.totalProcessed} leads en esta página.`,
    });
  } catch (error: any) {
    console.error('[KOMMO SYNC-CHUNK] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al sincronizar lote',
    });
  }
});

// Endpoint para sincronización inicial completa - trae TODOS los leads con TODOS sus campos
// NOTA: En Vercel/serverless puede dar timeout con muchos leads. Usar /kommo/leads/sync-chunk en su lugar.
router.post('/kommo/leads/full-sync', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId || req.body?.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    const cleanCustomerId = customerId.trim();
    const accountIndex = getAccountIndex(req.query.accountIndex ?? req.body?.accountIndex);
    console.log(`[KOMMO FULL SYNC] ==========================================`);
    console.log(`[KOMMO FULL SYNC] Iniciando sincronización completa inicial`);
    console.log(`[KOMMO FULL SYNC] CustomerId: ${cleanCustomerId}, accountIndex: ${accountIndex}`);
    console.log(`[KOMMO FULL SYNC] Timestamp: ${new Date().toISOString()}`);
    console.log(`[KOMMO FULL SYNC] ==========================================`);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId, accountIndex);
    if (!credentials) {
      console.error(`[KOMMO FULL SYNC] ❌ No se encontraron credenciales para customerId: ${cleanCustomerId}, accountIndex: ${accountIndex}`);
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
      const enrichDetails = getQueryParam(req.query.enrichDetails || req.body?.enrichDetails) === 'true';
      if (enrichDetails) {
        console.log(`[KOMMO FULL SYNC] enrichDetails=true: se enriquecerá cada lead con GET /leads/:id (puede dar timeout en serverless >5min)`);
      } else {
        console.log(`[KOMMO FULL SYNC] Obteniendo listado de leads (with=contacts,companies,tags). Para datos completos por lead use ?enrichDetails=true (riesgo de timeout).`);
      }
      const apiLeads = enrichDetails
        ? await kommoClient.getLeadsWithFullDetails()
        : await kommoClient.getLeadsWithFilters({});
      
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
      const result = await syncKommoLeads(cleanCustomerId, apiLeads, true, accountIndex);
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
      const { total, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, { limit: 1, kommoAccountIndex: accountIndex });
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
    const accountIndex = getAccountIndex(req.query.accountIndex ?? req.body?.accountIndex);
    console.log(`[KOMMO API] Iniciando sincronización de leads para customerId: ${cleanCustomerId}, accountIndex: ${accountIndex}`);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId, accountIndex);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    console.log(`[KOMMO API] Iniciando proceso de sincronización para customerId: ${cleanCustomerId}, accountIndex: ${accountIndex}`);
    
    const kommoClient = createKommoClient(credentials);
    
    // Con forceFullSync: traer cada lead completo (GET /leads/:id) para tener todos los custom_fields_values (fuente, UTM, etc.)
    // Sin forceFullSync: solo listado (más rápido, menos datos por lead)
    const leadsPromise = forceFullSync
      ? kommoClient.getLeadsWithFullDetails()
      : kommoClient.getLeadsWithFilters({});
    
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
        
        const result = await syncKommoLeads(cleanCustomerId, apiLeads, forceFullSync, accountIndex);
        
        console.log(`[KOMMO API] ✅ Sincronización completada exitosamente para customerId ${cleanCustomerId}, accountIndex ${accountIndex}:`, {
          totalProcessed: result.totalProcessed,
          newLeads: result.newLeads,
          updatedLeads: result.updatedLeads,
          deletedLeads: result.deletedLeads,
          errors: result.errors,
          duration: `${result.duration}s`,
        });
        
        // Verificar que los leads se guardaron correctamente
        const { getKommoLeadsFromDb } = await import('../../lib/kommo-leads-storage.js');
        const { total } = await getKommoLeadsFromDb(cleanCustomerId, { limit: 1, kommoAccountIndex: accountIndex });
        console.log(`[KOMMO API] Verificación: ${total} leads en BD para customerId ${cleanCustomerId}, accountIndex ${accountIndex}`);
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

  // En Vercel/serverless el body a veces llega como string; normalizar a objeto
  if (typeof req.body === 'string' && req.body) {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      req.body = null;
    }
  }

  // Log único y visible para Vercel: POST recibido + resumen del body
  const leads = req.body?.leads;
  const addCount = Array.isArray(leads?.add) ? leads.add.length : (leads?.add ? 1 : 0);
  const updateCount = Array.isArray(leads?.update) ? leads.update.length : (leads?.update ? 1 : 0);
  const deleteCount = Array.isArray(leads?.delete) ? leads.delete.length : (leads?.delete ? 1 : 0);
  const accountIdFromBody = req.body?.account?.id ?? req.body?.account_id ?? req.body?.accountId ?? 'n/a';
  console.log(
    `[KOMMO WEBHOOK POST] id=${webhookLogId} accountId=${accountIdFromBody} leads_add=${addCount} leads_update=${updateCount} leads_delete=${deleteCount}`
  );

  let customerId: string | null = null;
  let accountIndex = 0; // 0 = primera cuenta (kommoCredentials), 1+ = kommoAccounts
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
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Body keys:`, req.body && typeof req.body === 'object' ? Object.keys(req.body) : 'N/A');

    // Kommo envía los datos en el body
    const webhookData = req.body;
    
    // Kommo puede enviar diferentes tipos de webhooks
    // Estructura típica: { account: { id: ... }, leads: { add: [...], update: [...], delete: [...] } }
    if (!webhookData) {
      console.log(`[KOMMO WEBHOOK POST] id=${webhookLogId} body vacío o inválido -> 400`);
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

    // Extraer accountId del webhook (Kommo puede enviar número o string)
    const rawAccountId = webhookData.account?.id ??
      webhookData.account_id ??
      webhookData.accountId ??
      (req.headers['x-account-id'] as string);
    accountId = rawAccountId != null && rawAccountId !== '' ? String(rawAccountId) : null;

    if (!accountId) {
      console.warn('[KOMMO WEBHOOK] No se encontró accountId en el webhook');
    }

    // Buscar el customerId por accountId de Kommo o por URL base
    const db = await getMongoDb();
    const { ObjectId } = await import('mongodb');
    const customers = await db.collection('customers').find({}).toArray();
    
    // Si tenemos accountId, buscar por él (método principal y más seguro)
    // Comprobar kommoCredentials (cuenta 0) y kommoAccounts (cuenta 1, 2, ...)
    // Helper: verifica si baseUrl corresponde al accountId (subdominio o URL que contenga el id)
    const baseUrlMatchesAccountId = (baseUrl: string | undefined, accId: string): boolean => {
      if (!baseUrl) return false;
      const subdomainMatch = baseUrl.match(/https?:\/\/([^./]+)/i);
      const subdomain = subdomainMatch ? subdomainMatch[1] : '';
      return subdomain === accId || baseUrl.includes(accId);
    };

    const storedAccountIdMatches = (stored: string | number | undefined, webhookAccId: string): boolean =>
      stored != null && stored !== '' && String(stored).trim() === webhookAccId;

    if (accountId) {
      console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Buscando cliente por accountId: ${accountId}`);
      const accountIdStr = accountId.toString();
      for (const customer of customers) {
        // 1) Match por accountId guardado (prioridad: así distinguimos cuentas con mismo cliente, ej. Quijada Kommo 1 y 2)
        if (storedAccountIdMatches((customer.kommoCredentials as any)?.accountId, accountIdStr)) {
          customerId = customer._id.toString();
          accountIndex = 0;
          console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ Cliente por accountId guardado: ${customerId} (${customer.nombre || customer.email || 'Sin nombre'}) cuenta Kommo 1`);
          break;
        }
        const kommoAccounts = (customer as any).kommoAccounts;
        if (kommoAccounts && Array.isArray(kommoAccounts)) {
          for (let i = 0; i < kommoAccounts.length; i++) {
            if (storedAccountIdMatches(kommoAccounts[i]?.accountId, accountIdStr)) {
              customerId = customer._id.toString();
              accountIndex = (customer.kommoCredentials?.baseUrl ? 1 : 0) + i;
              console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ Cliente por accountId guardado: ${customerId} (${customer.nombre || customer.email || 'Sin nombre'}) cuenta Kommo ${accountIndex + 1}`);
              break;
            }
          }
        }
        if (customerId) break;
        // 2) Fallback: match por baseUrl (subdominio o URL que contenga el id)
        if (customer.kommoCredentials?.baseUrl && baseUrlMatchesAccountId(customer.kommoCredentials.baseUrl, accountIdStr)) {
          customerId = customer._id.toString();
          accountIndex = 0;
          console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ Cliente por baseUrl: ${customerId} cuenta Kommo 1 (accountId: ${accountId})`);
          break;
        }
        if (kommoAccounts && Array.isArray(kommoAccounts)) {
          for (let i = 0; i < kommoAccounts.length; i++) {
            const baseUrl = kommoAccounts[i]?.baseUrl || '';
            if (baseUrlMatchesAccountId(baseUrl, accountIdStr)) {
              customerId = customer._id.toString();
              accountIndex = (customer.kommoCredentials?.baseUrl ? 1 : 0) + i;
              console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ Cliente por baseUrl: ${customerId} cuenta Kommo ${accountIndex + 1}`);
              break;
            }
          }
        }
        if (customerId) break;
      }
      if (!customerId) {
        console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ accountId=${accountId} sin coincidencia. Agregá "Account ID" en Admin → Clientes → Kommo para esta cuenta (ej. 35875379).`);
      }
    } else {
      console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ No se recibió accountId en el webhook`);
    }
    
    // Si no encontramos por accountId, intentar identificar por otros métodos
    // IMPORTANTE: Solo usar fallback si hay UN SOLO cliente con credenciales de Kommo
    // Si hay múltiples, rechazar el webhook para evitar actualizar la cuenta incorrecta
    // Incluir customers con kommoCredentials O kommoAccounts (ligar data por accountId)
    const hasKommo = (c: any) =>
      c.kommoCredentials?.accessToken ||
      (c.kommoAccounts && Array.isArray(c.kommoAccounts) && c.kommoAccounts.some((a: any) => a?.accessToken));
    if (!customerId) {
      const customersWithKommo = customers.filter(hasKommo);
      
      if (customersWithKommo.length === 0) {
        console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ No hay clientes con credenciales de Kommo configuradas`);
      } else if (customersWithKommo.length === 1) {
        // Solo si hay UN cliente, usar fallback (útil para desarrollo/testing con una sola cuenta)
        customerId = customersWithKommo[0]._id.toString();
        console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ Usando fallback: cliente único encontrado: ${customerId} (${customersWithKommo[0].nombre || customersWithKommo[0].email || 'Sin nombre'})`);
        console.warn(`[KOMMO WEBHOOK] [${webhookLogId}] ⚠️ NOTA: Este webhook no tenía accountId. Se recomienda configurar webhooks con accountId para múltiples cuentas.`);
      } else {
        const reason = accountId
          ? `accountId=${accountId} recibido pero ningún cliente tiene ese Account ID configurado. Agregá "Account ID (para webhooks)" en Admin → Clientes → Kommo para la cuenta correcta.`
          : `hay ${customersWithKommo.length} clientes con Kommo pero el webhook no incluye accountId.`;
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] ❌ ERROR: No se puede identificar la cuenta: ${reason}`);
        console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Clientes encontrados:`, customersWithKommo.map(c => ({
          id: c._id.toString(),
          nombre: c.nombre || c.email || 'Sin nombre',
          baseUrl: c.kommoCredentials?.baseUrl || 'Sin URL'
        })));
        
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
            error: `No se puede identificar la cuenta: ${reason}`,
            timestamp: new Date(),
          });
        } catch (logError) {
          console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al guardar log:`, logError);
        }
        
        const msg = accountId
          ? `accountId=${accountId} recibido pero ningún cliente tiene ese Account ID. Agregá "Account ID (para webhooks)" en Admin → Clientes → Kommo para la cuenta correcta.`
          : `Hay ${customersWithKommo.length} clientes con Kommo y el webhook no incluye accountId.`;
        return res.status(200).json({
          success: false,
          message: `No se puede identificar la cuenta: ${msg}`,
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
          accountIndex,
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

    // Obtener credenciales del cliente para la cuenta que envió el webhook
    const credentials = await getKommoCredentialsForCustomer(customerId, accountIndex);
    if (!credentials) {
      console.error(`[KOMMO WEBHOOK] [${webhookLogId}] No se encontraron credenciales para customerId: ${customerId}`);
      // Guardar log del error antes de responder
      const duration = Date.now() - startTime;
      try {
        await saveWebhookLog({
          logId: webhookLogId,
          customerId: customerId,
          accountId: accountId,
          accountIndex,
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
          const deleteFilter = accountIndex === 0
            ? { customerId: customerId.trim(), $or: [{ kommoAccountIndex: 0 }, { kommoAccountIndex: { $exists: false } }], id: leadId }
            : { customerId: customerId.trim(), kommoAccountIndex: accountIndex, id: leadId };
          const deleteResult = await db.collection('kommo_leads').updateOne(
            deleteFilter,
            { $set: { is_deleted: true, syncedAt: new Date(), lastModifiedAt: new Date() } }
          );
          console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Lead ${leadId} marcado como eliminado (matched: ${deleteResult.matchedCount}, modified: ${deleteResult.modifiedCount})`);
          leadsDeleted++;
          continue;
        }

        // Obtener el lead completo desde la API de Kommo (contacts, companies, tags = mismos campos que listado y sync)
        console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Obteniendo lead ${leadId} desde API de Kommo...`);
        const leadResponse: any = await kommoClient.authenticatedRequest(
          `/leads/${leadId}?with=contacts,companies,tags`
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
        const syncResult = await syncKommoLeads(customerId, leadsToSync, false, accountIndex);
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
      success = !errorMessage;
    }

    // Guardar log del webhook
    const duration = Date.now() - startTime;
    await saveWebhookLog({
      logId: webhookLogId,
      customerId: customerId!,
      accountId: accountId,
      accountIndex,
      success: !!success,
      processedLeads,
      deletedLeads,
      duration,
      headers: req.headers,
      body: webhookData,
      response: {
        success: !!success,
        message: errorMessage || `Webhook procesado: ${processedLeads} leads actualizados, ${deletedLeads} eliminados`,
        processed: processedLeads,
        deleted: deletedLeads,
      },
      timestamp: new Date(),
    });

    // Responder rápidamente a Kommo (200 OK)
    console.log(
      `[KOMMO WEBHOOK POST] id=${webhookLogId} OK customerId=${customerId} accountIndex=${accountIndex} processed=${processedLeads} deleted=${deletedLeads}`
    );
    res.status(200).json({
      success: true,
      message: `Webhook procesado: ${processedLeads} leads actualizados, ${deletedLeads} eliminados`,
      processed: processedLeads,
      deleted: deletedLeads,
    });

  } catch (error: any) {
    errorMessage = error.message || 'Error al procesar webhook';
    console.log(
      `[KOMMO WEBHOOK POST] id=${webhookLogId} ERROR ${errorMessage}`
    );
    console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al procesar webhook:`, error);
    console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Stack:`, error.stack);
    success = false;

    // Guardar log del error
    const duration = Date.now() - startTime;
    try {
      await saveWebhookLog({
        logId: webhookLogId,
        customerId: customerId || 'unknown',
        accountId: accountId || undefined,
        accountIndex,
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
  accountIndex?: number;
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
      accountIndex: logData.accountIndex ?? 0,
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
    
    // Enriquecer logs con información del cliente y etiqueta de cuenta
    const enrichedLogs = logs.map((log: any) => {
      const customer = customersMap.get(log.customerId);
      const accIdx = log.accountIndex ?? 0;
      return {
        ...log,
        customerName: customer ? `${customer.nombre || ''} ${customer.apellido || ''}`.trim() : 'Cliente desconocido',
        customerEmail: customer?.email || null,
        accountIndex: accIdx,
        accountLabel: `Kommo ${accIdx + 1}`,
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
