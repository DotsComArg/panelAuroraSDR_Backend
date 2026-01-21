export type Role = "SuperAdmin" | "Cliente";

// Roles dentro de una cuenta de cliente
export type CustomerRole = "Admin" | "Manager" | "Employee" | "Viewer";

export interface User {
  _id?: string;
  email: string;
  name: string;
  role: Role;
  // Hash de contraseña para autenticación
  passwordHash?: string;
  // Relación opcional con un customer (empresa / cuenta)
  customerId?: string;
  // Rol dentro de la cuenta del cliente (solo para usuarios con customerId)
  customerRole?: CustomerRole;
  // Indica si el usuario está activo dentro de la cuenta del cliente
  isActive?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface Client {
  _id?: string;
  name: string;
  contactEmail?: string;
  active: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface Activity {
  _id?: string;
  userId?: string;
  clientId?: string;
  type: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string | Date;
}


