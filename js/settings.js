import { $, esc, toast } from './util.js';
import { data, save, exportJSON, importJSON, resetAll } from './store.js';
import { getPasscode, setPasscode, checkPasscode, ensurePasscode } from './api.js';
import { installApp, isInstalled } from './install.js';
import { CLOUD, currentAccount, userEmail, signOut, deleteAccount, refreshAccount, setPassword } from './cloud.js';

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

    ${CLOUD ? accountSection() : `<section class="card form">
      <h2>🔒 トーク接続</h2>
      <p class="mini muted">トークと単語抽出は、洋書ラジオの中継サーバーを通して OpenAI に接続します。API キーの入力は不要です。初回だけ合言葉が必要です。</p>
      <p>合言葉：<b>${getPasscode() ? '✅ このブラウザに記憶済み' : '未入力'}</b></p>
      <div class="actions-left">
        <button class="btn" id="testConn">🔌 接続テスト</button>
        <button class="btn btn-ghost" id="changePass">${getPasscode() ? '合言葉を入れ直す' : '合言葉を入力'}</button>
        ${getPasscode() ? '<button class="btn btn-ghost danger" id="forgetPass">このブラウザから消す</button>' : ''}
      </div>
    </section>`}

    <section class="card form">
      <h2>💾 データのバックアップ</h2>
      <p class="mini muted">${CLOUD ? 'データはアカウントに保存されています。手元にも残しておきたいときは、エクスポートしてください。' : 'データはこのブラウザ（localStorage）に保存されています。ブラウザのデータを消すと失われるので、ときどきエクスポートしてください。別の端末へ移すときもこのファイルを使います（合言葉は含まれません）。'}</p>
      <div class="actions-left">
        <button class="btn" id="export">⬇️ エクスポート</button>
        <label class="btn">⬆️ インポート<input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn btn-ghost danger" id="reset">すべて初期化</button>
      </div>
      <p class="mini muted">本 ${data.books.length} 冊 ・ 単語 ${data.vocab.length} 語 ・ トーク ${data.talks.length} 回</p>
    </section>

    <p class="about"><a class="btn btn-sm yt-btn" href="https://www.youtube.com/@Youshoradio" target="_blank" rel="noopener">▶ YouTube「洋書ラジオ」を見る</a></p>`;

  $('#install', el)?.addEventListener('click', installApp);
  if (CLOUD) {
    bindAccount(el);
  } else bindPasscode(el);

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

function bindPasscode(el) {
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
}

// ---------------------------------------------------------------- account (Supabase)

function accountSection() {
  const a = currentAccount();
  const u = a?.usage || { talk_seconds: 0 };
  const l = a?.limits || { talk_minutes: 0 };
  return `
    <section class="card form account">
      <h2>👤 アカウント</h2>
      <p><b>${esc(userEmail())}</b></p>
      <p class="mini">プラン：<b>${esc(a?.label || '確認中…')}</b></p>
      ${l.talk_minutes > 0 ? `
      <p class="mini muted">今月のトーク：${Math.floor(u.talk_seconds / 60)} / ${l.talk_minutes}分（辞書・質問は使い放題）</p>`
      : '<p class="mini muted">トーク・フィードバック・辞書・質問は、招待コードを入力すると使えるようになります。</p><div class="row"><button class="btn btn-primary" id="redeem">🎟️ 招待コードを入力</button></div>'}
      <div class="actions-left">
        <button class="btn btn-ghost" id="newPass">パスワードを変更</button>
        <button class="btn" id="logout">ログアウト</button>
      </div>
      <details class="danger-zone">
        <summary>アカウントを削除する</summary>
        <p class="mini muted">アカウントと、本棚・単語帳・トークの記録がすべて削除され、元に戻せません。必要なら先にエクスポートしてください。</p>
        <button class="btn btn-ghost danger" id="deleteAccount">アカウントを削除</button>
      </details>
    </section>`;
}

// The plan and usage are refreshed from the relay once the page is shown.
function bindAccount(el) {
  bindAccountButtons(el);
  refreshAccount().then(() => {
    const box = $('.account', el);
    if (!box) return;
    box.outerHTML = accountSection();
    bindAccountButtons(el);
  }).catch(() => {});
}

function bindAccountButtons(el) {
  $('#redeem', el)?.addEventListener('click', async () => {
    if (await ensurePasscode()) renderSettings(el);
  });
  $('#newPass', el).onclick = async () => {
    const p = prompt('新しいパスワードを入力してください（6文字以上）');
    if (!p) return;
    try { await setPassword(p); toast('パスワードを変更しました', 'success'); } catch (err) { toast(err.message, 'error'); }
  };
  $('#logout', el).onclick = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await signOut();
    location.hash = '#/login';
  };
  $('#deleteAccount', el).onclick = async () => {
    if (!confirm('アカウントとすべてのデータを削除します。元に戻せません。よろしいですか？')) return;
    if (prompt('確認のため「削除」と入力してください') !== '削除') return;
    try {
      await deleteAccount();
      toast('アカウントを削除しました');
      location.hash = '#/login';
    } catch (err) { toast(err.message, 'error'); }
  };
}
