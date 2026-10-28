# 洋書トーク — Read, Talk, Learn

YouTube「洋書ラジオ」の英語学習用ウェブアプリ（個人利用版）。

- 📚 **本棚**：読んだ本を記録（リスト／ブックカレンダー）。Open Library（洋書）と国立国会図書館サーチ（日本語の本）で検索
- 🎙️ **トーク**：本についてアバター（Emma / Oliver / Noah / Chloe）と英語でディスカッション。瞬き・口パクつき（声の選択・表示の確認は管理用ページ `#/avatars`）（OpenAI **GPT-Live-1**）
- 📖 **辞書**：単語・フレーズを調べると、日本語の意味・米英の発音記号・発音（Wiktionary の録音、なければ端末の音声）・例文・よく使う組み合わせ・イメージ（絵文字と Pixabay の写真）を表示。見かけた文を入れるとその文での意味も。ワンタップで単語帳へ（本も紐づけ）
  - 「Can you save that word?」と頼むと単語帳に保存
  - 会話中は「ディスプレイ」に大事な表現や質問が表示されます
  - 終了後、ワンランク上の表現（1〜3つ）をフィードバック。そのフレーズを使う練習トークもできます
- 🗂️ **単語帳**：トークで学んだ語がたまるオリジナル単語帳（発音再生つき）
- ⏱️ トークは月60分まで（毎月1日にリセット）。30秒間会話がないと自動で一時停止し、ボタンで再開できます

## 使い方

1. 「本棚」で本を追加 →「この本についてトーク」
2. 初回だけ合言葉を入力（そのブラウザに記憶されます）

データはすべてブラウザ内に保存されます。「設定 › エクスポート」で定期的にバックアップしてください。

## OpenAI API キーについて

API キーはアプリに含めず、Cloudflare Workers の中継サーバー（[worker/](worker/README.md)）に保管しています。アプリは合言葉を付けて中継サーバーにリクエストし、中継サーバーがキーを付けて OpenAI に送ります。セットアップ手順は [worker/README.md](worker/README.md) を参照してください。

## ローカルで動かす

```bash
python3 -m http.server 8765
```

http://localhost:8765 を開く。トークを試すときは、別のターミナルで中継サーバーも起動します（`cd worker && npx wrangler dev --port 8787`）。

## 構成

ビルド不要の静的サイト（HTML / CSS / ES Modules）。GitHub Pages にそのまま公開できます。

```
index.html
css/style.css
js/app.js       ルーター
js/config.js    中継サーバーの URL
js/api.js       中継サーバーとの通信・合言葉
js/store.js     データ保存・XP・間隔反復
js/books.js     本棚・カレンダー
js/talk.js      トーク画面
js/live.js      GPT-Live WebRTC クライアント / Responses API
js/avatars.js   アバター（画像・声）
js/avatar-check.js 声の選択・表示の確認
js/words.js     単語帳
js/history.js   トーク履歴
js/settings.js  設定
worker/         Cloudflare Worker（中継サーバー）
```

## アカウント・販売の準備

- アカウント機能（Supabase）のセットアップ：`supabase/README.md`
- 販売までの段階ごとの作業と費用のシミュレーション：`docs/launch-plan.md`
