export const ROLE_KEYS = Object.freeze([
  'worker',
  'site_supervisor',
  'hq_staff',
  'admin',
]);

export const defaultRoleLabels = Object.freeze({
  worker: '工人',
  site_supervisor: '現場主管',
  hq_staff: '總部人員',
  admin: '管理員',
});

export const roleLabels = defaultRoleLabels;

export const buildRoleOptions = (labels = defaultRoleLabels) =>
  ROLE_KEYS.map((role) => ({
    value: role,
    label: labels[role] ?? defaultRoleLabels[role] ?? role,
  }));

export const defaultRoleOptions = buildRoleOptions();

export const roleOptions = defaultRoleOptions;

export const managerRoles = new Set(['site_supervisor', 'hq_staff', 'admin']);
