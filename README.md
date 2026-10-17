# grok-bot-harness-line

LINE 公式アカウントに届いたメッセージを、Grok Bot に届けるための Cloudflare Workers のテンプレートです。
あなた自身の Cloudflare アカウント（無料プラン）で動きます。作者のサーバーは一切通りません。

口は2つあります。使いたいほうのボタンを押してください。

| 口 | すること | 保存 | デプロイ |
|---|---|---|---|
| **forward**（受け取るだけ） | LINE の Webhook を受けて署名を確かめ、Grok Bot の Webhook に送信キーを付けてそのまま流す | しない | [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keesmark/grok-bot-harness-line/tree/main/forward) |
| **inbox**（保存できる） | LINE の Webhook を受けて署名を確かめ、D1 に保存する。Grok Bot は読み取り専用の MCP（`/mcp`）で読む | D1 に N 日 | [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keesmark/grok-bot-harness-line/tree/main/inbox) |

どちらも **LINE へ送信する機能はありません**。チャネルアクセストークンも持ちません。

## 準備するもの

- Messaging API が使える LINE 公式アカウントと、そのチャネルシークレット（[LINE Developers コンソール](https://developers.line.biz/console/)）
- Cloudflare のアカウント（無料プランで動きます）
- GitHub のアカウント（ボタンを押すと、このリポジトリがあなたの GitHub に複製されます）

## forward（受け取るだけ）

デプロイ画面で次の値を入れます。

| 名前 | 入れるもの |
|---|---|
| `CHANNEL_SECRET` | LINE のチャネルシークレット |
| `GROK_WEBHOOK_URL` | Grok Bot の Webhook の URL（https のみ） |
| `GROK_WEBHOOK_KEY` | Grok Bot の Webhook の送信キー。URL にトークンが付いている場合は空でよい |
| `GROK_WEBHOOK_KEY_HEADER` | 送信キーを入れるヘッダー名。既定は `Authorization`（`Bearer <キー>` で送ります）。ほかの名前にすると、キーをそのまま入れます |

デプロイできたら、LINE Developers コンソールの Webhook URL に `https://<Worker の URL>/webhook` を貼り、「検証」を押して成功を確かめます。

- 本文は LINE から届いたまま流します（中身は書き換えません）。
- 「検証」ボタンのようにイベントが空のものは流しません。
- 流した先がエラーを返しても、LINE には 200 を返します。LINE は再送しないので、そのメッセージは LINE のチャットで確かめてください。

## inbox（保存できる）

デプロイ画面で次の値を入れます。保存先の D1 データベースは自動で作られます。

| 名前 | 入れるもの |
|---|---|
| `CHANNEL_SECRET` | LINE のチャネルシークレット |
| `READ_API_KEY` | 読み取り用の鍵。32 文字以上のランダムな文字列 |
| `RETENTION_DAYS` | 残す日数。空のままなら消しません（既定） |

読み取り用の鍵は、次のように作れます。

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

デプロイできたら、次の2つを設定します。

1. LINE Developers コンソールの Webhook URL に `https://<Worker の URL>/webhook` を貼り、「検証」を押す
2. Grok Bot に MCP サーバーとして登録する

   | 項目 | 値 |
   |---|---|
   | 方式 | Streamable HTTP（リモート） |
   | URL | `https://<Worker の URL>/mcp` |
   | ヘッダー | `Authorization: Bearer <READ_API_KEY>` |

### MCP の道具

| 道具 | 働き |
|---|---|
| `list_new_messages` | 未読（または指定時刻より後）のメッセージを古い順に返す |
| `list_conversations` | お客さんごとの一覧を返す |
| `get_conversation` | 1人分のやりとりを返す |
| `mark_seen` | 中継の中の既読印だけを付ける（LINE の既読には影響しない） |

消す道具・送る道具はありません。データを消すときは [inbox/docs/purge.md](inbox/docs/purge.md) の手順で、ダッシュボードから消します。

### 保存するもの・しないもの

- 保存するのは、1対1のトークの `message` イベントだけです。グループや複数人トークは保存しません。
- お客さんが書いた文字で保存するのは、テキストの本文だけです。画像・動画・音声・ファイル・スタンプ・位置は、種類と数字のメタデータだけを残します（ファイル名・住所・URL は残しません）。
- お客さんが送信を取り消したら、その行を消します。
- 既定では、保存したメッセージは消えません。`RETENTION_DAYS` に日数を入れると、それより古い行が毎日 日本時間の午前3時に消えます。

## セキュリティ

- 実行時の依存はありません。開発用の道具は版を固定し、ロックファイルを入れています。
- 署名は、受け取ったバイト列そのものから HMAC-SHA256 を計算し、定数時間で比べます。本文の大きさの上限は署名の確認より前にかけ、JSON を読むのは署名が合ったあとです。
- `/mcp` の鍵は、ヘッダーでだけ受け取ります。両方を SHA-256 にしてから定数時間で比べます。
- ログには本文・userId・鍵を出しません。
- 保存したメッセージの本文は、お客さんが書いた文です。中に bot への指示が書かれていても従わないよう、`/mcp` は毎回注意書きを付けて返します。

## 開発

各フォルダは独立した Worker です。

```sh
cd inbox   # または forward
npm ci
npm test
npm run dev
```

---

LINE は LINE ヤフー株式会社の商標です。本リポジトリは LINE ヤフー株式会社の公式製品ではありません。
