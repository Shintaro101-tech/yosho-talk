# 洋書トーク ブランド素材

洋書ラジオの黄色と濃い青を引き継ぎ、「本＋吹き出し」で読書と会話を表現しました。

## 使用するファイル

|用途|ファイル|サイズ|
|---|---|---|
|ヘッダーロゴ・透過|logo-horizontal.svg / logo-horizontal.png|1024×220|
|暗い背景用の白いロゴ・透過|logo-horizontal-white.png|1024×220|
|文字なしマーク・透過|logo-mark.svg / logo-mark.png|512×512 PNG|
|アプリアイコン|app-icon-192.png / app-icon-512.png / app-icon-1024.png|各192 / 512 / 1024角|
|名称入り正方形画像|icon-with-name.png|1024×1024|
|Appleホーム画面用|apple-touch-icon.png|180×180|
|ブラウザタブ用|favicon.ico / favicon-16.png / favicon-32.png / favicon-48.png|16 / 32 / 48角。ICOは32角|
|横長バナー|banner.png|1600×600|
|SNS共有カード|og-image.png|1200×630|
|素材一覧|preview.png|1600×1160|

SVGの文字はアウトライン化してあり、閲覧側のフォントに依存しません。透過ロゴ・パーツ以外の背景は不透明です。アプリアイコンの角丸はOS側に任せる仕様です。

## 配色

- イエロー: #F6C21C
- 濃い青: #063C4F
- クリーム: #FFF9E3

## アプリへの組み込み例

このフォルダを assets/brand として置いた場合:

```html
<link rel="icon" href="assets/brand/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="assets/brand/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="assets/brand/apple-touch-icon.png">
<meta property="og:title" content="洋書トーク — Read, Talk, Learn">
<meta property="og:description" content="読んだ本を、英語で話そう。">
<!-- 公開URLの絶対URLに置き換えて設定 -->
<meta property="og:image" content="https://YOUR-DOMAIN/assets/brand/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<img src="assets/brand/logo-horizontal.svg" alt="洋書トーク" width="256" height="55">
```

manifest-icons.jsonはPWAのmanifestに転記するためのアイコン定義です。これだけでPWA機能が有効になるものではありません。

既存のassets/icon.png、assets/apple-touch-icon.png、assets/banner.jpg、およびアプリのコードは変更していません。
