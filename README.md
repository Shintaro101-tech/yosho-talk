# 洋書トーク — Read, Talk, Learn

YouTube「洋書ラジオ」の英語学習用ウェブアプリ（個人利用版）。

- 📚 **本棚**：読んだ本を記録（リスト／ブックカレンダー）。Open Library で表紙を検索
- 🎙️ **トーク**：本についてアバター（Emma / Leo）と英語でディスカッション（OpenAI **GPT-Live-1**）
  - 「Can you save that word?」と頼むと単語帳に保存
  - 💡ヒント／🐢ゆっくり ボタン
  - 終了後、AI が単語・フレーズの抽出と英語のフィードバックを作成
- 🗂️ **単語帳**：トークで学んだ語がたまるオリジナル単語帳（発音再生つき）
- 🏆 **学習**：フラッシュカード（間隔反復）、スピードクイズ、リスニング＆スペル。XP・レベル・連続学習・バッジ

## 使い方

1. 「設定」で OpenAI API キーを入力（このブラウザの localStorage にだけ保存されます）
2. 「本棚」で本を追加 → 「この本についてトーク」

データはすべてブラウザ内に保存されます。「設定 › エクスポート」で定期的にバックアップしてください。

> ⚠️ GPT-Live には一時キー（ephemeral key）の仕組みがないため、ブラウザから直接 API キーを使って接続しています。**個人利用専用**です。他の人に使ってもらう場合は、キーをサーバー側に置く構成（例: Cloudflare Workers）が必要です。

## ローカルで動かす

```bash
python3 -m http.server 8765
```

http://localhost:8765 を開く。

## 構成

ビルド不要の静的サイト（HTML / CSS / ES Modules）。GitHub Pages にそのまま公開できます。

```
index.html
css/style.css
js/app.js       ルーター
js/store.js     データ保存・XP・間隔反復
js/books.js     本棚・カレンダー
js/talk.js      トーク画面
js/live.js      GPT-Live WebRTC クライアント / Responses API
js/avatars.js   アバター
js/words.js     単語帳
js/play.js      ゲーム・ダッシュボード
js/settings.js  設定
```
