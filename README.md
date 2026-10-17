# grok-bot-harness-line

LINE 公式アカウントの Webhook を、Grok Bot の Webhook に届けるための Cloudflare Workers のテンプレートです。
LINE の Webhook は送信キーのヘッダーを付けられないので、この Worker が間に立ってキーを付け替えます。
あなた自身の Cloudflare アカウント（無料プラン）で動きます。作者のサーバーは一切通りません。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keesmark/grok-bot-harness-line)

- 何も保存しません。届いた本文を、そのまま Grok Bot に流すだけです。
- LINE へ送信する機能はありません。チャネルアクセストークンも持ちません。
- デプロイ画面で入れる値はありません。

## 準備するもの

- Messaging API が使える LINE 公式アカウント（[LINE Developers コンソール](https://developers.line.biz/console/)）
- Grok Bot の Webhook の URL と送信キー
- Cloudflare のアカウント（無料プランで動きます）
- GitHub のアカウント（ボタンを押すと、このリポジトリがあなたの GitHub に複製されます）

## つなぎ方

デプロイできたら、LINE Developers コンソールの Webhook URL に次を貼り、「検証」を押して成功を確かめます。

```
https://<Worker の URL>/webhook?url=<Grok Bot の Webhook の URL>&token=<送信キー>
```

`url` は URL エンコードしてください。Worker は `token` を `Authorization: Bearer <送信キー>` に付け替えて、本文を LINE から届いたまま `url` に流します。

- 流せる宛先は、コードに書いた Grok Bot のドメインだけです。ほかの宛先を指定すると 403 になり、どこにも流しません。
- 送信キーが URL に入るので、リクエストのログは残しません。この URL はチャットなどに貼らないでください。
- 「検証」ボタンのようにイベントが空のものは流しません。
- 流した先がエラーを返しても、LINE には 200 を返します。LINE は再送しないので、そのメッセージは LINE のチャットで確かめてください。

### LINE の署名も確かめる（推奨）

LINE は Webhook の署名を必ず確かめるよう勧めています。ダッシュボードで Worker のシークレットに `CHANNEL_SECRET`（チャネルシークレット）を足すと、署名が合わないリクエストを 401 で断るようになります。足さない場合、守りは「URL を知られないこと」だけになります。

## セキュリティ

- 実行時の依存はありません。開発用の道具は版を固定し、ロックファイルを入れています。
- 署名は、受け取ったバイト列そのものから HMAC-SHA256 を計算し、定数時間で比べます。本文の大きさの上限は署名の確認より前にかけ、JSON を読むのは署名が合ったあとです。
- ログには本文・URL・鍵を出しません。

## 開発

```sh
npm ci
npm test
npm run dev
```

---

LINE は LINE ヤフー株式会社の商標です。本リポジトリは LINE ヤフー株式会社の公式製品ではありません。
