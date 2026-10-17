export interface Env {
  // 任意。入れたときだけ LINE の署名を確かめる。
  CHANNEL_SECRET?: string;
}

// 流してよい Grok Bot の Webhook のドメイン。踏み台にされないよう、ここ以外には流さない。
export const GROK_BOT_HOSTS: readonly string[] = [];

export interface ForwardTarget {
  url: string;
  headers: Record<string, string>;
}

export type TargetResult = { ok: true; target: ForwardTarget } | { ok: false; status: 400 | 403 };

// LINE に登録した URL の ?url=…&token=… から転送先を作る。
export function targetFromQuery(requestUrl: URL, hosts: readonly string[] = GROK_BOT_HOSTS): TargetResult {
  const raw = requestUrl.searchParams.get("url");
  const token = requestUrl.searchParams.get("token");
  if (!raw || !token) return { ok: false, status: 400 };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  if (url.protocol !== "https:" || !hosts.includes(url.hostname)) return { ok: false, status: 403 };
  return {
    ok: true,
    target: {
      url: url.toString(),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    },
  };
}
