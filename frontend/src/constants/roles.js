export const ROLE_KEYS = Object.freeze([
  'worker',
  'site_supervisor',
  'hq_staff',
  'admin',
]);

// Platform defaults; every company can rename them in 系統設定.
export const defaultRoleLabels = Object.freeze({
  worker: '現場人員',
  site_supervisor: '主管',
  hq_staff: '辦公室人員',
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
