import type { CustomerId, CustomerRole, CustomerStatus } from './enums.js';

export interface Customer {
  readonly id: CustomerId;
  readonly email: string;
  readonly fullName: string;
  readonly role: CustomerRole;
  readonly status: CustomerStatus;
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export function isPrivileged(role: CustomerRole): boolean {
  return role === 'admin' || role === 'support';
}

export function isAdmin(role: CustomerRole): boolean {
  return role === 'admin';
}
