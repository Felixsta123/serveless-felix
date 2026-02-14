export const parseIntStrict = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
};

export const parsePositiveInt = (value: unknown): number | null => {
  const parsed = parseIntStrict(value);
  if (parsed === null || parsed < 1) {
    return null;
  }
  return parsed;
};

export const normalizeHexColor = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!/^#?[0-9a-f]{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};

export const toRoundId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

export const isHexState = (value: string, bytes = 16): boolean => {
  const size = bytes * 2;
  const pattern = new RegExp(`^[a-f0-9]{${size}}$`, 'i');
  return pattern.test(value);
};
