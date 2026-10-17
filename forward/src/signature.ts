// LINE の X-Line-Signature を確かめる（HMAC-SHA256 / base64）。
// HMAC-SHA256 は32バイトで、base64 にすると44文字になる。
const SIGNATURE_LENGTH = 44;

const encoder = new TextEncoder();

export function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// 長さが合わない署名は、HMAC を計算する前に断る。
export function hasSignatureShape(header: string | null): header is string {
  return header !== null && header.length === SIGNATURE_LENGTH;
}

export async function verifySignature(
  channelSecret: string,
  body: Uint8Array,
  header: string,
): Promise<boolean> {
  const expected = decodeBase64(header);
  if (expected === null || expected.byteLength !== 32) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const actual = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  return crypto.subtle.timingSafeEqual(actual, expected);
}
