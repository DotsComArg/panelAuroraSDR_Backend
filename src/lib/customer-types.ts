import { ObjectId } from 'mongodb';

// Vistas/Features disponibles en el sistema
export type ViewFeature = 
  | 'dashboard' 
  | 'agentes' 
  | 'ubicaciones' 
  | 'analiticas' 
  | 'kommo'
  | 'equipo' 
  | 'configuracion'
  | 'consultas' // Vista específica para HubsAutos (consultas de vehículos)
  | 'tokens'; // Vista de gestión de tokens de OpenAI

export interface Customer {
  _id?: ObjectId;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  pais: string;
  cantidadAgentes: number;
  planContratado: 'Básico' | 'Profesional' | 'Enterprise' | 'Custom';
  fechaInicio: Date;
  twoFactorAuth: boolean;
  rol: 'Cliente' | 'Owner';
  // Configuración de features/vistas habilitadas para este cliente
  enabledViews?: ViewFeature[];
  // Configuraciones adicionales específicas del cliente
  customConfig?: {
    [key: string]: any;
  };
  // Credenciales de Kommo encriptadas
  kommoCredentials?: {
    baseUrl: string; // URL base de Kommo (ej: https://dotscomagency.kommo.com)
    accessToken: string; // Access token encriptado
    integrationId?: string; // ID de integración (opcional)
    secretKey?: string; // Secret key encriptado (opcional)
  };
  // Credenciales de PostgreSQL/n8n encriptadas
  postgresCredentials?: {
    connectionString: string; // Connection string encriptado (postgresql://user:pass@host:port/db)
  };
  // Credenciales de OpenAI encriptadas
  openAICredentials?: {
    apiKey: string; // API key de OpenAI encriptado
    organizationId?: string; // ID de la organización (opcional)
    projectId?: string; // ID del proyecto (opcional)
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerDto {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  pais: string;
  cantidadAgentes: number;
  planContratado: 'Básico' | 'Profesional' | 'Enterprise' | 'Custom';
  fechaInicio: string; // ISO string
  twoFactorAuth: boolean;
  rol: 'Cliente' | 'Owner';
  enabledViews?: ViewFeature[];
  customConfig?: {
    [key: string]: any;
  };
  kommoCredentials?: {
    baseUrl: string;
    accessToken: string; // Token sin encriptar (se encriptará al guardar)
    integrationId?: string;
    secretKey?: string; // Secret sin encriptar (se encriptará al guardar)
  };
  postgresCredentials?: {
    connectionString: string; // Connection string sin encriptar (se encriptará al guardar)
  };
  openAICredentials?: {
    apiKey: string; // API key sin encriptar (se encriptará al guardar)
  };
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {
  _id: string;
}

