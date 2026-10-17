// D1 には UNIX ミリ秒で入れ、外には日本時間の ISO 8601（+09:00）で出す。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

export function toJstIso(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().replace("Z", "+09:00");
}

// オフセットのない時刻は日本時間として読む。読めなければ null。
export function parseIsoAsJst(value: string): number | null {
  const text = HAS_OFFSET.test(value) ? value : `${value}+09:00`;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}
