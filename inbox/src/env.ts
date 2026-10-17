export interface Env {
  DB: D1Database;
  CHANNEL_SECRET?: string;
  READ_API_KEY?: string;
  RETENTION_DAYS?: string;
}

// RETENTION_DAYS が正の整数でなければ null。そのときは何も消さない（無期限）。
export function retentionDays(env: Env): number | null {
  const value = env.RETENTION_DAYS?.trim() ?? "";
  if (!/^\d+$/.test(value)) return null;
  const days = Number(value);
  return days > 0 ? days : null;
}
