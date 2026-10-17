# 保存したメッセージを消す手順

inbox の Worker には、データを消す口がありません。bot から消せないようにするためです。
消すときは、Cloudflare のダッシュボードで社長が自分で行います。

## 中身だけ消すとき

1. Cloudflare のダッシュボードにログインします。
2. D1 の画面で `grok-bot-harness-line-inbox` を開き、コンソールを開きます。
3. 次を貼って実行します。

   ```sql
   DELETE FROM messages;
   DELETE FROM contacts;
   ```

4. bot に `list_conversations` を呼んでもらい、空になったことを確かめます。

## 使うのをやめるとき

1. LINE Developers コンソールで、Webhook の利用をオフにし、URL を消します。
2. Cloudflare のダッシュボードで、Worker と D1 のデータベースを消します。
3. bot の MCP 設定から、この中継を外します。
4. 複製された GitHub のリポジトリを消します（任意。コードだけで、データと鍵は入っていません）。
5. bot の台帳やチャットにある要約・下書きは、Grok Bot 側で別に消します。

D1 には、前の状態に戻せる仕組み（Time Travel）があります。消したあともしばらく戻せる可能性があるので、跡を残したくないときはデータベースごと消してください。
