// サンプルデータを投入する: npm run seed
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { validateProperty } from './schema.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dbPath = process.env.DB_PATH || join(ROOT, 'data', 'real-estate.db');
const repo = openDatabase(dbPath);

const samples = [
  { name: 'パークハイツ代々木 502号室', property_type: 'マンション', transaction_type: '売買', status: '募集中', price: 68000000, management_fee: 18000, address: '東京都渋谷区代々木1-2-3', nearest_station: '代々木', walk_minutes: 5, floor_area: 62.4, layout: '2LDK', built_year: 2012, structure: 'RC造' },
  { name: 'グリーンテラス三鷹', property_type: '一戸建て', transaction_type: '売買', status: '商談中', price: 54800000, address: '東京都三鷹市下連雀4-5-6', nearest_station: '三鷹', walk_minutes: 12, floor_area: 95.2, land_area: 110.5, layout: '4LDK', built_year: 2018, structure: '木造' },
  { name: 'メゾン中野 201', property_type: 'アパート', transaction_type: '賃貸', status: '募集中', price: 98000, management_fee: 5000, address: '東京都中野区中野5-1-1', nearest_station: '中野', walk_minutes: 8, floor_area: 25.3, layout: '1K', built_year: 2005, structure: '木造' },
  { name: '横浜駅前ビル 3F', property_type: '事務所', transaction_type: '賃貸', status: '募集中', price: 450000, management_fee: 40000, address: '神奈川県横浜市西区北幸2-1-1', nearest_station: '横浜', walk_minutes: 3, floor_area: 120.0, built_year: 1998, structure: 'SRC造' },
  { name: '世田谷区桜新町 土地', property_type: '土地', transaction_type: '売買', status: '成約済', price: 82000000, address: '東京都世田谷区桜新町1-10', nearest_station: '桜新町', walk_minutes: 7, land_area: 132.0 },
];

for (const s of samples) repo.create(validateProperty(s));
console.log(`${samples.length}件のサンプル物件を登録しました (${dbPath})`);
repo.close();
