import { Router, Request, Response } from 'express';

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

    // Por ahora devolvemos datos mock/dummy
    // TODO: Implementar lógica real para obtener métricas de PostgreSQL
    return res.json({
      success: true,
      data: {
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

    // Por ahora devolvemos datos mock/dummy
    // TODO: Implementar lógica real para obtener métricas de ubicaciones
    return res.json({
      success: true,
      data: {
        total: 0,
        locations: [],
        dataSource: 'kommo',
      },
    });
  } catch (error) {
    console.error('Error al obtener métricas de ubicaciones:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener métricas de ubicaciones',
    });
  }
});

export default router;
