// Login / sign-up (#/login), used when accounts are on (cloud.js).

import { $, $$, esc, toast } from './util.js';
import { signIn, signUp, resetPassword, signedIn } from './cloud.js';

let mode = 'login'; // 'login' | 'signup'

export function renderLogin(el) {
  if (signedIn()) { location.hash = '#/books'; return; }
  const draw = (message = '', email = '') => {
    el.innerHTML = `
      <section class="login">
        <img class="login-logo" src="assets/brand/app-icon-192.png" alt="">
        <h1>洋書トーク</h1>
        <p class="tagline">読んだ本を、英語で話そう。</p>
        <div class="seg login-tabs" role="tablist">
          <button data-mode="login" class="${mode === 'login' ? 'on' : ''}">ログイン</button>
          <button data-mode="signup" class="${mode === 'signup' ? 'on' : ''}">新規登録</button>
        </div>
        <form class="card form login-form">
          ${mode === 'signup' ? `
          <label>あなたの呼び名（アバターがこの名前で呼びます）<input name="name" maxlength="30" required placeholder="例: Shin" autocomplete="given-name"></label>` : ''}
          <label>メールアドレス<input name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(email)}"></label>
          <label>パスワード${mode === 'signup' ? '（6文字以上）' : ''}<input name="password" type="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
          ${message ? `<p class="mini login-msg">${message}</p>` : ''}
          <button class="btn btn-primary btn-lg">${mode === 'signup' ? '登録する' : 'ログイン'}</button>
          ${mode === 'login' ? '<button type="button" class="link-btn" id="forgot">パスワードを忘れた場合</button>' : ''}
        </form>
        <p class="mini muted login-note">本棚・単語帳・トークの記録はアカウントに保存され、スマホとパソコンなど、どの端末からでも同じデータを使えます。</p>
      </section>`;
    $$('[data-mode]', el).forEach((b) => (b.onclick = () => { mode = b.dataset.mode; draw(); }));
    const form = $('.login-form', el);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('.btn-primary');
      btn.disabled = true;
      const email = form.email.value.trim();
      try {
        if (mode === 'signup') {
          const r = await signUp(email, form.password.value, form.name.value.trim());
          if (r === 'confirm') { mode = 'login'; draw(`📩 ${esc(email)} に確認メールを送りました。メールのリンクを開いてから、ログインしてください。`, email); return; }
          toast('登録しました！', 'success');
        } else {
          await signIn(email, form.password.value);
        }
        mode = 'login'; // the next time this page is shown (after logging out)
        location.hash = '#/books';
      } catch (err) {
        draw(`<span class="ng">${esc(err.message)}</span>`, email);
      }
    };
    $('#forgot', el)?.addEventListener('click', async () => {
      const email = form.email.value.trim() || prompt('登録したメールアドレスを入力してください');
      if (!email) return;
      try {
        await resetPassword(email);
        draw(`📩 ${esc(email)} にパスワード再設定のメールを送りました。メールのリンクを開くと、新しいパスワードを決められます。`, email);
      } catch (err) {
        draw(`<span class="ng">${esc(err.message)}</span>`, email);
      }
    });
  };
  draw();
}
