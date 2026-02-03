/**
 * API de tokens OpenAI: usage, stats, sync, track.
 * Consume getOpenAIUsage / getOpenAIUsageFromDB de api-openai.
 */

import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getMongoDb } from '../../lib/mongodb.js';
import {
  getOpenAICredentialsForCustomer,
  getOpenAIUsage,
  getOpenAIUsageFromDB,
} from '../../lib/api-openai.js';

const router = Router();

/** Valor por defecto cuando no se envía modelo en track (evita "unknown" en la UI) */
const DEFAULT_MODEL_LABEL = 'Sin especificar';

function getParam(name: string, req: Request): string | null {
  const v = req.query[name];
  if (v == null) return null;
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : null;
}

function parsePeriodDates(period: 'daily' | 'weekly' | 'monthly'): { start: Date; end: Date } {
  const end = new Date();
  let start: Date;
  switch (period) {
    case 'daily':
      start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      break;
    case 'weekly': {
      const d = new Date(end);
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      start = d;
      break;
    }
    case 'monthly':
    default: {
      start = new Date(end);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      break;
    }
  }
  return { start, end };
}

/** Formato esperado por TokensPage / AdminTokensPage */
function buildUsageResponse(
  period: string,
  startDate: string,
  endDate: string,
  totals: { tokens: number; requests: number; cost: number },
  dailyUsage: Array<{ date: string; tokens: number; requests: number; cost?: number }>,
  modelBreakdown: Array<{ model: string; tokens: number; requests: number; cost?: number }>
) {
  return {
    period: { startDate, endDate },
    totals: {
      tokens: totals.tokens,
      requests: totals.requests,
      cost: totals.cost,
    },
    models: modelBreakdown.map((m) => ({
      model: m.model,
      tokens: m.tokens,
      requests: m.requests,
      cost: m.cost ?? 0,
    })),
    dailyUsage,
  };
}

interface OpenAIUsageLike {
  daily_costs: Array<{
    date?: string;
    timestamp: number;
    line_items: Array<{ name: string; cost: number; tokens?: number; requests?: number }>;
  }>;
  total_usage: number;
  total_cost: number;
  total_requests?: number;
}

/** Mapea OpenAIUsageData (api-openai) al formato del frontend */
function mapOpenAIUsageToFrontend(
  data: OpenAIUsageLike,
  startDate: Date,
  endDate: Date
) {
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  const modelMap: Record<string, { tokens: number; requests: number; cost: number }> = {};
  const dailyUsage: Array<{ date: string; tokens: number; requests: number; cost?: number }> = [];

  for (const day of data.daily_costs) {
    const dateStr = day.date ?? new Date(day.timestamp * 1000).toISOString().split('T')[0];
    let dayTokens = 0;
    let dayRequests = 0;
    let dayCost = 0;
    for (const li of day.line_items) {
      const tokens = li.tokens ?? 0;
      const requests = li.requests ?? 1;
      const cost = li.cost ?? 0;
      dayTokens += tokens;
      dayRequests += requests;
      dayCost += cost;
      const name = li.name;
      if (!modelMap[name]) modelMap[name] = { tokens: 0, requests: 0, cost: 0 };
      modelMap[name].tokens += tokens;
      modelMap[name].requests += requests;
      modelMap[name].cost += cost;
    }
    dailyUsage.push({
      date: dateStr,
      tokens: dayTokens,
      requests: dayRequests,
      cost: dayCost,
    });
  }

  const modelBreakdown = Object.entries(modelMap).map(([model, v]) => ({
    model,
    tokens: v.tokens,
    requests: v.requests,
    cost: v.cost,
  }));

  return buildUsageResponse(
    'custom',
    startStr,
    endStr,
    {
      tokens: data.total_usage,
      requests: data.total_requests ?? 0,
      cost: data.total_cost,
    },
    dailyUsage,
    modelBreakdown
  );
}

/** Mapea getOpenAIUsageFromDB (OpenAITokenUsage[]) al formato del frontend */
function mapDbUsageToFrontend(
  usage: Array<{ date: string; tokens: number; requests: number; cost: number; models: Record<string, { tokens: number; requests: number; cost: number }> }>,
  startDate: Date,
  endDate: Date
) {
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  const modelMap: Record<string, { tokens: number; requests: number; cost: number }> = {};
  let totalTokens = 0;
  let totalRequests = 0;
  let totalCost = 0;

  const dailyUsage = usage.map((u) => {
    totalTokens += u.tokens;
    totalRequests += u.requests;
    totalCost += u.cost;
    for (const [model, v] of Object.entries(u.models)) {
      if (!modelMap[model]) modelMap[model] = { tokens: 0, requests: 0, cost: 0 };
      modelMap[model].tokens += v.tokens;
      modelMap[model].requests += v.requests;
      modelMap[model].cost += v.cost;
    }
    return {
      date: u.date,
      tokens: u.tokens,
      requests: u.requests,
      cost: u.cost,
    };
  });

  const modelBreakdown = Object.entries(modelMap).map(([model, v]) => ({
    model,
    tokens: v.tokens,
    requests: v.requests,
    cost: v.cost,
  }));

  return buildUsageResponse(
    'custom',
    startStr,
    endStr,
    { tokens: totalTokens, requests: totalRequests, cost: totalCost },
    dailyUsage,
    modelBreakdown
  );
}

// GET /api/tokens/openai-usage?customerId=...&startDate=...&endDate=...
router.get('/openai-usage', async (req: Request, res: Response) => {
  try {
    const customerId = getParam('customerId', req);
    const startParam = getParam('startDate', req);
    const endParam = getParam('endDate', req);

    if (!customerId) {
      return res.status(400).json({ success: false, error: 'customerId es requerido' });
    }

    const end = endParam ? new Date(endParam) : new Date();
    const start = startParam ? new Date(startParam) : (() => {
      const d = new Date(end);
      d.setDate(d.getDate() - 30);
      return d;
    })();

    const credentials = await getOpenAICredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(200).json({
        success: true,
        data: null,
        error: 'El cliente no tiene credenciales de OpenAI configuradas. Configúralas en Gestión de clientes.',
      });
    }

    let data = await getOpenAIUsage(credentials, start, end);
    if (data) {
      const payload = mapOpenAIUsageToFrontend(data, start, end);
      return res.json({ success: true, data: payload });
    }

    const fromDb = await getOpenAIUsageFromDB(customerId, start, end);
    if (fromDb.length > 0) {
      const payload = mapDbUsageToFrontend(fromDb, start, end);
      return res.json({ success: true, data: payload });
    }

    return res.status(200).json({
      success: true,
      data: null,
      message: 'No hay datos de uso para el rango de fechas. Configura OpenAI en Gestión de clientes y usa /api/tokens/track para registrar llamadas.',
    });
  } catch (e) {
    console.error('[TOKENS] Error openai-usage:', e);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener uso de OpenAI',
    });
  }
});

// GET /api/tokens/stats?customerId=...&period=daily|weekly|monthly
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const customerId = getParam('customerId', req);
    const period = (getParam('period', req) || 'monthly') as 'daily' | 'weekly' | 'monthly';

    if (!customerId) {
      return res.status(400).json({ success: false, error: 'customerId es requerido' });
    }

    const { start, end } = parsePeriodDates(period);
    const credentials = await getOpenAICredentialsForCustomer(customerId);

    let payload: ReturnType<typeof buildUsageResponse> | null = null;

    if (credentials) {
      const data = await getOpenAIUsage(credentials, start, end);
      if (data) {
        payload = mapOpenAIUsageToFrontend(data, start, end);
      }
    }

    if (!payload) {
      const fromDb = await getOpenAIUsageFromDB(customerId, start, end);
      if (fromDb.length > 0) {
        payload = mapDbUsageToFrontend(fromDb, start, end);
      }
    }

    if (!payload) {
      return res.json({
        success: true,
        data: {
          period,
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0],
          totalTokens: 0,
          totalRequests: 0,
          avgTokensPerRequest: 0,
          totalCost: 0,
          models: [],
          dailyBreakdown: [],
          modelBreakdown: [],
        },
      });
    }

    const avgTokens = payload.totals.requests > 0
      ? payload.totals.tokens / payload.totals.requests
      : 0;

    return res.json({
      success: true,
      data: {
        period,
        startDate: payload.period.startDate,
        endDate: payload.period.endDate,
        totalTokens: payload.totals.tokens,
        totalRequests: payload.totals.requests,
        avgTokensPerRequest: avgTokens,
        totalCost: payload.totals.cost,
        models: payload.models.map((m) => m.model),
        dailyBreakdown: payload.dailyUsage.map((d) => ({
          date: d.date,
          tokens: d.tokens,
          requests: d.requests,
          cost: d.cost,
        })),
        modelBreakdown: payload.models,
      },
    });
  } catch (e) {
    console.error('[TOKENS] Error stats:', e);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas de tokens',
    });
  }
});

// POST /api/tokens/track — Registrar una llamada a OpenAI (modelo + tokens) para que el panel muestre uso real
router.post('/track', async (req: Request, res: Response) => {
  try {
    const body = req.body as { customerId?: string; model?: string; tokensUsed?: number; operation?: string };
    const customerId = (body.customerId ?? '').trim();
    let model = (body.model ?? '').trim() || DEFAULT_MODEL_LABEL;
    const tokensUsed = typeof body.tokensUsed === 'number' ? body.tokensUsed : Number(body.tokensUsed);

    if (!customerId) {
      return res.status(400).json({ success: false, error: 'customerId es requerido' });
    }
    if (!ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, error: 'customerId no es un ID válido' });
    }
    if (Number.isNaN(tokensUsed) || tokensUsed < 0) {
      return res.status(400).json({ success: false, error: 'tokensUsed debe ser un número >= 0' });
    }

    const db = await getMongoDb();
    const doc = {
      customerId: new ObjectId(customerId),
      date: new Date(),
      model,
      tokensUsed: Math.round(tokensUsed),
      operation: body.operation || 'chat-completion',
    };
    const result = await db.collection('tokenUsage').insertOne(doc);

    return res.json({
      success: true,
      message: 'Uso registrado correctamente',
      data: { id: result.insertedId, tokensUsed: doc.tokensUsed, model: doc.model },
    });
  } catch (e) {
    console.error('[TOKENS] Error track:', e);
    return res.status(500).json({
      success: false,
      error: 'Error al registrar uso de tokens',
    });
  }
});

export default router;
