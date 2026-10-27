import { $, esc, toast } from './util.js';
import { data, save, getApiKey, setApiKey, exportJSON, importJSON, resetAll } from './store.js';

export function renderSettings(el) {
  const s = data.settings;
  const key = getApiKey();
  el.innerHTML = `
    <section class="hero"><div><h1>Settings</h1><p class="muted">設定とデータ管理</p></div></section>

    <form class="card form" id="apiForm">
      <h2>🔑 OpenAI API</h2>
      <p class="mini muted">トーク（GPT-Live-1）と単語抽出に使います。キーはこのブラウザの中だけに保存され、OpenAI 以外には送信されません。
      <b>個人利用専用</b>です。このページのURLを他の人と共有しても、キーは共有されません。</p>
      <label>API キー
        <div class="row">
          <input type="password" name="apiKey" value="${esc(key)}" placeholder="sk-..." autocomplete="off">
          <button type="button" class="btn btn-ghost" id="toggleKey">表示</button>
        </div>
      </label>
      <details>
        <summary class="mini">詳細設定</summary>
        <label>バックエンドモデル（単語保存・抽出・フィードバック用）
          <input name="backendModel" value="${esc(s.backendModel)}">
        </label>
        <label>API ベースURL（通常は変更不要。CORS エラー時にプロキシを指定）
          <input name="apiBase" value="${esc(s.apiBase)}">
        </label>
      </details>
      <div class="actions-left">
        <button class="btn btn-primary">保存</button>
        ${key ? '<button type="button" class="btn btn-ghost danger" id="clearKey">キーを削除</button>' : ''}
      </div>
    </form>

    <form class="card form" id="goalForm">
      <h2>🎯 学習目標</h2>
      <label>1日の目標 XP
        <select name="dailyGoal">
          ${[20, 50, 100, 200].map((n) => `<option ${+s.dailyGoal === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <p class="mini muted">XP の目安：本の登録 +20 ／ 読了 +50 ／ トーク1分 +10 ／ 単語追加 +3 ／ 復習1枚 +2</p>
      <div class="actions-left"><button class="btn btn-primary">保存</button></div>
    </form>

    <section class="card form">
      <h2>💾 データのバックアップ</h2>
      <p class="mini muted">データはこのブラウザ（localStorage）に保存されています。ブラウザのデータを消すと失われるので、ときどきエクスポートしてください。別の端末へ移すときもこのファイルを使います（API キーは含まれません）。</p>
      <div class="actions-left">
        <button class="btn" id="export">⬇️ エクスポート</button>
        <label class="btn">⬆️ インポート<input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn btn-ghost danger" id="reset">すべて初期化</button>
      </div>
      <p class="mini muted">本 ${data.books.length} 冊 ・ 単語 ${data.vocab.length} 語 ・ トーク ${data.talks.length} 回</p>
    </section>

    <section class="card about">
      <img src="assets/icon.png" alt="洋書ラジオ">
      <div>
        <h2>洋書トーク <small class="muted">Read, Talk, Learn</small></h2>
        <p class="mini">YouTube「洋書ラジオ」の英語学習アプリ。本の情報は <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a>、トークは OpenAI GPT-Live-1 を利用しています。</p>
      </div>
    </section>`;

  const apiForm = $('#apiForm', el);
  $('#toggleKey', el).onclick = (e) => {
    const inp = apiForm.apiKey;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    e.target.textContent = inp.type === 'password' ? '表示' : '隠す';
  };
  apiForm.onsubmit = (e) => {
    e.preventDefault();
    setApiKey(apiForm.apiKey.value);
    s.backendModel = apiForm.backendModel.value.trim() || 'gpt-5.5';
    s.apiBase = apiForm.apiBase.value.trim().replace(/\/$/, '') || 'https://api.openai.com';
    save();
    toast('保存しました', 'success');
    renderSettings(el);
  };
  $('#clearKey', el)?.addEventListener('click', () => { setApiKey(''); toast('キーを削除しました'); renderSettings(el); });

  $('#goalForm', el).onsubmit = (e) => {
    e.preventDefault();
    s.dailyGoal = +e.target.dailyGoal.value;
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
    if (!confirm('本・単語・トーク・XP をすべて削除します。元に戻せません。よろしいですか？')) return;
    resetAll();
    toast('初期化しました');
    renderSettings(el);
  };
}
