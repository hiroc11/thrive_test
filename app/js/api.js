// サーバーとのやりとり。ログイン用トークンはこの端末にだけ保存する
const KEY = 'puku-token';
export const token = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} }
};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(method, path, body) {
  const t = token.get();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'offline', 'つながらないみたい。電波のいいところでもう一度ためしてね');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || 'error', data?.message || 'うまくいきませんでした');
  return data;
}

// サーバーからのお知らせ（交換・友達・シール帳の変化）。切れたら、新しいチケットでつなぎ直す
export function connectEvents(onEvent) {
  let es = null, closed = false, first = true;
  async function open() {
    if (closed) return;
    try {
      const { ticket } = await api('POST', '/api/events/ticket');
      es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
      ['trade', 'friends', 'stickers'].forEach(type => es.addEventListener(type, e => {
        try { onEvent(JSON.parse(e.data)); } catch {}
      }));
      es.onopen = () => { if (!first) onEvent({ type: 'resync' }); first = false; };
      es.onerror = () => { es.close(); setTimeout(open, 3000); };
    } catch {
      setTimeout(open, 5000);
    }
  }
  open();
  return () => { closed = true; es?.close(); };
}
