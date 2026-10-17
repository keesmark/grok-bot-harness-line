export interface AllowedTarget {
  host: string;
  pathPrefix: string;
}

export const GROK_BOT_TARGETS: readonly AllowedTarget[] = [
  { host: "api2.cursor.sh", pathPrefix: "/automations/webhook/" },
];

export interface ForwardTarget {
  url: string;
  headers: Record<string, string>;
}

export type TargetResult = { ok: true; target: ForwardTarget } | { ok: false; status: 400 | 403 };

export function targetFromQuery(
  requestUrl: URL,
  allowed: readonly AllowedTarget[] = GROK_BOT_TARGETS,
): TargetResult {
  const raw = requestUrl.searchParams.get("url");
  const token = requestUrl.searchParams.get("token");
  if (!raw || !token) return { ok: false, status: 400 };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  const permitted = allowed.some(
    (target) =>
      url.hostname === target.host &&
      url.pathname.startsWith(target.pathPrefix) &&
      url.pathname.length > target.pathPrefix.length,
  );
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
