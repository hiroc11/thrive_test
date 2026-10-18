import type { Item } from "./types";

const enc = encodeURIComponent;
const RAKUTEN_ID = process.env.NEXT_PUBLIC_RAKUTEN_AFFILIATE_ID;
const AMAZON_TAG = process.env.NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG;
const VC_SID = process.env.NEXT_PUBLIC_VALUECOMMERCE_SID;
const VC_PID = process.env.NEXT_PUBLIC_VALUECOMMERCE_PID;

export interface StoreLink {
  store: "rakuten" | "amazon" | "yahoo";
  label: string;
  url: string;
}

// .env にIDを入れるだけで全商品のリンクが収益化リンクに切り替わる
export function storeLinks(item: Item): StoreLink[] {
  const q = enc(item.search_keyword);
  const rakuten = `https://search.rakuten.co.jp/search/mall/${q}/`;
  const yahoo = `https://shopping.yahoo.co.jp/search?p=${q}`;
  return [
    {
      store: "rakuten",
      label: "楽天市場",
      url: RAKUTEN_ID ? `https://hb.afl.rakuten.co.jp/hgc/${RAKUTEN_ID}/?pc=${enc(rakuten)}` : rakuten,
    },
    {
      store: "amazon",
      label: "Amazon",
      url: `https://www.amazon.co.jp/s?k=${q}${AMAZON_TAG ? `&tag=${enc(AMAZON_TAG)}` : ""}`,
    },
    {
      store: "yahoo",
      label: "Yahoo!ショッピング",
      url:
        VC_SID && VC_PID
          ? `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${VC_SID}&pid=${VC_PID}&vc_url=${enc(yahoo)}`
          : yahoo,
    },
  ];
}
