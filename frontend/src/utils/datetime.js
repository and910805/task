const hasTimezone = (value) => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);

export const parseServerUtcDate = (value) => {
  if (!value) return null;
  const normalized = hasTimezone(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const toLocalDateTimeInput = (value) => {
  const date = parseServerUtcDate(value);
  if (!date) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export const localDateTimeInputToIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const formatServerDateTime = (value) => {
  if (!value) return '未設定';
  const date = parseServerUtcDate(value);
  return date ? date.toLocaleString() : String(value);
};
