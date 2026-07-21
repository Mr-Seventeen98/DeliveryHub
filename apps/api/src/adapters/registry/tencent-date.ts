const TENCENT_DATE_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-])(\d{2})(\d{2})(?:\s+[A-Za-z]+)?$/;

export function normalizeTencentCloudDate(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  const match = value.trim().match(TENCENT_DATE_WITH_ZONE);
  const normalized = match
    ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7]}${match[8]}:${match[9]}`
    : value;
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
