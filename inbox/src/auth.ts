// /mcp の Bearer 鍵を確かめる。
// 両方を SHA-256 にしてから比べるので、長さの違いで手がかりを与えない。
export const MIN_KEY_LENGTH = 32;

const encoder = new TextEncoder();

export function isUsableKey(key: string | undefined): key is string {
  return typeof key === "string" && key.length >= MIN_KEY_LENGTH;
}

export async function matchesBearer(header: string | null, key: string): Promise<boolean> {
  if (header === null || !header.startsWith("Bearer ")) return false;
  const given = header.slice("Bearer ".length);
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(key)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}
