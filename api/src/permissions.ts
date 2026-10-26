export const PERMISSIONS = [
  { key: 'customers.read', label: 'View customers and addresses', group: 'Customers' },
  { key: 'customers.write', label: 'Create customers and manage contact details and addresses', group: 'Customers' },
  { key: 'jobs.read', label: 'View jobs and work orders', group: 'Jobs' },
  { key: 'jobs.create', label: 'Create jobs', group: 'Jobs' },
  { key: 'jobs.update', label: 'Update job status, priority, assignment, and schedule', group: 'Jobs' },
  { key: 'schedule.read', label: 'View the team schedule', group: 'Jobs' },
  { key: 'equipment.read', label: 'View equipment and service history', group: 'Equipment' },
  { key: 'equipment.write', label: 'Register equipment', group: 'Equipment' },
  { key: 'worklogs.read', label: 'View labor and material logs', group: 'Work orders' },
  { key: 'worklogs.write', label: 'Record labor and materials', group: 'Work orders' },
  { key: 'attachments.read', label: 'View work-order attachments', group: 'Work orders' },
  { key: 'attachments.write', label: 'Upload work-order attachments', group: 'Work orders' },
  { key: 'inventory.read', label: 'View inventory and parts', group: 'Inventory' },
  { key: 'inventory.write', label: 'Manage inventory and stock movements', group: 'Inventory' },
  { key: 'maintenance.read', label: 'View preventive-maintenance plans', group: 'Maintenance' },
  { key: 'maintenance.write', label: 'Manage plans and generate work orders', group: 'Maintenance' },
  { key: 'reports.read', label: 'View reports and export job data', group: 'Reports' },
  { key: 'team.read', label: 'View active team members', group: 'Administration' },
  { key: 'notifications.read', label: 'View and update notifications', group: 'Administration' },
  { key: 'team.manage', label: 'Create employee accounts and assign roles', group: 'Administration' },
  { key: 'settings.read', label: 'View organization settings', group: 'Administration' },
  { key: 'settings.manage', label: 'Change organization settings', group: 'Administration' },
  { key: 'roles.manage', label: 'Create roles and assign permissions', group: 'Administration' }
] as const;

export type Permission = typeof PERMISSIONS[number]['key'];

const dailyPermissions: Permission[] = [
  'customers.read', 'customers.write', 'jobs.read', 'jobs.create', 'jobs.update', 'schedule.read',
  'equipment.read', 'equipment.write', 'worklogs.read', 'worklogs.write', 'attachments.read',
  'attachments.write', 'inventory.read', 'team.read', 'notifications.read', 'settings.read'
];

export const PROTECTED_PERMISSIONS: Permission[] = ['team.manage', 'settings.manage', 'roles.manage'];

export const BUILT_IN_ROLES = [
  {
    key: 'employee',
    name: 'Employee',
    description: 'Handle daily customer, job, equipment, and work-order tasks.',
    permissions: dailyPermissions
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Manage daily work plus inventory, maintenance, and reports.',
    permissions: [...dailyPermissions, 'inventory.write', 'maintenance.read', 'maintenance.write', 'reports.read'] as Permission[]
  },
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Full access, including employee accounts, roles, and organization settings.',
    permissions: PERMISSIONS.map(permission => permission.key) as Permission[]
  }
] as const;

export function isPermission(value: string): value is Permission {
  return PERMISSIONS.some(permission => permission.key === value);
}
