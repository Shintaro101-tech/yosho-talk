# アカウント機能のセットアップ（Supabase・無料プラン）

`js/config.js` の `SUPABASE_URL` と `SUPABASE_ANON_KEY` が空のあいだは、これまでどおり「合言葉」で動きます。
下の手順を終えて2つを設定すると、ログインが必要になり、データがアカウントに保存されます。

## 1. Supabase のプロジェクトを作る

1. https://supabase.com/ で無料アカウントを作り、**New project** を押します。
2. 入力する内容
   - **Name**：`yosho-talk`
   - **Database Password**：自動生成のままでOK（パスワード管理アプリなどに保存）
   - **Region**：**Northeast Asia (Tokyo)**
3. 作成が終わるまで1〜2分待ちます。

## 2. データベースの表を作る

1. 左のメニューの **SQL Editor** → **New query** を開きます。
2. このフォルダの `schema.sql` の中身をすべて貼り付けて、**Run** を押します。
3. 「Success」と出ればOKです（何度実行しても大丈夫です）。

## 3. ログインの設定

**Authentication** → **Sign In / Providers** → **Email**

- **Confirm email** を **オフ** にします。
  - 無料プランの標準のメール送信は、プロジェクトのメンバーにしか届かず、1時間に数通しか送れません。仲間内のお試し期間は、確認メールなしで登録できるようにします。
  - 一般に販売する前に、独自のメール送信（SMTP）を設定してからオンに戻します（`docs/launch-plan.md` を参照）。

**Authentication** → **URL Configuration**

- **Site URL**：`https://shintaro101-tech.github.io/yosho-talk/`
- **Redirect URLs** に追加：`https://shintaro101-tech.github.io/yosho-talk/` と `http://localhost:8765/`

## 4. アプリと中継サーバーにつなぐ

**Project Settings** → **API Keys** を開くと、次の値があります。

| 値 | どこに入れるか | チャットに貼ってよいか |
|---|---|---|
| **Project URL**（`https://xxxx.supabase.co`） | `js/config.js` の `SUPABASE_URL` と、`worker/wrangler.toml` の `SUPABASE_URL` | OK（公開される値） |
| **Publishable key**（`sb_publishable_…`。古い画面では `anon` key） | `js/config.js` の `SUPABASE_ANON_KEY` | OK（公開される前提の値） |
| **Secret key**（`sb_secret_…`。古い画面では `service_role` key） | 中継サーバーのシークレット `SUPABASE_SERVICE_KEY` | **絶対に貼らない**（すべてのデータを読み書きできる鍵） |

中継サーバーに Secret key と招待コードを登録して、公開し直します（ターミナルで実行）。

```bash
cd worker
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put INVITE_CODE
npx wrangler deploy
```

- `INVITE_CODE` は仲間に配る招待コードです（例：`yosho-friends-2026`。大文字・小文字は区別しません）。
- 学校のネットワークでは、先に `export HTTPS_PROXY=… HTTP_PROXY=…` を実行してください。

## 5. 自分を管理者にする

1. アプリで自分のアカウントを登録します（このブラウザの本棚・単語帳は、登録時にアカウントへ移せます）。
2. Supabase の **Table Editor** → **profiles** で自分の行の `plan` を `admin` に変えます。
   - 管理者は、月600分のトークと、アバター確認ページの声の作成が使えます。

## プランと上限

`plans` 表で、プランごとの月の上限を変えられます（変更はすぐ反映されます）。

| plan | 名前 | トーク | AI 機能（辞書・フィードバック・質問・写真検索） |
|---|---|---|---|
| `free` | 未登録 | 0分 | 0回（本棚・単語帳だけ使えます） |
| `trial` | お試し | 60分 | 200回 |
| `paid` | 有料プラン | 60分 | 200回 |
| `admin` | 管理者 | 600分 | 5000回 |

- 新しく登録した人は `free` で、招待コードを入れると `trial` になります。
- 使用量は `usage` 表に月ごと（日本時間）に記録されます。

## 使っていて止まらないために（無料プラン）

7日間ほとんど使われないと、プロジェクトが一時停止することがあります（停止の約1週間前に警告メール）。
警告が来たら、Supabase のダッシュボードでプロジェクトを開くか、アプリを開いて本棚を表示してください。
一時停止しても1年以内なら **Resume project** で元に戻せます（データは消えません）。
