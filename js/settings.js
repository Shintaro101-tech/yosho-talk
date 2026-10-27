import { $, esc, toast } from './util.js';
import { data, save, exportJSON, importJSON, resetAll } from './store.js';
import { getPasscode, setPasscode, checkPasscode, ensurePasscode } from './api.js';
import { installApp, isInstalled } from './install.js';

export function renderSettings(el) {
  const s = data.settings;
  el.innerHTML = `
    <section class="hero"><div><h1>Settings</h1><p class="muted">設定とデータ管理</p></div></section>

    <form class="card form" id="nameForm">
      <h2>👋 あなたの呼び名</h2>
      <p class="mini muted">アバターが会話のなかであなたを呼ぶ名前です（例：Shintaro, Shin, Mr. Horikawa）。</p>
      <div class="row">
        <input name="name" maxlength="30" value="${esc(s.userName || '')}" placeholder="Your name" autocomplete="given-name">
        <button class="btn btn-primary">保存</button>
      </div>
    </form>

    <section class="card form">
      <h2>📲 ホーム画面に追加</h2>
      <p class="mini muted">${isInstalled() ? '✅ ホーム画面のアプリとして開いています。' : 'スマホのホーム画面に「洋書トーク」のアイコンを置いて、アプリのように開けます。'}</p>
      ${isInstalled() ? '' : '<div class="row"><button class="btn btn-primary" id="install">📲 ホーム画面に追加</button></div>'}
    </section>

    <section class="card form">
      <h2>🔒 トーク接続</h2>
      <p class="mini muted">トークと単語抽出は、洋書ラジオの中継サーバーを通して OpenAI に接続します。API キーの入力は不要です。初回だけ合言葉が必要です。</p>
      <p>合言葉：<b>${getPasscode() ? '✅ このブラウザに記憶済み' : '未入力'}</b></p>
      <div class="actions-left">
        <button class="btn" id="testConn">🔌 接続テスト</button>
        <button class="btn btn-ghost" id="changePass">${getPasscode() ? '合言葉を入れ直す' : '合言葉を入力'}</button>
        ${getPasscode() ? '<button class="btn btn-ghost danger" id="forgetPass">このブラウザから消す</button>' : ''}
      </div>
    </section>

    <section class="card form">
      <h2>💾 データのバックアップ</h2>
      <p class="mini muted">データはこのブラウザ（localStorage）に保存されています。ブラウザのデータを消すと失われるので、ときどきエクスポートしてください。別の端末へ移すときもこのファイルを使います（合言葉は含まれません）。</p>
      <div class="actions-left">
        <button class="btn" id="export">⬇️ エクスポート</button>
        <label class="btn">⬆️ インポート<input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn btn-ghost danger" id="reset">すべて初期化</button>
      </div>
      <p class="mini muted">本 ${data.books.length} 冊 ・ 単語 ${data.vocab.length} 語 ・ トーク ${data.talks.length} 回</p>
    </section>

    <section class="card about">
      <img src="assets/brand/app-icon-192.png" alt="洋書トーク">
      <div>
        <h2>洋書トーク <small class="muted">Read, Talk, Learn</small></h2>
        <p class="mini">YouTube「洋書ラジオ」の英語学習アプリ。本の情報は <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a>、トークは OpenAI GPT-Live-1 を利用しています。</p>
        <p><a class="btn btn-sm yt-btn" href="https://www.youtube.com/@Youshoradio" target="_blank" rel="noopener">▶ YouTube「洋書ラジオ」を見る</a></p>
      </div>
    </section>`;

  $('#install', el)?.addEventListener('click', installApp);
  $('#testConn', el).onclick = async (e) => {
    e.target.disabled = true;
    const r = getPasscode() ? await checkPasscode(getPasscode()) : 'wrong';
    e.target.disabled = false;
    if (r === 'ok') toast('接続OK！トークを使えます', 'success');
    else if (r === 'wrong') { setPasscode(''); if (await ensurePasscode()) toast('接続OK！トークを使えます', 'success'); renderSettings(el); }
    else toast(r.slice(6), 'error');
  };
  $('#changePass', el).onclick = async () => {
    if (await ensurePasscode('', true)) toast('保存しました', 'success');
    renderSettings(el);
  };
  $('#forgetPass', el)?.addEventListener('click', () => { setPasscode(''); toast('合言葉を消しました'); renderSettings(el); });

  $('#nameForm', el).onsubmit = (e) => {
    e.preventDefault();
    s.userName = e.target.name.value.trim();
    save();
    toast('保存しました', 'success');
  };

  $('#export', el).onclick = () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yosho-talk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#import', el).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('現在のデータをバックアップの内容で置き換えます。よろしいですか？')) return;
    try {
      importJSON(await file.text());
      toast('インポートしました', 'success');
      renderSettings(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  $('#reset', el).onclick = () => {
    if (!confirm('本・単語・トークの記録をすべて削除します。元に戻せません。よろしいですか？')) return;
    resetAll();
    toast('初期化しました');
    renderSettings(el);
  };
}
