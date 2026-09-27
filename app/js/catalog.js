// シールの一覧。サーバーとアプリの両方から読み込む（見た目の情報と、レア度・発行上限などの情報）
// code は通し番号つきID（例: ichigo-12）の前半になるので、一度公開したら変えないこと。
export const RARITY = {
  normal: { label: "ノーマル", cls: "" },
  rare: { label: "レア", cls: "rare" },
  srare: { label: "Sレア", cls: "srare" },
  secret: { label: "シークレット", cls: "secret" }
};

export const ODDS = [["normal", 60], ["rare", 28], ["srare", 10], ["secret", 2]];

export const SERIES = [
  ["hajimari", "はじまりのシール"],
  ["sumo", "おすもうシリーズ"],
  ["effect", "エフェクト"],
  ["iroiro", "いろいろシリーズ"],
  ["reward", "ごほうび"]
];

export const DESIGNS = [
  {name: "ゆめかわハート",code: "yume",shape: "heart",kind: "holo",rarity: "rare",of: 300,rate: 3,base: "linear-gradient(135deg,#c9d0dc,#8f9bb0 45%,#d7dce6 70%,#9aa6ba)",series: "hajimari"},
  {name: "もちまる",code: "mochi",shape: "circle",kind: "puffy",rarity: "normal",of: 5000,rate: 1,kao: true,base: "radial-gradient(circle at 45% 40%,#ffd9ea,#ffa1ca 60%,#ef6aa6 100%)",series: "hajimari"},
  {name: "きらきらくも",code: "kumo",shape: "cloud",kind: "glitter",rarity: "rare",of: 500,rate: 3,base: "linear-gradient(160deg,#d6c5ff,#a28af3)",series: "hajimari"},
  {name: "いちごミルク",code: "ichigo",shape: "heart",kind: "puffy",rarity: "srare",of: 200,rate: 4,base: "radial-gradient(circle at 45% 38%,#ffe4e9,#ff8ea3 55%,#e44f6d 100%)",series: "hajimari"},
  {name: "ながれぼし",code: "nagare",shape: "star",kind: "holo",rarity: "srare",of: 150,rate: 4,base: "linear-gradient(135deg,#b9c6ef,#7486c4 50%,#c8d2f5)",series: "hajimari"},
  {name: "ひみつの一番星",code: "himitsu",shape: "star",kind: "secret",rarity: "secret",of: 100,rate: 5,base: "linear-gradient(135deg,#f3d27a,#c8922a 45%,#f5dc92 70%,#a8741c)",series: "hajimari"},
  {name: "みかんまる",code: "mikan",shape: "circle",kind: "puffy",rarity: "normal",of: 5000,rate: 1,kao: true,base: "radial-gradient(circle at 45% 40%,#ffe7c2,#ffb45c 60%,#f08a2c 100%)",series: "hajimari"},
  {name: "もちの山",code: "mochiyama",rank: "前頭",shape: "rikishi",art: "rikishi",kind: "puffy",rarity: "normal",of: 3000,rate: 1,mw: "#7a4fd0",base: "radial-gradient(circle at 45% 40%,#fff1e8,#ffd2bd 60%,#f2a58a 100%)",series: "sumo"},
  {name: "あんこ丸",code: "anko",rank: "前頭",shape: "rikishi",art: "rikishi",kind: "puffy",rarity: "normal",of: 3000,rate: 1,mw: "#3b8f6a",base: "radial-gradient(circle at 45% 40%,#fff3ea,#ffd8c4 60%,#eea88e 100%)",series: "sumo"},
  {name: "ぷく錦",code: "pukuni",rank: "関脇",shape: "rikishi",art: "rikishi",kind: "glitter",rarity: "rare",of: 600,rate: 3,mw: "#2f6fd6",base: "linear-gradient(160deg,#ffe3d4,#f7b89f)",series: "sumo"},
  {name: "さくら海",code: "sakura",rank: "大関",shape: "rikishi",art: "rikishi",kind: "holo",rarity: "srare",of: 200,rate: 4,mw: "#e2508a",base: "linear-gradient(135deg,#ffe6da,#f2b59c 50%,#ffe9df)",series: "sumo"},
  {name: "きらら嶽",code: "kirara",rank: "横綱",shape: "rikishi",art: "rikishi",kind: "secret",rarity: "secret",of: 50,rate: 5,yokozuna: true,mw: "#8a5a12",base: "linear-gradient(135deg,#fff0c9,#f3c98a 45%,#fff3d6 70%,#e0a867)",series: "sumo"},
  {name: "にゃんの山",code: "nyanyama",rank: "前頭",species: "cat",pattern: "tabby",fur: "#d0773a",muzzle: "#fff3e2",shape: "rikishiCat",art: "rikishi",kind: "puffy",rarity: "normal",of: 3000,rate: 1,mw: "#2c3e78",base: "radial-gradient(circle at 45% 40%,#ffe7c4,#ffc27c 60%,#e8904a 100%)",series: "sumo"},
  {name: "みけ乃花",code: "mikeno",rank: "小結",species: "cat",pattern: "calico",muzzle: "#ffffff",shape: "rikishiCat",art: "rikishi",kind: "glitter",rarity: "rare",of: 600,rate: 3,mw: "#d9482b",base: "linear-gradient(160deg,#fffaf2,#efe3d2)",series: "sumo"},
  {name: "しろたま海",code: "shirotama",rank: "大関",species: "cat",muzzle: "#ffffff",shape: "rikishiCat",art: "rikishi",kind: "holo",rarity: "srare",of: 200,rate: 4,mw: "#6a4fc9",base: "linear-gradient(135deg,#ffffff,#dcd8e6 50%,#f7f5fc)",series: "sumo"},
  {name: "しば丸",code: "shiba",rank: "前頭",species: "dog",pattern: "shiba",fur: "#c9732f",muzzle: "#fff4e2",shape: "rikishiDog",art: "rikishi",kind: "puffy",rarity: "normal",of: 3000,rate: 1,mw: "#2b2b33",base: "radial-gradient(circle at 45% 40%,#ffdcae,#f0aa60 60%,#d9843a 100%)",series: "sumo"},
  {name: "わたあめ錦",code: "wataame",rank: "関脇",species: "dog",fur: "#e3e0ec",muzzle: "#ffffff",shape: "rikishiDog",art: "rikishi",kind: "glitter",rarity: "rare",of: 600,rate: 3,mw: "#3aa6c9",base: "linear-gradient(160deg,#ffffff,#eceff6)",series: "sumo"},
  {name: "こがね嶽",code: "kogane",rank: "横綱",species: "dog",fur: "#cf8d3f",muzzle: "#fff3d6",yokozuna: true,shape: "rikishiDog",art: "rikishi",kind: "secret",rarity: "secret",of: 50,rate: 5,mw: "#7a1f2b",base: "linear-gradient(135deg,#fff0c9,#f3c98a 45%,#fff3d6 70%,#e0a867)",series: "sumo"},
  {name: "オーロラハート",code: "aurora",shape: "heart",kind: "aurora",rarity: "rare",of: 400,rate: 3,base: "linear-gradient(160deg,#f6f3ff,#e6f1ff)",series: "effect"},
  {name: "ぷにジェル",code: "jelly",shape: "circle",kind: "jelly",rarity: "normal",of: 4000,rate: 1,kao: true,tint: "#ff7fb4",base: "radial-gradient(circle at 45% 40%,rgba(255,214,236,.7),rgba(255,140,190,.55) 70%,rgba(236,86,156,.7))",series: "effect"},
  {name: "プリズムスター",code: "prism",shape: "star",kind: "prism",rarity: "srare",of: 150,rate: 4,base: "linear-gradient(135deg,#f4f6ff,#cdd4ee 50%,#ffffff)",series: "effect"},
  {name: "きんぴかぐも",code: "kinpika",shape: "cloud",kind: "metal",rarity: "rare",of: 500,rate: 3,base: "linear-gradient(160deg,#fff1c1,#e2b04f 40%,#fff4cf 60%,#c9912e)",series: "effect"},
  {name: "チェンジまる",code: "change",shape: "circle",kind: "lenti",rarity: "rare",of: 500,rate: 3,kao: true,base: "radial-gradient(circle at 45% 40%,#ffd9ea,#ffa1ca 60%,#ef6aa6 100%)",base2: "radial-gradient(circle at 45% 40%,#d9ecff,#9fcbff 60%,#5f98ea 100%)",series: "effect"},
  {name: "ウインク関",code: "wink",rank: "小結",shape: "rikishi",art: "rikishi",kind: "lenti",rarity: "srare",of: 200,rate: 4,mw: "#e2508a",mw2: "#2f6fd6",base: "radial-gradient(circle at 45% 40%,#fff1e8,#ffd2bd 60%,#f2a58a 100%)",series: "sumo"},
  {name: "くまドロップ",code: "dropkuma",shape: "bear",kind: "drop",rarity: "rare",of: 600,rate: 3,kao: true,tint: "#ff9a3c",base: "radial-gradient(circle at 45% 42%,rgba(255,214,150,.9),rgba(255,160,70,.85) 65%,rgba(214,110,30,.95))",series: "iroiro"},
  {name: "リボンドロップ",code: "dropribbon",shape: "ribbon",kind: "drop",rarity: "rare",of: 600,rate: 3,tint: "#ff5fa2",base: "radial-gradient(circle at 45% 42%,rgba(255,200,226,.9),rgba(255,110,170,.85) 65%,rgba(214,50,120,.95))",series: "iroiro"},
  {name: "ハートドロップ",code: "drophart",shape: "heart",kind: "drop",rarity: "srare",of: 200,rate: 4,tint: "#9b6bff",base: "radial-gradient(circle at 45% 40%,rgba(226,210,255,.9),rgba(160,120,255,.85) 65%,rgba(104,64,214,.95))",series: "iroiro"},
  {name: "おにぎり",code: "onigiri",shape: "onigiri",art: "simple",kind: "flat",rarity: "normal",of: 6000,rate: 1,base: "#fbfaf6",series: "iroiro"},
  {name: "よつば",code: "yotsuba",shape: "clover",art: "simple",kind: "flat",rarity: "normal",of: 6000,rate: 1,base: "#5fbf74",series: "iroiro"},
  {name: "にこにこ",code: "niko",shape: "circle",kind: "flat",rarity: "normal",of: 6000,rate: 1,kao: true,base: "#ffd84d",series: "iroiro"},
  {name: "しばのおしり",code: "shibajiri",shape: "oshiriDog",art: "oshiri",kind: "puffy oshiri",rarity: "srare",of: 200,rate: 4,base: "radial-gradient(circle at 40% 45%,#ffdcae,#f0aa60 60%,#d9843a 100%)",series: "iroiro"},
  {name: "ねこのおしり",code: "nekojiri",shape: "oshiriCat",art: "oshiri",kind: "puffy oshiri",rarity: "rare",of: 600,rate: 3,fur: "#c86a2a",base: "radial-gradient(circle at 40% 45%,#ffe7c4,#ffc27c 60%,#e8904a 100%)",series: "iroiro"},
  {name: "ももじり",code: "momojiri",shape: "momo",art: "oshiri",kind: "puffy oshiri",rarity: "normal",of: 5000,rate: 1,base: "radial-gradient(circle at 40% 48%,#fff0f3,#ffb3c4 55%,#f47f9a 100%)",series: "iroiro"},
  {name: "がんばりぼし",code: "ganbari",shape: "star",kind: "aurora",rarity: "rare",of: 99999,rate: 3,reward: true,base: "linear-gradient(160deg,#fff7d6,#ffe1f0)",series: "reward"},
  {name: "ミントぐも",code: "mint",shape: "cloud",kind: "glitter",rarity: "normal",of: 5000,rate: 1,base: "linear-gradient(160deg,#c6f5e6,#7fd8bd)",series: "hajimari"}
];

export const DESIGN_OF = Object.fromEntries(DESIGNS.map(d => [d.code, d]));
// パックから出るデザイン（ごほうびシールは出ない）
export const PACK_DESIGNS = DESIGNS.filter(d => !d.reward);
