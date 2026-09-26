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
// 画面の移動: タブ、設定（右上の歯車）、「ふたり」タブの中の切り替え
const FUTARI = { futari: 'thanks', thanks: 'thanks', requests: 'requests', events: 'events', wishes: 'wishes', notes: 'notes' };
// 行を横にスワイプする（dx > 0 で右）
async function swipeRow(P, title, dx) {
  const box = await P.locator('main li', { has: P.locator('.title', { hasText: title }) }).first().boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await P.mouse.move(x, y); await P.mouse.down();
  for (let i = 1; i <= 8; i++) await P.mouse.move(x + (dx * i) / 8, y);
  await P.mouse.up();
}
const rowTitles = P => P.evaluate(() => [...document.querySelectorAll('main li .title')].map(t => t.innerText.trim()));
async function nav(P, t) {
  if (t === 'settings') await P.click('#settings-btn');
  else if (FUTARI[t]) { await P.click('[data-tab=futari]'); await P.click(`[data-goto="futari/${FUTARI[t]}"]`); }
  else await P.click(`[data-tab=${t}]`);
}
const me = P => P.evaluate(() => JSON.parse(localStorage.getItem('futari-device-v2')).me);
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
  // 使っていたデータがあるので、はじめての案内は出ない
  assert.ok(await A.locator('#onboard').isHidden());
  assert.strictEqual(await me(A), 'a');

  const [cb, B] = await mk();
  await B.evaluate(() => localStorage.clear()); await B.reload();
  // 新しい端末では案内が出る → スキップ
  await B.waitForSelector('#onboard .ob-panel');
  await B.click('#onboard [data-act=ob-skip]');
  assert.ok(await B.locator('#onboard').isHidden());
  // B はつなぐ前に買い物を追加しておく
  await nav(B, 'shopping');
  await B.fill('input[name=name]', 'たまご'); await B.press('input[name=name]', 'Enter');

  // A が設定から招待リンクを作る
  await nav(A, 'settings');
  await A.click('main [data-act=share-invite]');
  await A.waitForSelector('.code');
  const code = (await A.locator('.code').innerText()).trim().replace('-', '');
  console.log('code', code);

  // B が招待リンクを開く → 自動で参加 → 「あなたはどちら？」
  await B.goto(`${URL}#join=${code}`);
  await B.waitForSelector('#onboard .who');
  await until(B, () => document.querySelector('#onboard').innerText.includes('ゆき'));
  assert.match(await B.locator('#onboard .chip.on').innerText(), /ゆき/);
  await B.click('#onboard [data-act=ob-step][data-id=notify]');
  await B.click('#onboard [data-act=ob-step][data-id=done]');
  await B.click('#onboard [data-act=ob-done]');
  assert.strictEqual(await me(B), 'b');
  await nav(B, 'events');
  assert.match(await B.locator('main').innerText(), /結婚記念日/);
  await nav(A, 'shopping');
  await A.waitForFunction(() => document.querySelector('main').innerText.includes('たまご'), null, { timeout: 5000 });
  console.log('✓ invite link + pairing merge');

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
  await B.waitForFunction(() => ![...document.querySelectorAll('main li .title')].some(t => t.innerText === 'たまご'), null, { timeout: 5000 });
  // 消したものは「いつもの」から1タップで戻せる
  assert.ok(await B.locator('[data-act=shop-suggest]:has-text("たまご")').count());
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
  await until(B, () => document.querySelector('main').innerText.includes('代わりに「洗濯」をやってくれました'));
  await B.click('[data-act=thank-cover]');
  assert.ok(!(await text(B)).includes('代わりに「洗濯」をやってくれました'));
  await nav(A, 'thanks');
  await until(A, () => document.querySelector('main').innerText.includes('代わりに「洗濯」をやってくれてありがとう'));
  console.log('✓ cover + thanks');

  // リアクション
  await A.click('li:has-text("代わりに「洗濯」") [data-act=react][data-r="❤️"]');
  await nav(B, 'thanks');
  await until(B, () => !!document.querySelector('main li .muted .react-ic'));
  console.log('✓ reaction');

  // お願い: B → A、A が引き受けて完了、B がありがとう
  await nav(B, 'requests');
  await B.fill('form[data-form=request] input[name=text]', '電球を替えてほしい');
  await B.click('form[data-form=request] .btn');
  await nav(A, 'home');
  await until(A, () => document.querySelector('main').innerText.includes('ゆきちゃんからのお願い'));
  assert.match(await A.locator('.tabs').innerText(), /ふたり/);
  await nav(A, 'requests');
  assert.strictEqual(await A.locator('.seg.on .dot-count').innerText(), '1');
  await A.click('[data-act=req-accept]');
  await A.click('[data-act=req-done]');
  await until(B, () => !!document.querySelector('[data-act=req-thanks]'));
  await B.click('[data-act=req-thanks]');
  await nav(A, 'thanks');
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

  // ＋ボタン: 買い物・家事・ありがとう・レシート
  await nav(B, 'home');
  await B.click('#fab');
  await B.click('#sheet [data-act=sheet][data-id=shop]');
  await B.fill('#sheet input[name=name]', 'ヨーグルト'); await B.press('#sheet input[name=name]', 'Enter');
  assert.ok(await B.locator('#sheet').isHidden());
  await nav(A, 'shopping');
  await until(A, () => document.querySelector('main').innerText.includes('ヨーグルト'));
  await B.click('#fab');
  await B.click('#sheet [data-act=sheet][data-id=chore]');
  await B.click('#sheet [data-act=done-chore][data-id=c1]');
  await nav(A, 'chores');
  await until(A, () => [...document.querySelectorAll('main li')].some(li => /食器洗い/.test(li.innerText) && /ゆきちゃん/.test(li.innerText) && li.querySelector('[data-act=undo-log]')));
  await B.click('#fab');
  await B.click('#sheet [data-act=sheet][data-id=thanks]');
  await B.fill('#sheet textarea', 'ゴミ出しありがとう'); await B.click('#sheet .btn');
  await nav(A, 'thanks');
  await until(A, () => document.querySelector('main').innerText.includes('ゴミ出しありがとう'));
  await B.click('#fab');
  await B.setInputFiles('#sheet input[data-act=receipt]', path.join(__dirname, '..', 'app', 'icon-192.png'));
  await until(B, () => document.querySelector('form[data-form=expense] input[name=title]')?.value === 'ドラッグストア');
  assert.strictEqual(await B.locator('.tabs button.active').getAttribute('data-tab'), 'budget');
  console.log('✓ quick add (+)');

  // ---------- v5: 便利機能 ----------
  // 今から帰る → 相手の「今日」に表示
  await nav(B, 'home');
  await B.click('#fab'); await B.click('#sheet [data-act=sheet][data-id=home]');
  await B.click('#sheet [data-act=ping][data-id="20"]');
  assert.ok(await B.locator('#sheet').isHidden());
  await nav(A, 'home');
  await until(A, () => document.querySelector('main').innerText.includes('ゆきちゃんが今から帰ってきます'));
  console.log('✓ coming home');

  // 気分: 相手が「疲れた」→ 気づかいのひとこと
  await B.click('main [data-act=mood][data-id=tired]');
  await until(A, () => document.querySelector('.partner-mood')?.innerText.includes('疲れた'));
  assert.match(await A.locator('.partner-mood').innerText(), /代わってみては/);
  console.log('✓ mood');

  // 晩ごはん: ふたりが同じものを選ぶと決まる
  await A.click('main .tile[data-id=dinner]');
  await A.fill('#sheet form[data-form=dinner] input[name=name]', 'カレー'); await A.press('#sheet form[data-form=dinner] input[name=name]', 'Enter');
  await B.click('main .tile[data-id=dinner]');
  await until(B, () => !!document.querySelector('#sheet .dish[data-name="カレー"] .p-mark'));
  await B.click('#sheet [data-act=dinner-vote][data-name="カレー"]');
  await until(A, () => document.querySelector('#sheet .match')?.innerText.includes('カレー'));
  await A.click('#sheet .sheet-head [data-act=sheet-close]'); await B.click('#sheet .sheet-head [data-act=sheet-close]');
  await until(A, () => document.querySelector('main').innerText.includes('今夜は「カレー」'));
  console.log('✓ dinner');

  // 買い物: 売り場ごと・スワイプ・元に戻す
  await nav(A, 'shopping');
  for (const n of ['豚こま', 'キャベツ']) { await A.fill('main form[data-form=shop] input', n); await A.press('main form[data-form=shop] input', 'Enter'); }
  const labels = await A.locator('main .group-label').allInnerTexts();
  assert.ok(labels.indexOf('野菜・果物') >= 0 && labels.indexOf('野菜・果物') < labels.indexOf('肉・魚'), labels.join(','));
  await swipeRow(A, 'キャベツ', 160);
  await until(A, () => [...document.querySelectorAll('main li.done .title')].some(t => t.innerText.trim() === 'キャベツ'));
  await swipeRow(A, '豚こま', -160);
  await A.waitForSelector('.toast-btn');
  assert.ok(!(await rowTitles(A)).includes('豚こま'));
  await A.click('.toast-btn');
  await until(A, () => [...document.querySelectorAll('main li .title')].some(t => t.innerText.trim() === '豚こま'));
  await nav(B, 'shopping');
  await until(B, () => [...document.querySelectorAll('main li .title')].some(t => t.innerText.trim() === '豚こま'));
  console.log('✓ shopping groups + swipe + undo');

  // 家計簿: 毎月の固定費 → 今月分が自動で記録される（ふたりの端末でも1件だけ）・カテゴリ別
  await nav(A, 'budget');
  await A.fill('form[data-form=recurring] input[name=title]', '家賃');
  await A.fill('form[data-form=recurring] input[name=amount]', '80000');
  await A.fill('form[data-form=recurring] input[name=day]', '1');
  await A.click('form[data-form=recurring] .btn');
  await until(A, () => [...document.querySelectorAll('main li .title')].filter(t => t.innerText.trim() === '家賃').length === 2); // 固定費の一覧 + 今月の記録
  await nav(B, 'budget');
  await until(B, () => [...document.querySelectorAll('main li .title')].filter(t => t.innerText.trim() === '家賃').length === 2);
  await wait(1000);
  assert.strictEqual((await rowTitles(B)).filter(t => t === '家賃').length, 2);
  assert.match(await A.locator('.cat-bars').innerText(), /住まい・光熱/);
  console.log('✓ recurring + chart');

  // 行きたい → 記念日が近いと提案
  await nav(A, 'wishes');
  await A.click('main .chip-radio:has-text("おでかけ")');
  await A.fill('main form[data-form=wish] input[name=title]', '箱根温泉');
  await A.click('main form[data-form=wish] .btn');
  await nav(B, 'wishes');
  await until(B, () => document.querySelector('main').innerText.includes('箱根温泉'));
  await nav(A, 'events');
  const soon = new Date(Date.now() + 5 * 864e5);
  await A.fill('main form[data-form=event] input[name=title]', 'ゆきの誕生日');
  await A.fill('main form[data-form=event] input[name=date]', `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`);
  await A.click('main form[data-form=event] .btn');
  assert.match(await A.locator('main .card.hint').first().innerText(), /箱根温泉/);
  console.log('✓ wishes');

  // 「今日」タブの数字（対応することの数）: 家事を終えると減る
  await nav(A, 'home');
  const badge = () => A.evaluate(() => Number(document.querySelector('.tabs .tab-badge')?.textContent || 0));
  const before = await badge();
  assert.ok(before > 0, `badge ${before}`);
  const firstChore = await A.locator('main [data-act=done-chore]').first().getAttribute('data-id');
  await A.click(`main [data-act=done-chore][data-id="${firstChore}"]`);
  assert.strictEqual(await badge(), before - 1);
  console.log('✓ badge', before, '→', before - 1);

  // はじめての案内（招待する側）: 名前 → 招待リンク作成 → 通知 → 完了
  const [, C] = await mk();
  await C.evaluate(() => localStorage.clear()); await C.reload();
  await C.waitForSelector('#onboard form[data-form=ob-names]');
  await C.fill('#onboard input[name=me]', 'けん'); await C.fill('#onboard input[name=partner]', 'さき');
  await C.click('#onboard form[data-form=ob-names] .btn');
  await until(C, () => document.querySelector('#onboard h1').innerText.includes('さきを招待'));
  await C.click('#onboard [data-act=share-invite]');
  await C.waitForSelector('#onboard .invite-url');
  assert.match(await C.locator('#onboard .invite-url').innerText(), /#join=[A-Z2-9]{10}$/);
  await C.click('#onboard [data-act=ob-step][data-id=notify]');
  await C.click('#onboard [data-act=ob-step][data-id=done]');
  await C.click('#onboard [data-act=ob-done]');
  assert.match(await text(C), /今日やること（けん）/);
  await C.reload();
  assert.ok(await C.locator('#onboard').isHidden()); // 2回目は出ない
  assert.deepStrictEqual(C.errs, []);
  console.log('✓ onboarding');

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
