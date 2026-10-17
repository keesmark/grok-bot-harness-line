export async function relayKeyMatches(requestUrl: URL, relayKey: string): Promise<boolean> {
  const given = requestUrl.searchParams.get("key") ?? "";
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([given, relayKey].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  return crypto.subtle.timingSafeEqual(a, b);
}
