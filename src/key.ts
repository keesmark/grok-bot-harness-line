export async function relayKeyAccepted(requestUrl: URL, relayKey: string | undefined): Promise<boolean> {
  if (!relayKey) return true;
  const given = requestUrl.searchParams.get("key") ?? "";
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([given, relayKey].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  return crypto.subtle.timingSafeEqual(a, b);
}
