// ふたつのブラウザ（＝ふたりのスマホ）で同期を確かめる E2E テスト
// 実行: npm run test:e2e （playwright が必要）
const { chromium } = require('playwright');
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 19000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}/`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const SUBPAGES = ['events', 'budget', 'notes', 'settings'];
async function nav(P, t) {
  if (SUBPAGES.includes(t)) { await P.click('[data-tab=more]'); await P.click(`[data-goto=${t}]`); }
  else await P.click(`[data-tab=${t}]`);
}
const text = P => P.locator('main').innerText();
const until = (P, fn, arg) => P.waitForFunction(fn, arg, { timeout: 5000 });

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'futari-e2e-'));
  // Claude API の代わりにレシートの読み取り結果を返す偽サーバー
  const mock = require('http').createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: JSON.stringify({ is_receipt: true, store: 'ドラッグストア', date: '2026-09-20', total: 1980, items: [{ name: '洗剤', price: 498 }] }) }],
      }));
    });
  });
  await new Promise(r => mock.listen(PORT + 1000, r));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT + 1000}` },
  });
  await new Promise(r => server.stdout.once('data', r));
  const b = await chromium.launch();
  const mk = async () => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    p.on('dialog', d => d.accept());
    await p.goto(URL); return [ctx, p];
  };
  // v1 からの移行: A は旧データを持っている
  const [ca, A] = await mk();
  await A.evaluate(() => { localStorage.clear(); localStorage.setItem('futari-data-v1', JSON.stringify({
    settings: { names: { a: 'ひろ', b: 'ゆき' }, me: 'a' },
    chores: [{ id: 'c1', title: '食器洗い', assignee: 'a', every: 1, points: 1, lastDone: 1 }],
    log: [{ id: 'l1', choreId: 'c1', title: '食器洗い', by: 'a', at: Date.now() - 3600e3, points: 1 }],
    shopping: [], thanks: [], events: [{ id: 'e1', title: '結婚記念日', date: '2020-10-10', yearly: true }] })); });
  await A.reload();
  assert.match(await A.locator('#me-toggle').innerText(), /ひろ/);

  const [cb, B] = await mk();
  await B.evaluate(() => localStorage.clear()); await B.reload();
  // B はつなぐ前に買い物を追加しておく
  await nav(B, 'shopping');
  await B.fill('input[name=name]', 'たまご'); await B.press('input[name=name]', 'Enter');

  // A がコードを作る
  await nav(A, 'settings');
  await A.click('[data-act=create-room]');
  await A.waitForSelector('.code');
  const code = (await A.locator('.code').innerText()).trim();
  console.log('code', code);

  // B が参加（小文字・ハイフン付きでも OK）
  await nav(B, 'settings');
  await B.fill('input[name=room]', code.toLowerCase());
  await B.click('form[data-form=join] button');
  await B.waitForSelector('.code');
  await wait(800);
  assert.match(await B.locator('#me-toggle').innerText(), /ゆき/);
  await nav(B, 'events');
  assert.match(await B.locator('main').innerText(), /結婚記念日/);
  await nav(A, 'shopping');
  await A.waitForFunction(() => document.querySelector('main').innerText.includes('たまご'), null, { timeout: 5000 });
  console.log('✓ pairing merge');

  // リアルタイム
  await nav(B, 'shopping');
  await A.fill('input[name=name]', '牛乳'); await A.press('input[name=name]', 'Enter');
  await B.waitForFunction(() => document.querySelector('main').innerText.includes('牛乳'), null, { timeout: 5000 });
  console.log('✓ realtime add');

  // 入力中は消えない
  await B.click('input[name=name]'); await B.type('input[name=name]', 'パ');
  await A.fill('input[name=name]', 'バター'); await A.press('input[name=name]', 'Enter');
  await wait(1500);
  assert.strictEqual(await B.inputValue('input[name=name]'), 'パ');
  await B.type('input[name=name]', 'ン'); await B.press('input[name=name]', 'Enter');
  await wait(300);
  const bText = await B.locator('main').innerText();
  assert.ok(bText.includes('バター') && bText.includes('パン'), bText);
  console.log('✓ typing preserved');

  // 完了/削除の伝播
  const eggId = await B.locator('li', { hasText: 'たまご' }).locator('[data-act=del-shop]').getAttribute('data-id');
  await B.click(`[data-act=toggle-shop][data-id="${eggId}"]`);
  await A.waitForSelector(`[data-act=toggle-shop][data-id="${eggId}"].on`, { timeout: 5000 });
  await A.click('[data-act=clear-shop]');
  await B.waitForFunction(() => !document.querySelector('main').innerText.includes('たまご'), null, { timeout: 5000 });
  console.log('✓ toggle & delete');

  // ふたり同時に同じ家事を完了 → 両方の記録が残る
  await nav(A, 'chores'); await nav(B, 'chores');
  await Promise.all([A.click('[data-act=done-chore][data-id=c4]'), B.click('[data-act=done-chore][data-id=c4]')]);
  await wait(1500);
  const pts = await A.locator('.legend').first().innerText();
  console.log('balance', pts.replace(/\n/g, ' '));
  assert.match(pts, /ひろ 3pt/); assert.match(pts, /ゆき 2pt/);
  console.log('✓ concurrent completes');

  // オフライン中の変更は復帰後に届く
  await cb.setOffline(true);
  await nav(B, 'futari');
  await B.fill('textarea', 'いつもありがとう'); await B.click('form[data-form=thanks] .btn');
  await wait(1000);
  await nav(A, 'home');
  assert.ok(!(await A.locator('main').innerText()).includes('いつもありがとう'));
  await cb.setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  await A.waitForFunction(() => document.querySelector('main').innerText.includes('いつもありがとう'), null, { timeout: 8000 });
  console.log('✓ offline queue');

  // 名前の変更
  await nav(B, 'settings');
  await B.fill('input[name=b]', 'ゆきちゃん'); await B.click('form[data-form=names] .btn');
  await A.waitForFunction(() => document.body.innerText.includes('ゆきちゃん'), null, { timeout: 5000 });
  console.log('✓ names');

  // ---------- v3 の機能 ----------
  // よくある家事から追加 → 曜日指定に編集 → 相手の端末に届く
  await nav(A, 'chores');
  await A.click('[data-act=preset-cat][data-id="3"]'); // ゴミ
  await A.click('li:has-text("燃えるゴミ出し") [data-act=add-preset]');
  await A.click('li:has-text("燃えるゴミ出し") [data-act=edit-chore]');
  const edit = A.locator('.card.hint form[data-form=chore]');
  await edit.locator('select[name=assignee]').selectOption('b');
  await edit.locator('select[name=rotate]').selectOption('each');
  for (const d of ['1', '4']) await edit.locator(`input[name=days][value="${d}"]`).check({ force: true });
  await edit.locator('button.btn:has-text("保存")').click();
  const garbage = A.locator('li:has-text("燃えるゴミ出し")').first();
  assert.match(await garbage.innerText(), /毎週月・木/);
  assert.match(await garbage.innerText(), /毎回交代/);
  await nav(B, 'chores');
  await until(B, () => document.querySelector('main').innerText.includes('毎週月・木'));
  console.log('✓ preset + weekday + rotation');

  // 相手の担当を代わりにやる → 相手のホームに「ありがとうを送る」
  await nav(A, 'chores');
  await A.click('[data-act=done-chore][data-id=c3]'); // 洗濯（ゆきの担当）
  await nav(B, 'home');
  await until(B, () => document.querySelector('main').innerText.includes('代わりにやってくれました'));
  await B.click('[data-act=thank-cover]');
  assert.ok(!(await text(B)).includes('代わりにやってくれました'));
  await nav(A, 'futari');
  await until(A, () => document.querySelector('main').innerText.includes('代わりに「洗濯」をやってくれてありがとう'));
  console.log('✓ cover + thanks');

  // リアクション
  await A.click('li:has-text("代わりに「洗濯」") [data-act=react][data-r="❤️"]');
  await nav(B, 'futari');
  await until(B, () => document.querySelector('main').innerText.includes('から ❤️'));
  console.log('✓ reaction');

  // お願い: B → A、A が引き受けて完了、B がありがとう
  await B.fill('form[data-form=request] input[name=text]', '電球を替えてほしい');
  await B.click('form[data-form=request] .btn');
  await nav(A, 'home');
  await until(A, () => document.querySelector('main').innerText.includes('からのお願い 1件'));
  await nav(A, 'futari');
  await A.click('[data-act=req-accept]');
  await A.click('[data-act=req-done]');
  await until(B, () => !!document.querySelector('[data-act=req-thanks]'));
  await B.click('[data-act=req-thanks]');
  await until(A, () => document.querySelector('main').innerText.includes('「電球を替えてほしい」をやってくれてありがとう'));
  const summary = await A.locator('table.summary').innerText();
  assert.match(summary, /お願いに応えた\s+1回\s+0回/, summary);
  console.log('✓ requests + weekly summary');

  // 在庫 → 買い物リスト → 買ったら在庫が戻る
  await nav(A, 'shopping');
  await A.fill('form[data-form=stock] input[name=name]', '洗濯洗剤');
  await A.click('form[data-form=stock] .btn');
  await A.click('li:has-text("洗濯洗剤") [data-act=toggle-stock]');
  await nav(B, 'shopping');
  await until(B, () => [...document.querySelectorAll('[data-act=toggle-shop]')].some(b => b.closest('li').innerText.includes('洗濯洗剤')));
  await B.click('li:has-text("洗濯洗剤") [data-act=toggle-shop]');
  await until(A, () => document.querySelector('li .stock-btn') && !document.querySelector('.stock-btn.low'));
  console.log('✓ stock');

  // 家計簿: A が 3000円（半分ずつ）、B が 1000円（立て替え）→ 差し引き ゆき → ひろ 500円 → 精算
  await nav(A, 'budget');
  await A.fill('form[data-form=expense] input[name=title]', 'スーパー');
  await A.fill('form[data-form=expense] input[name=amount]', '3000');
  await A.click('form[data-form=expense] .btn');
  await nav(B, 'budget');
  await B.fill('form[data-form=expense] input[name=title]', '薬');
  await B.fill('form[data-form=expense] input[name=amount]', '1000');
  await B.selectOption('form[data-form=expense] select[name=split]', 'other');
  await B.click('form[data-form=expense] .btn');
  await until(A, () => document.querySelector('main').innerText.includes('¥500'));
  assert.match(await text(A), /ゆきちゃん → ひろ ¥500/);
  await A.click('[data-act=settle]');
  await until(B, () => document.querySelector('main').innerText.includes('貸し借りはありません'));
  console.log('✓ budget');

  // レシート読み取り → フォームに入る → 記録
  await A.setInputFiles('input[data-act=receipt]', path.join(__dirname, '..', 'app', 'icon-192.png'));
  await until(A, () => document.querySelector('form[data-form=expense] input[name=title]')?.value === 'ドラッグストア');
  assert.strictEqual(await A.inputValue('form[data-form=expense] input[name=amount]'), '1980');
  assert.strictEqual(await A.inputValue('form[data-form=expense] input[name=date]'), '2026-09-20');
  assert.match(await text(A), /洗剤/);
  await A.click('form[data-form=expense] .btn');
  await until(B, () => document.querySelector('main').innerText.includes('ドラッグストア'));
  console.log('✓ receipt');

  // カレンダー用URL
  await nav(A, 'events');
  await A.click('[data-act=cal-create]');
  const webcal = await A.getAttribute('a[href^="webcal:"]', 'href');
  const google = await A.getAttribute('a[href^="https://calendar.google.com"]', 'href');
  assert.ok(google.includes(encodeURIComponent(webcal)));
  const icsText = await (await fetch(webcal.replace(/^webcal:/, 'http:'))).text();
  assert.match(icsText, /BEGIN:VCALENDAR/);
  assert.match(icsText, /結婚記念日/);
  await A.check('input[data-act=cal-chores]');
  const withChores = await A.getAttribute('a[href^="webcal:"]', 'href');
  assert.match(await (await fetch(withChores.replace(/^webcal:/, 'http:'))).text(), /燃えるゴミ出し/);
  console.log('✓ calendar');

  // 共有メモ
  await nav(A, 'notes');
  await A.fill('form[data-form=note] input[name=title]', 'Wi-Fi');
  await A.fill('form[data-form=note] textarea', 'パスワード: futari123');
  await A.click('form[data-form=note] .btn');
  await nav(B, 'notes');
  await until(B, () => document.querySelector('main').innerText.includes('Wi-Fi'));
  await B.click('summary:has-text("Wi-Fi")');
  await B.fill('details form textarea', 'パスワード: futari456');
  await B.click('details form .btn:has-text("保存")');
  await A.click('summary:has-text("Wi-Fi")');
  await until(A, () => document.querySelector('details textarea')?.value.includes('456'));
  console.log('✓ notes');

  // 通知の設定カードが表示される（実際の購読はテスト環境ではできない）
  await nav(A, 'settings');
  assert.match(await text(A), /通知/);

  await A.reload(); await wait(800);
  assert.ok(await A.locator('.sync-dot.ok').count());

  console.log('errors', A.errs, B.errs);
  assert.deepStrictEqual([...A.errs, ...B.errs], []);
  console.log('ALL OK');
  await b.close();
  server.kill();
  mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
