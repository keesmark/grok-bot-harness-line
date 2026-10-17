export interface Env {
  CHANNEL_SECRET?: string;
  GROK_WEBHOOK_URL?: string;
  GROK_WEBHOOK_KEY?: string;
  // 送信キーを入れるヘッダーの名前。Authorization のときは "Bearer " を付ける
  GROK_WEBHOOK_KEY_HEADER?: string;
}

export interface ForwardTarget {
  url: string;
  headerName: string;
  headerValue: string;
}

// 設定がそろっていて、転送先が https のときだけ転送先を返す。
export function forwardTarget(env: Env): ForwardTarget | null {
  if (!env.GROK_WEBHOOK_URL || !env.GROK_WEBHOOK_KEY) return null;
  let url: URL;
  try {
    url = new URL(env.GROK_WEBHOOK_URL);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const headerName = env.GROK_WEBHOOK_KEY_HEADER?.trim() || "Authorization";
  const headerValue = headerName.toLowerCase() === "authorization" ? `Bearer ${env.GROK_WEBHOOK_KEY}` : env.GROK_WEBHOOK_KEY;
  return { url: url.toString(), headerName, headerValue };
}
