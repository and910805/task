export const roleLabels = {
  worker: '工人',
  site_supervisor: '現場主管',
  hq_staff: '總部人員',
  admin: '管理員',
};

export const roleOptions = [
  { value: 'worker', label: roleLabels.worker },
  { value: 'site_supervisor', label: roleLabels.site_supervisor },
  { value: 'hq_staff', label: roleLabels.hq_staff },
  { value: 'admin', label: roleLabels.admin },
];

export const managerRoles = new Set(['site_supervisor', 'hq_staff', 'admin']);
