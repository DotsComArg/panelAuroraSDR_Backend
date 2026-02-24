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
  | 'tokens' // Vista de gestión de tokens de OpenAI
  | 'metaCapi'; // Meta Conversions API + Kommo (admin)

export interface Customer {
  _id?: ObjectId;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  pais: string;
  ciudad?: string;
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
  // Credenciales de Kommo encriptadas (una cuenta; se mantiene por compatibilidad)
  kommoCredentials?: {
    baseUrl: string; // URL base de Kommo (ej: https://dotscomagency.kommo.com)
    accountId?: string; // ID de cuenta que envía Kommo en webhooks (ej: 35875379); si no coincide el subdominio
    accessToken: string; // Access token encriptado
    integrationId?: string; // ID de integración (opcional)
    secretKey?: string; // Secret key encriptado (opcional)
  };
  // Múltiples cuentas Kommo por cliente (Kommo 1, Kommo 2, ...)
  kommoAccounts?: Array<{
    baseUrl: string;
    accountId?: string; // ID de cuenta para webhooks
    accessToken: string;
    integrationId?: string;
    secretKey?: string;
  }>;
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
  // Credenciales de Meta Conversions API (CAPI) encriptadas – para sincronización con Kommo
  metaCapiCredentials?: {
    pixelId: string; // Meta Pixel ID
    accessToken: string; // Access token de CAPI (encriptado)
    adAccountId?: string; // ID de cuenta de anuncios (opcional)
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
  ciudad?: string;
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
    accountId?: string; // ID de cuenta Kommo para webhooks (ej: 35875379)
    accessToken: string; // Token sin encriptar (se encriptará al guardar)
    integrationId?: string;
    secretKey?: string; // Secret sin encriptar (se encriptará al guardar)
  };
  kommoAccounts?: Array<{
    baseUrl: string;
    accountId?: string;
    accessToken: string;
    integrationId?: string;
    secretKey?: string;
  }>;
  postgresCredentials?: {
    connectionString: string; // Connection string sin encriptar (se encriptará al guardar)
  };
  openAICredentials?: {
    apiKey: string; // API key sin encriptar (se encriptará al guardar)
    organizationId?: string;
    projectId?: string;
  };
  metaCapiCredentials?: {
    pixelId: string;
    accessToken: string; // Sin encriptar (se encriptará al guardar)
    adAccountId?: string;
  };
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {
  _id: string;
}

