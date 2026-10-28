# 洋書トーク 中継サーバー（Cloudflare Worker）

OpenAI API キーをここに預け、アプリ（GitHub Pages）からはキーなしで使えるようにする中継サーバーです。

- 合言葉（`X-Passcode`）が正しいリクエストだけを OpenAI に転送
- 許可したサイト（`ALLOWED_ORIGINS`）からのアクセスだけを受け付け
- 1つの IP アドレスにつき 1分20回まで（合言葉の総当たり対策）
- 使うモデルはサーバー側で固定（GPT-Live は `gpt-live-1`、単語保存・抽出は `BACKEND_MODEL`）
- オリジナルの声の作成（prompt-to-voice、`/v1/audio/voices`）も中継します
- 辞書のイメージ写真を Pixabay で検索します（`PIXABAY_KEY` を登録したときだけ）
- アカウント（Supabase）でログインした人は、プランごとの月の上限（トーク時間・AI 機能の回数）までだけ使えます（`SUPABASE_URL`・`SUPABASE_SERVICE_KEY`・`INVITE_CODE` を設定したとき。手順は `supabase/README.md`）
- 中継するのは接続開始時の情報だけ。会話の音声はブラウザと OpenAI が直接やり取り

## 初回セットアップ（ターミナルで実行）

1. OpenAI でこのアプリ専用のプロジェクトを作り、API キーを発行します。あわせて、月の利用上限（Budget）も設定しておくと安心です。
   https://platform.openai.com/settings/organization/projects
2. このフォルダに移動して、必要なツールをインストールします。

   ```bash
   cd worker && npm install
   ```

3. Cloudflare にログインします（無料アカウント。ブラウザが開きます）。

   ```bash
   npx wrangler login
   ```

4. API キーと合言葉を登録します。入力した文字は画面に表示されず、Cloudflare に暗号化して保存されます。

   ```bash
   npx wrangler secret put OPENAI_API_KEY
   ```

   ```bash
   npx wrangler secret put PASSCODE
   ```

   合言葉は推測されにくいものにしてください（例：`wonder-auggie-2026`）。

5. 公開します。

   ```bash
   npx wrangler deploy
   ```

   表示された URL（`https://yosho-talk-api.<あなたのサブドメイン>.workers.dev`）を `js/config.js` の `DEPLOYED_WORKER_URL` に設定します。

## 辞書のイメージ写真（Pixabay・任意）

1. https://pixabay.com/ で無料アカウントを作ってログインします。
2. https://pixabay.com/api/docs/ を開くと、ページ内の「key」の欄に API キーが表示されます。
3. キーを登録して、公開し直します。

   ```bash
   npx wrangler secret put PIXABAY_KEY
   ```

   ```bash
   npx wrangler deploy
   ```

キーがなくても辞書は使えます（写真の代わりに絵文字だけを表示します）。

## あとから変更するとき

- **合言葉を変える**：`npx wrangler secret put PASSCODE` を実行すると、すぐに切り替わります。旧い合言葉を記憶しているブラウザでは、次に使うときに入力を求められます。
- **キーを差し替える**：`npx wrangler secret put OPENAI_API_KEY`
- **モデルや許可するサイトを変える**：`wrangler.toml` の `[vars]` を編集してから `npx wrangler deploy`

## 手元でのテスト

`worker/.dev.vars` に次の内容を書きます。このファイルは git に含まれません。

```
OPENAI_API_KEY="sk-..."
PASSCODE="test"
```

次のコマンドで起動します。

```bash
npx wrangler dev --port 8787
```

アプリを localhost で開くと、自動的にこの中継サーバーにつながります。
