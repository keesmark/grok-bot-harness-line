export interface Env {
  CHANNEL_SECRET?: string;
  GROK_WEBHOOK_URL?: string;
  GROK_WEBHOOK_KEY?: string;
  // 送信キーを入れるヘッダーの名前。Authorization のときは "Bearer " を付ける
  GROK_WEBHOOK_KEY_HEADER?: string;
}

export interface ForwardTarget {
  url: string;
  headers: Record<string, string>;
}

// 転送先が https のときだけ転送先を返す。
// 送信キーは任意。URL にトークンが付いている転送先なら、キーを入れなくてよい。
export function forwardTarget(env: Env): ForwardTarget | null {
  if (!env.GROK_WEBHOOK_URL) return null;
  let url: URL;
  try {
    url = new URL(env.GROK_WEBHOOK_URL);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.GROK_WEBHOOK_KEY) {
    const name = env.GROK_WEBHOOK_KEY_HEADER?.trim() || "Authorization";
    headers[name] = name.toLowerCase() === "authorization" ? `Bearer ${env.GROK_WEBHOOK_KEY}` : env.GROK_WEBHOOK_KEY;
  }
  return { url: url.toString(), headers };
}
