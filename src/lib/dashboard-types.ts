// Tipos para las métricas del dashboard

export interface ExecutionEntity {
  id: string;
  workflowId: string;
  finished: boolean;
  mode: string;
  retryOf: string | null;
  retrySuccessId: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
  waitTill: Date | null;
  status: 'success' | 'error' | 'waiting' | 'running' | 'canceled';
  workflowData?: any;
  customData?: any;
  annotation?: any;
}

export interface ChatHistory {
  id: number;
  session_id: string;
  message: string;
  type: 'ai' | 'human';
  created_at: Date;
}

export interface WorkflowEntity {
  id: string;
  name: string;
  active: boolean;
  nodes: any;
  connections: any;
  settings: any;
  createdAt: Date;
  updatedAt: Date;
}

// Tipos para las métricas del dashboard
export interface MetricasGenerales {
  leadsGenerados: number;
  reunionesAgendadas: number | null; // null = sin datos configurados
  respuestasAutomaticasCorrectas: number;
  porcentajeRespuestasCorrectas: number;
  tiempoPromedioRespuesta: number; // en segundos
  cierresEfectivos: number;
  porcentajeCierresEfectivos: number;
}

export interface MetricasComunicacion {
  adecuacionMarca: number; // 0-100
  conocimientoProductos: number; // 0-100
  satisfaccionGeneral: number; // 0-100
}

export interface MetricasPorPeriodo {
  fecha: string;
  leads: number;
  reuniones: number;
  respuestas: number;
  tiempoPromedio: number;
}

export interface DashboardMetrics {
  generales: MetricasGenerales;
  comunicacion: MetricasComunicacion;
  porPeriodo: MetricasPorPeriodo[];
  ultimaActualizacion: Date;
}

