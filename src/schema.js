// 物件データの項目定義と入力バリデーション

export const PROPERTY_TYPES = ['マンション', '一戸建て', '土地', 'アパート', '事務所', '店舗', '倉庫', 'その他'];
export const TRANSACTION_TYPES = ['売買', '賃貸'];
export const STATUSES = ['募集中', '商談中', '成約済', '非公開'];

// フィールド名 -> 定義
// kind: text | int | real | enum
export const FIELDS = {
  name: { label: '物件名', kind: 'text', required: true, max: 200 },
  property_type: { label: '物件種別', kind: 'enum', values: PROPERTY_TYPES, required: true },
  transaction_type: { label: '取引種別', kind: 'enum', values: TRANSACTION_TYPES, required: true },
  status: { label: 'ステータス', kind: 'enum', values: STATUSES, required: true },
  price: { label: '価格・賃料(円)', kind: 'int', min: 0 },
  management_fee: { label: '管理費(円)', kind: 'int', min: 0 },
  address: { label: '所在地', kind: 'text', max: 300 },
  nearest_station: { label: '最寄駅', kind: 'text', max: 100 },
  walk_minutes: { label: '駅徒歩(分)', kind: 'int', min: 0, maxValue: 999 },
  floor_area: { label: '建物・専有面積(㎡)', kind: 'real', min: 0 },
  land_area: { label: '土地面積(㎡)', kind: 'real', min: 0 },
  layout: { label: '間取り', kind: 'text', max: 50 },
  built_year: { label: '築年(西暦)', kind: 'int', min: 1800, maxValue: 2200 },
  structure: { label: '構造', kind: 'text', max: 50 },
  owner_name: { label: '所有者・貸主', kind: 'text', max: 100 },
  owner_contact: { label: '連絡先', kind: 'text', max: 200 },
  notes: { label: '備考', kind: 'text', max: 5000 },
};

export class ValidationError extends Error {
  constructor(errors) {
    super('入力内容に誤りがあります');
    this.errors = errors;
  }
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * 入力を検証し、DBに保存できる形へ正規化する。
 * partial=true の場合は、渡されたフィールドのみ検証する（部分更新用）。
 */
export function validateProperty(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError({ _: 'JSONオブジェクトを送信してください' });
  }
  const out = {};
  const errors = {};

  for (const [key, def] of Object.entries(FIELDS)) {
    const present = Object.hasOwn(input, key);
    if (partial && !present) continue;
    const raw = input[key];

    if (isBlank(raw)) {
      if (def.required) errors[key] = `${def.label}は必須です`;
      else out[key] = null;
      continue;
    }

    switch (def.kind) {
      case 'text': {
        const s = String(raw).trim();
        if (def.max && s.length > def.max) errors[key] = `${def.label}は${def.max}文字以内で入力してください`;
        else out[key] = s;
        break;
      }
      case 'enum': {
        if (!def.values.includes(raw)) errors[key] = `${def.label}の値が不正です`;
        else out[key] = raw;
        break;
      }
      case 'int':
      case 'real': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
        if (!Number.isFinite(n)) {
          errors[key] = `${def.label}は数値で入力してください`;
        } else if (def.kind === 'int' && !Number.isInteger(n)) {
          errors[key] = `${def.label}は整数で入力してください`;
        } else if (def.min !== undefined && n < def.min) {
          errors[key] = `${def.label}は${def.min}以上で入力してください`;
        } else if (def.maxValue !== undefined && n > def.maxValue) {
          errors[key] = `${def.label}は${def.maxValue}以下で入力してください`;
        } else {
          out[key] = n;
        }
        break;
      }
    }
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return out;
}
