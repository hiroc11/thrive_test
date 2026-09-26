// 不動産情報管理 フロントエンド

const $ = (sel) => document.querySelector(sel);
const yen = new Intl.NumberFormat('ja-JP');

let meta = null;
let currentId = null; // 詳細表示中の物件ID
let editingId = null; // 編集中の物件ID（新規はnull）

// 要素を生成するヘルパー（テキストは必ずtextContentで入れてXSSを防ぐ）
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `エラーが発生しました (${res.status})`);
    err.errors = body.errors;
    throw err;
  }
  return body;
}

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

function formatPrice(p) {
  if (p.price === null || p.price === undefined) return '—';
  if (p.transaction_type === '賃貸') return `${yen.format(p.price)}円/月`;
  if (p.price >= 1e8) {
    const oku = Math.floor(p.price / 1e8);
    const man = Math.round((p.price % 1e8) / 1e4);
    return man ? `${oku}億${yen.format(man)}万円` : `${oku}億円`;
  }
  if (p.price >= 1e4) return `${yen.format(Math.round(p.price / 1e4))}万円`;
  return `${yen.format(p.price)}円`;
}

function formatAge(builtYear) {
  if (!builtYear) return '—';
  const age = new Date().getFullYear() - builtYear;
  return `${builtYear}年${age >= 0 ? `（築${age}年）` : ''}`;
}

function statusBadge(status) {
  return el('span', { class: 'badge', dataset: { status } }, status);
}

// ---- 一覧・集計 ----

function currentFilters() {
  const fd = new FormData($('#filter-form'));
  const params = new URLSearchParams();
  for (const [k, v] of fd) if (String(v).trim() !== '') params.set(k, String(v).trim());
  return params;
}

async function loadList() {
  const params = currentFilters();
  $('#export-link').href = `/api/properties/export.csv?${params}`;
  params.set('limit', '500');
  const { total, items } = await api(`/api/properties?${params}`);

  const tbody = $('#list-body');
  tbody.replaceChildren(
    ...items.map((p) => {
      const area = [p.layout, p.floor_area ? `${p.floor_area}㎡` : p.land_area ? `土地${p.land_area}㎡` : null]
        .filter(Boolean)
        .join(' / ');
      const station = p.nearest_station ? `${p.nearest_station}駅${p.walk_minutes != null ? ` 徒歩${p.walk_minutes}分` : ''}` : '';
      const tr = el(
        'tr',
        { tabindex: '0', dataset: { id: p.id } },
        el('td', {}, el('div', { class: 'name' }, p.name)),
        el('td', {}, p.property_type),
        el('td', {}, p.transaction_type),
        el('td', { class: 'num' }, formatPrice(p)),
        el('td', {}, el('div', {}, p.address || '—'), station ? el('div', { class: 'small' }, station) : null),
        el('td', {}, area || '—'),
        el('td', { class: 'small' }, formatAge(p.built_year)),
        el('td', {}, statusBadge(p.status)),
        el('td', {}, el('button', { class: 'btn btn-ghost', type: 'button', dataset: { edit: p.id } }, '編集')),
      );
      return tr;
    }),
  );
  $('#empty').hidden = items.length > 0;
  $('#result-count').textContent =
    total > items.length ? `${total}件中 ${items.length}件を表示` : `${total}件`;
}

async function loadStats() {
  const s = await api('/api/stats');
  const card = (label, value, sub) =>
    el('div', { class: 'stat' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), sub ? el('div', { class: 'sub' }, sub) : null);
  const avgSale = s.averagePrice['売買'];
  const avgRent = s.averagePrice['賃貸'];
  $('#stats').replaceChildren(
    card('登録物件', `${s.total}件`, `売買 ${s.byTransactionType['売買']} / 賃貸 ${s.byTransactionType['賃貸']}`),
    card('募集中', `${s.byStatus['募集中']}件`),
    card('商談中', `${s.byStatus['商談中']}件`),
    card('成約済', `${s.byStatus['成約済']}件`),
    card('平均価格（売買）', avgSale ? formatPrice({ price: avgSale, transaction_type: '売買' }) : '—'),
    card('平均賃料（賃貸）', avgRent ? formatPrice({ price: avgRent, transaction_type: '賃貸' }) : '—'),
  );
}

async function refresh() {
  try {
    await Promise.all([loadList(), loadStats()]);
  } catch (e) {
    toast(e.message);
  }
}

// ---- 登録・編集フォーム ----

const FORM_LAYOUT = [
  'name', 'property_type', 'transaction_type', 'status', 'price', 'management_fee',
  'address', 'nearest_station', 'walk_minutes', 'layout', 'floor_area', 'land_area',
  'built_year', 'structure', 'owner_name', 'owner_contact', 'notes',
];
const WIDE = new Set(['name', 'address', 'notes']);

function buildForm() {
  const container = $('#form-fields');
  container.replaceChildren(
    ...FORM_LAYOUT.map((key) => {
      const f = meta.fields[key];
      let input;
      if (f.kind === 'enum') {
        input = el('select', { name: key }, f.values.map((v) => el('option', { value: v }, v)));
      } else if (key === 'notes') {
        input = el('textarea', { name: key });
      } else {
        const isNum = f.kind === 'int' || f.kind === 'real';
        input = el('input', {
          name: key,
          type: isNum ? 'number' : 'text',
          step: f.kind === 'real' ? '0.01' : isNum ? '1' : undefined,
          min: isNum ? '0' : undefined,
          inputmode: isNum ? 'decimal' : undefined,
          required: f.required,
        });
      }
      return el(
        'label',
        { class: WIDE.has(key) ? 'wide' : undefined },
        el('span', { class: f.required ? 'req' : undefined }, f.label),
        input,
        el('span', { class: 'field-error', dataset: { errorFor: key } }),
      );
    }),
  );
}

function clearFormErrors() {
  $('#form-error').textContent = '';
  for (const e of document.querySelectorAll('[data-error-for]')) e.textContent = '';
}

function openForm(property = null) {
  editingId = property?.id ?? null;
  $('#form-title').textContent = editingId ? '物件を編集' : '物件を登録';
  const form = $('#property-form');
  form.reset();
  clearFormErrors();
  if (property) {
    for (const key of FORM_LAYOUT) form.elements[key].value = property[key] ?? '';
  }
  $('#form-dialog').showModal();
  form.elements.name.focus();
}

async function submitForm(event) {
  event.preventDefault();
  clearFormErrors();
  const form = $('#property-form');
  const data = {};
  for (const key of FORM_LAYOUT) data[key] = form.elements[key].value;
  try {
    const saved = editingId
      ? await api(`/api/properties/${editingId}`, { method: 'PUT', body: JSON.stringify(data) })
      : await api('/api/properties', { method: 'POST', body: JSON.stringify(data) });
    $('#form-dialog').close();
    toast(editingId ? '物件を更新しました' : '物件を登録しました');
    await refresh();
    if (currentId === saved.id && $('#detail-dialog').open) showDetail(saved.id);
  } catch (e) {
    $('#form-error').textContent = e.message;
    for (const [key, msg] of Object.entries(e.errors || {})) {
      const target = document.querySelector(`[data-error-for="${key}"]`);
      if (target) target.textContent = msg;
    }
  }
}

// ---- 詳細表示 ----

async function showDetail(id) {
  try {
    const p = await api(`/api/properties/${id}`);
    currentId = p.id;
    const rows = [];
    for (const key of FORM_LAYOUT) {
      if (key === 'name') continue;
      const f = meta.fields[key];
      let value = p[key];
      if (value === null || value === '') value = '—';
      else if (key === 'price') value = `${formatPrice(p)}（${yen.format(p.price)}円）`;
      else if (key === 'management_fee') value = `${yen.format(value)}円`;
      else if (key === 'status') value = statusBadge(value);
      else if (key === 'built_year') value = formatAge(value);
      else if (key === 'floor_area' || key === 'land_area') value = `${value}㎡（約${(value / 3.30579).toFixed(1)}坪）`;
      else if (key === 'walk_minutes') value = `${value}分`;
      rows.push(el('dt', {}, f.label), el('dd', {}, value));
    }
    rows.push(
      el('dt', {}, '登録日時'), el('dd', {}, new Date(p.created_at).toLocaleString('ja-JP')),
      el('dt', {}, '更新日時'), el('dd', {}, new Date(p.updated_at).toLocaleString('ja-JP')),
    );
    $('#detail-body').replaceChildren(el('h2', {}, p.name), el('dl', { class: 'detail' }, rows));
    if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  } catch (e) {
    toast(e.message);
  }
}

async function deleteCurrent() {
  if (!currentId) return;
  if (!confirm('この物件を削除しますか？この操作は取り消せません。')) return;
  try {
    await api(`/api/properties/${currentId}`, { method: 'DELETE' });
    $('#detail-dialog').close();
    currentId = null;
    toast('物件を削除しました');
    await refresh();
  } catch (e) {
    toast(e.message);
  }
}

// ---- 初期化 ----

function fillSelect(name, values) {
  const select = $('#filter-form').elements[name];
  select.append(...values.map((v) => el('option', { value: v }, v)));
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function init() {
  meta = await api('/api/meta');
  fillSelect('transaction_type', meta.transactionTypes);
  fillSelect('property_type', meta.propertyTypes);
  fillSelect('status', meta.statuses);
  buildForm();

  const filterForm = $('#filter-form');
  const debounced = debounce(() => loadList().catch((e) => toast(e.message)), 250);
  filterForm.addEventListener('input', debounced);
  filterForm.addEventListener('change', debounced);
  filterForm.addEventListener('submit', (e) => e.preventDefault());
  filterForm.addEventListener('reset', () => setTimeout(debounced, 0));

  $('#new-btn').addEventListener('click', () => openForm());
  $('#property-form').addEventListener('submit', submitForm);
  $('#delete-btn').addEventListener('click', deleteCurrent);
  $('#edit-btn').addEventListener('click', async () => {
    const p = await api(`/api/properties/${currentId}`);
    openForm(p);
  });
  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  }

  const tbody = $('#list-body');
  tbody.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      e.stopPropagation();
      openForm(await api(`/api/properties/${editBtn.dataset.edit}`));
      return;
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) showDetail(Number(tr.dataset.id));
  });
  tbody.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.key === 'Enter' && e.target === tr) showDetail(Number(tr.dataset.id));
  });

  await refresh();
}

init().catch((e) => toast(e.message));
