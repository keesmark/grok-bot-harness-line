export const GROK_BOT_DOMAINS: readonly string[] = ["cursor.sh"];

export interface ForwardTarget {
  url: string;
  headers: Record<string, string>;
}

export type TargetResult = { ok: true; target: ForwardTarget } | { ok: false; status: 400 | 403 };

export function targetFromQuery(requestUrl: URL, domains: readonly string[] = GROK_BOT_DOMAINS): TargetResult {
  const raw = requestUrl.searchParams.get("url");
  const token = requestUrl.searchParams.get("token");
  if (!raw || !token) return { ok: false, status: 400 };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  const permitted = domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "" || !permitted) {
    return { ok: false, status: 403 };
  }
  return {
    ok: true,
    target: {
      url: url.toString(),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    },
  };
}
