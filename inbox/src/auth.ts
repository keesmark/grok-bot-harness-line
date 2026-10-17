// /mcp の Bearer 鍵を確かめる。
// 両方を SHA-256 にしてから比べるので、長さの違いで手がかりを与えない。
export const MIN_KEY_LENGTH = 32;

const encoder = new TextEncoder();

export function isUsableKey(key: string | undefined): key is string {
  return typeof key === "string" && key.length >= MIN_KEY_LENGTH;
}

export async function matchesBearer(header: string | null, key: string): Promise<boolean> {
  // 認証の方式名（Bearer）は大文字小文字を区別しない（RFC 7235）。
  const match = header === null ? null : /^Bearer +(.+)$/i.exec(header);
  if (match === null) return false;
  const given = match[1];
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(key)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}
