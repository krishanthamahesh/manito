import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from './auth.service';
import { Permission } from './permissions';

export function hasPermission(user: AuthUser, permission: Permission): boolean {
  const impliedPermissions: Record<string, Permission[]> = {
    'customers.write': ['customers.read'],
    'jobs.create': ['jobs.read','customers.read','locations.read'],
    'jobs.update': ['jobs.read','team.read','contractors.read'],
    'schedule.read': ['jobs.read'],
    'locations.manage': ['locations.read'],
    'contractors.manage': ['contractors.read'],
    'equipment.write': ['equipment.read','customers.read'],
    'worklogs.write': ['worklogs.read'],
    'attachments.write': ['attachments.read'],
    'inventory.write': ['inventory.read'],
    'maintenance.write': ['maintenance.read'],
    'team.manage': ['team.read'],
    'settings.manage': ['settings.read']
  };
  return user.systemRole === 'admin' || user.permissions.includes(permission) ||
    user.permissions.some(granted => impliedPermissions[granted]?.includes(permission));
}

export function requirePermission(user: AuthUser, permission: Permission): void {
  if (!hasPermission(user, permission)) {
    throw new ForbiddenException(`The ${permission} permission is required.`);
  }
}

export function requireAdministrator(user: AuthUser): void {
  if (user.systemRole !== 'admin') {
    throw new ForbiddenException('Administrator access is required.');
  }
}
