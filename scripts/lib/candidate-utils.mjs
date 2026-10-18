// 楽天の商品データを items.json の形に整える共通処理（import-candidates / collect-limited で共有）
import { normalize } from "./catalog.mjs";

export const NOISE_NAME = /タンブラー|マグカップ|マグ$|ドリッパー|キャニスター|グラス|食器|器具|ポーチ単品|トートバッグ|エコバッグ|ギフト券|カタログギフト|訳あり|わけあり|お試し|業務用|大容量|アウトレット|福袋|ふるさと納税|定期便|まとめ買い|\d+箱セット|ケース販売|ポイント\d+倍|クーポン/;
// 手土産にならない飲料ジャンル（ランキング取得時に大ジャンル配下として混ざる）
export const OFF_GENRE = /^(水・炭酸水|炭酸飲料|スポーツドリンク|野菜・果実飲料|スムージー|お酢飲料|牛乳|植物性ミルク|フルーツ入り乳飲料|乳性・乳酸菌飲料|ゼリー飲料|希釈用ドリンク|氷|ノンアルコール|ココア・チョコレートドリンク|その他|水・ソフトドリンク)$/;
const PROMO = /^(?:の日|入学|粗品|お礼の品|花以外|以外|おすすめ|挨拶|おうちごはん|二次会|サンクス|記念品|ブライダル|限定缶|缶入り|濃厚|なめらか|贅沢|減塩タイプの薄味|うす味|減塩|個箱入り|スナック|保存食|惣菜|そうざい|小袋|小分け|お弁当|帰省土産|食品|時短|オフィス|ご家庭料理|おつまみ|七五三|老舗|健康|敬老|グルメ|土産|新生活|祝い|国内生産|定番|ご飯のお供|毎日の食卓|食べ比べセット|単品|贈答用|保存料\S*|日本産|20\d\d|[A-Z]{1,3}-?\d{1,4}|送料込み?|帰省|お年賀|御年賀|贈答品?|お見舞い?|数量|限定|お菓子|洋菓子|和菓子|焼き菓子|東京|銀座|日本橋|誕生日|退職|お世話になりました|お礼|御礼|産休|お供え|御供|供物|菓子折り?|高級|詰め合わせ|お取り寄せ|ハロウィン|クリスマス|新年|年末年始|春|夏|秋|冬|出産|結婚|新築|快気|法事|香典返し|買い回り|買いまわり|酒蔵直送|直送|地酒|人気|おしゃれ|かわいい|プチギフト|ばらまき|個包装|小袋サイズ|※\S*|≪|≫|＜|＞|<|>|\.|\/)$/; // 単語単位で一致したら除く（「銀座あけぼの」の「銀座」は消さない）
const PROMO_IN = /お年賀|御年賀|お歳暮|御歳暮|お中元|敬老|七五三|ハロウィン|新生活/g;
export const cleanName = (s) =>
  s
    .replace(/[＜＞<>『』]/g, " ")
    .replace(/(^|\s)[.．・]+/g, " ")
    .replace(PROMO_IN, "")
    .split(/[\s　]+/)
    .map((w) => w.replace(/[｜|].*$/, "").replace(/[（(][^）)]*[）)]?|^[^（(]*[）)]/g, ""))
    .map((w) => w.replace(/[.．。、,]+$/, ""))
    .filter((w, i, arr) => w && !PROMO.test(w) && arr.indexOf(w) === i)
    .join(" ")
    .replace(/【[^】]*】|［[^］]*］|\[[^\]]*\]|《[^》]*》|★[^★]*★|◆[^◆]*◆/g, " ")
    .replace(/送料無料|楽天ランキング\S*|ランキング\d*位?|あす楽|公式|ギフト|プレゼント|お祝い|内祝い?|お返し|お中元|お歳暮|御中元|御歳暮|母の日|父の日|敬老の日|ホワイトデー|バレンタイン|手土産|お土産|贈り物|スイーツ|お菓子|のし|熨斗|対応|可能|個包装|個装|常温便?|日持ち\S*|賞味期限\S*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .reduce((acc, w) => ((acc + " " + w).trim().length <= 36 ? (acc + " " + w).trim() : acc), "");
export const shopToBrand = (shop) =>
  shop
    .replace(/楽天市場店|楽天市場|楽天店|公式オンラインショップ|オンラインショップ|公式ショップ|公式通販|オンラインストア|通販|本店|ショップ|SHOP|Online|ONLINE|公式/g, "")
    .replace(/[【】\[\]（）()]/g, " ")
    .trim();

export function attributesOf(r, name) {
  const t = `${r.itemName} ${r.itemCaption}`;
  const shelf = Number(t.match(/(?:賞味期限|日持ち|消費期限)[^\d]{0,12}(\d{1,3})\s*日/)?.[1] ?? t.match(/製造日?(?:から|より)[^\d]{0,5}(\d{1,3})\s*日/)?.[1] ?? 0);
  const chilled = /要冷蔵|冷蔵便|冷凍便|要冷凍|クール便|和牛|牛肉|生菓子/.test(t);
  const pieces = name.match(/\d+\s*(個|枚|本|袋|粒|切|缶|箱)(入り?)?/)?.[0] ?? "詰合せ";
  return {
    is_individually_wrapped: /個包装|個装|個別包装/.test(t),
    piece_count: pieces,
    temperature: chilled ? "chilled" : "ambient",
    shelf_life_days: shelf || (chilled ? 3 : 14),
    shelf_life_known: Boolean(shelf),
  };
}

export const scenesFor = (price) =>
  price < 3000 ? ["female_office", "casual_party", "in_laws"] : price < 5000 ? ["business_exec", "in_laws", "female_office"] : ["business_exec", "in_laws"];

// ---- 重複判定 ----
const bigrams = (s) => new Set([...Array(Math.max(0, s.length - 1))].map((_, i) => s.slice(i, i + 2)));
const similar = (a, b) => {
  const A = bigrams(a), B = bigrams(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / Math.max(1, Math.min(A.size, B.size));
};
// ブランド名を除いた商品名で比べる。入数が違えば別商品（価格帯が変わるため）
const core = (brand, name) => normalize(name.replace(brand, ""));
const countOf = (name) => name.normalize("NFKC").match(/\d+\s*(個|枚|本|袋|粒|切|缶|箱|棹)/)?.[0] ?? "";

// items.json に依存する判定（収録済みブランド・ジャンル・重複）
export function createCatalogTools(items) {
  // 精度優先: 既に収録しているブランドの商品だけを採用する（ショップ一覧の本文に偶然含まれる語で誤判定するのを防ぐ）
  // 「空也」のような2文字のブランドは他の語に紛れて誤一致するため対象外
  const knownBrands = [...new Set(items.map((i) => i.brand_name))]
    .filter((b) => normalize(b).length >= 3)
    .sort((a, b) => b.length - a.length);
  const brandAreas = {};
  for (const i of items) for (const a of i.areas) (brandAreas[i.brand_name] ??= new Set()).add(a);
  function brandOf(r) {
    const name = normalize(r.itemName), shop = normalize(r.shopName);
    // 商品名にブランド名があり、かつ公式店（店名にもブランド名）であること
    return knownBrands.find((b) => name.includes(normalize(b)) && shop.includes(normalize(b).slice(0, 4))) ?? null;
  }

  // ブランドの既存商品で一番多いジャンル（商品名からジャンルが判断できないときに使う）
  const brandCategory = {};
  for (const i of items) ((brandCategory[i.brand_name] ??= {})[i.category] = (brandCategory[i.brand_name]?.[i.category] ?? 0) + 1);
  const mainCategoryOf = (brand) => Object.entries(brandCategory[brand] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];

  function categoryOf(r, name, brand) {
    if (/ビスケット|クッキー|サブレ|プリン|ゼリー|ジェリー|ケーキ|チョコ|ショコラ|フィナンシェ|マドレーヌ|バウム|ラスク|ゴーフル/.test(name)) return "yogashi";
    if (/せんべい|煎餅|おかき|あられ|佃煮|つくだ煮|海苔|のり|おつまみ|珍味|かつお節|鰹節|だし|カレー|スープ|和牛|牛肉|すき焼|しゃぶしゃぶ/.test(name)) return "savory";
    if (/羊羹|ようかん|最中|もなか|どら焼|どらやき|大福|団子|だんご|饅頭|まんじゅう|甘納豆|わらび|きんつば|金鍔/.test(name)) return "wagashi";
    if (/日本茶|緑茶|煎茶|ほうじ茶|抹茶ティー|コーヒー|珈琲|紅茶|日本酒|純米|吟醸|焼酎|梅酒|ジュース/.test(name)) return "drink";
    // 足りないマスを狙った検索の結果は、検索したマスのジャンルではなくブランドの主なジャンルを使う
    return (r.genre_name?.startsWith("検索:") ? mainCategoryOf(brand) : null) ?? r.category;
  }

  const existing = items.map((i) => ({ brand: normalize(i.brand_name), core: core(i.brand_name, i.name), count: countOf(i.name) }));
  const isDuplicate = (brand, name) =>
    existing.some((e) => e.brand === normalize(brand) && e.count === countOf(name) && similar(e.core, core(brand, name)) > 0.6);
  const addExisting = (brand, name) => existing.push({ brand: normalize(brand), core: core(brand, name), count: countOf(name) });

  return { knownBrands, brandAreas, brandOf, mainCategoryOf, categoryOf, isDuplicate, addExisting };
}
