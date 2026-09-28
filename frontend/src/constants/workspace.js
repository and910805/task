export const INDUSTRY_OPTIONS = Object.freeze([
  { value: 'plumbing_electrical', label: '水電工程' },
  { value: 'renovation', label: '室內裝修' },
  { value: 'cleaning', label: '清潔服務' },
  { value: 'repair', label: '維修服務' },
  { value: 'other', label: '其他現場服務' },
]);

export const MANAGER_ROLES = Object.freeze(['admin', 'site_supervisor', 'hq_staff']);

// Where to land after login / switching company.
export const landingPathFor = (session) => {
  const user = session?.user ?? session;
  if (!user) return '/login';
  if (!user.active_workspace_id) return '/onboarding';
  return user.role === 'worker' ? '/today' : '/app';
};
