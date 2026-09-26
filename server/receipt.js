'use strict';

// レシート・支払い画面のスクリーンショットから、店名・日付・合計・品目を読み取る（Claude API）。
// 環境変数 ANTHROPIC_API_KEY が設定されていないときは使えない。

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.RECEIPT_MODEL || 'claude-opus-5';
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DAILY_LIMIT_PER_ROOM = Number(process.env.RECEIPT_DAILY_LIMIT) || 30;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    is_receipt: { type: 'boolean', description: 'レシート・領収書・支払い画面なら true' },
    store: { type: 'string', description: '店名・サービス名。わからなければ空文字' },
    date: { type: 'string', description: '支払った日付 YYYY-MM-DD。わからなければ空文字' },
    total: { type: 'integer', description: '支払った合計金額（税込・円）。わからなければ 0' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string' }, price: { type: 'integer' } },
        required: ['name', 'price'],
      },
    },
  },
  required: ['is_receipt', 'store', 'date', 'total', 'items'],
};

const PROMPT = `この画像は、お店のレシート・領収書、またはネットショッピングやキャッシュレス決済の支払い画面のスクリーンショットです。
家計簿に記録するため、次の情報を読み取ってください。
- store: 店名やサービス名（例: イオン、Amazon、PayPay で支払った相手）
- date: 支払った日付（YYYY-MM-DD）。年が書かれていなければ、今日（{today}）に近い年を補ってください
- total: 実際に支払った合計金額（税込、円）。ポイント利用や値引きがあれば、それを引いた後の金額
- items: 品目と金額（最大20件。読み取れなければ空の配列）
支払いに関係のない画像なら is_receipt を false にしてください。読み取れない項目は推測で埋めず、空文字や 0 にしてください。`;

let client = null;
const usage = new Map(); // code -> { day, count }

const validImage = img => !!img && MEDIA_TYPES.has(img.mediaType) && typeof img.data === 'string' && img.data.length > 0;

function configured() { return !!process.env.ANTHROPIC_API_KEY; }

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

// 使いすぎ防止: ルームごとに1日の回数を制限
function allow(code, today) {
  const u = usage.get(code);
  if (!u || u.day !== today) { usage.set(code, { day: today, count: 1 }); return true; }
  if (u.count >= DAILY_LIMIT_PER_ROOM) return false;
  u.count++;
  return true;
}

function sanitize(r) {
  const int = n => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  return {
    is_receipt: !!r.is_receipt,
    store: String(r.store || '').slice(0, 40),
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '',
    total: int(r.total),
    items: (Array.isArray(r.items) ? r.items : []).slice(0, 20)
      .map(i => ({ name: String(i.name || '').slice(0, 40), price: int(i.price) })),
  };
}

// 戻り値: { ok: true, result } または { ok: false, status, error }
async function read({ mediaType, data }, today) {
  if (!validImage({ mediaType, data })) return { ok: false, status: 400, error: 'bad image' };
  if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: 'image too large' };

  let response;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // 安全性の判定で断られたときは、サーバー側で別のモデルに自動で切り替える
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: PROMPT.replace('{today}', today) },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, status: 429, error: 'busy' };
    if (e instanceof Anthropic.AuthenticationError) { console.error('receipt: invalid ANTHROPIC_API_KEY'); return { ok: false, status: 503, error: 'not configured' }; }
    if (e instanceof Anthropic.BadRequestError) { console.error('receipt: bad request', e.message); return { ok: false, status: 400, error: 'bad image' }; }
    if (e instanceof Anthropic.APIError) { console.error('receipt: api error', e.status, e.message); return { ok: false, status: 502, error: 'api error' }; }
    console.error('receipt: failed', e);
    return { ok: false, status: 502, error: 'api error' };
  }

  if (response.stop_reason === 'refusal') return { ok: false, status: 422, error: 'refused' };
  if (response.stop_reason === 'max_tokens') return { ok: false, status: 422, error: 'too long' };
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return { ok: true, result: sanitize(JSON.parse(text)) };
  } catch (e) {
    console.error('receipt: unparsable output');
    return { ok: false, status: 502, error: 'api error' };
  }
}

module.exports = { configured, validImage, allow, read, SCHEMA, MODEL };
