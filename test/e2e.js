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

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'futari-e2e-'));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
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
  await B.click('[data-tab=shopping]');
  await B.fill('input[name=name]', 'たまご'); await B.press('input[name=name]', 'Enter');

  // A がコードを作る
  await A.click('[data-tab=settings]');
  await A.click('[data-act=create-room]');
  await A.waitForSelector('.code');
  const code = (await A.locator('.code').innerText()).trim();
  console.log('code', code);

  // B が参加（小文字・ハイフン付きでも OK）
  await B.click('[data-tab=settings]');
  await B.fill('input[name=room]', code.toLowerCase());
  await B.click('form[data-form=join] button');
  await B.waitForSelector('.code');
  await wait(800);
  assert.match(await B.locator('#me-toggle').innerText(), /ゆき/);
  await B.click('[data-tab=events]');
  assert.match(await B.locator('main').innerText(), /結婚記念日/);
  await A.click('[data-tab=shopping]');
  await A.waitForFunction(() => document.querySelector('main').innerText.includes('たまご'), null, { timeout: 5000 });
  console.log('✓ pairing merge');

  // リアルタイム
  await B.click('[data-tab=shopping]');
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
  await A.click('[data-tab=chores]'); await B.click('[data-tab=chores]');
  await Promise.all([A.click('[data-act=done-chore][data-id=c4]'), B.click('[data-act=done-chore][data-id=c4]')]);
  await wait(1500);
  const pts = await A.locator('.legend').first().innerText();
  console.log('balance', pts.replace(/\n/g, ' '));
  assert.match(pts, /ひろ 3pt/); assert.match(pts, /ゆき 2pt/);
  console.log('✓ concurrent completes');

  // オフライン中の変更は復帰後に届く
  await cb.setOffline(true);
  await B.click('[data-tab=thanks]');
  await B.fill('textarea', 'いつもありがとう'); await B.click('form[data-form=thanks] .btn');
  await wait(1000);
  await A.click('[data-tab=home]');
  assert.ok(!(await A.locator('main').innerText()).includes('いつもありがとう'));
  await cb.setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  await A.waitForFunction(() => document.querySelector('main').innerText.includes('いつもありがとう'), null, { timeout: 8000 });
  console.log('✓ offline queue');

  // 名前の変更
  await B.click('[data-tab=settings]');
  await B.fill('input[name=b]', 'ゆきちゃん'); await B.click('form[data-form=names] .btn');
  await A.waitForFunction(() => document.body.innerText.includes('ゆきちゃん'), null, { timeout: 5000 });
  console.log('✓ names');

  await A.reload(); await wait(800);
  assert.ok(await A.locator('.sync-dot.ok').count());

  console.log('errors', A.errs, B.errs);
  assert.deepStrictEqual([...A.errs, ...B.errs], []);
  console.log('ALL OK');
  await b.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
