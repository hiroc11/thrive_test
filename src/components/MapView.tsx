"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { ChevronRight, Loader2, LocateFixed, X } from "lucide-react";
import type { Area, Item } from "@/lib/types";
import { AREA_COORDS, FACILITIES, areaLabel, yen } from "@/lib/constants";

// 件数入りの丸いピン（画像アイコンを使わないので Leaflet の既定アイコン問題も起きない）
const pin = (count: number, active: boolean) =>
  L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;font:700 13px/1 system-ui;font-variant-numeric:tabular-nums;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);background:${active ? "#DC2626" : count ? "#0F172A" : "#94A3B8"};color:#fff">${count}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

// 施設ピン（拡大時）。角丸の四角で施設名の頭文字と件数を出す
const facilityPin = (count: number, active: boolean) =>
  L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;min-width:28px;height:24px;padding:0 6px;border-radius:8px;font:700 12px/1 system-ui;font-variant-numeric:tabular-nums;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);background:${active ? "#DC2626" : "#0F172A"};color:#fff">${count}</div>`,
    iconSize: [28, 24],
    iconAnchor: [14, 12],
  });

// これより拡大すると施設ごとのピンに分ける
const FACILITY_ZOOM = 14;

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

// 2点間の距離(km)
function distanceKm([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function FlyTo({ pos }: { pos: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.flyTo(pos, 14, { duration: 0.8 });
  }, [map, pos]);
  return null;
}

export default function MapView({
  items, selected, onShowList,
}: {
  items: Item[]; // エリア以外の条件で絞り込み済み・おすすめ順の商品
  selected: Area | "online" | null;
  onShowList: (area: Area) => void;
}) {
  const [active, setActive] = useState<Area | null>(selected && selected !== "online" ? selected : null);
  const [activeFacility, setActiveFacility] = useState<string | null>(null);
  const [zoom, setZoom] = useState(11.5);
  const watchId = useRef<number | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = useState(0); // 現在地の誤差(m)
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");

  const byArea = useMemo(() => {
    const m: Record<string, Item[]> = {};
    for (const i of items) for (const a of i.areas) (m[a] ??= []).push(i);
    return m;
  }, [items]);

  // 施設ごとの商品と、どの施設にも当てはまらない「エリア内のその他」の商品
  const { byFacility, rest } = useMemo(() => {
    const f: Record<string, Item[]> = {};
    const r: Record<string, Item[]> = {};
    for (const i of items) {
      const placed = new Set<string>();
      for (const shop of i.shops) {
        const fac = FACILITIES.find((x) => x.area === shop.area_id && x.match.some((k) => shop.shop_name.includes(k)));
        const key = fac ? fac.id : `area:${shop.area_id}`;
        if (placed.has(key) || !i.areas.includes(shop.area_id as Area)) continue;
        placed.add(key);
        if (fac) (f[fac.id] ??= []).push(i);
        else (r[shop.area_id] ??= []).push(i);
      }
    }
    return { byFacility: f, rest: r };
  }, [items]);

  const nearest = useMemo(() => {
    if (!me) return null;
    return Object.entries(AREA_COORDS)
      .map(([id, pos]) => ({ id: id as Area, km: distanceKm(me, pos) }))
      .sort((a, b) => a.km - b.km)[0];
  }, [me]);

  // 位置は watchPosition で数秒取り続け、誤差が小さくなるたびに更新する（GPSは最初の数秒は誤差が大きい）
  const stopWatch = () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setLocating(false);
  };
  useEffect(() => stopWatch, []);

  const locate = () => {
    if (!navigator.geolocation) return setLocError("この端末では現在地を取得できません。");
    stopWatch();
    setLocating(true);
    setLocError("");
    let first = true;
    let best = Infinity;
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (coords.accuracy >= best) return;
        best = coords.accuracy;
        const pos: [number, number] = [coords.latitude, coords.longitude];
        setMe(pos);
        setAccuracy(coords.accuracy);
        if (first) {
          first = false;
          setFlyTarget(pos);
          const near = Object.entries(AREA_COORDS).sort((a, b) => distanceKm(pos, a[1]) - distanceKm(pos, b[1]))[0];
          if (near && distanceKm(pos, near[1]) < 5) setActive(near[0] as Area);
        }
        if (coords.accuracy <= 30) stopWatch();
      },
      (e) => {
        stopWatch();
        setLocError(e.code === e.PERMISSION_DENIED ? "位置情報の利用が許可されていません。ブラウザの設定から許可してください。" : "現在地を取得できませんでした。");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
    setTimeout(stopWatch, 20000);
  };

  const facility = FACILITIES.find((f) => f.id === activeFacility) ?? null;
  const list = facility ? byFacility[facility.id] ?? [] : active ? byArea[active] ?? [] : [];
  const km = me && (facility || active) ? distanceKm(me, facility ? facility.pos : AREA_COORDS[active!]) : null;
  const zoomedIn = zoom >= FACILITY_ZOOM;
  const select = (area: Area | null, fac: string | null = null) => {
    setActive(area);
    setActiveFacility(fac);
  };

  return (
    <div>
      <div className="relative isolate z-0 overflow-hidden rounded-2xl border border-line">
        <MapContainer center={[35.69, 139.745]} zoom={11.5} zoomSnap={0.5} scrollWheelZoom style={{ height: "55vh", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FlyTo pos={flyTarget} />
          <ZoomWatcher onZoom={setZoom} />
          {!zoomedIn &&
            Object.entries(AREA_COORDS).map(([id, pos]) => (
              <Marker
                key={id}
                position={pos}
                icon={pin(byArea[id]?.length ?? 0, active === id)}
                eventHandlers={{ click: () => select(id as Area) }}
              >
                <Tooltip direction="top" offset={[0, -16]}>{areaLabel(id)} {byArea[id]?.length ?? 0}件</Tooltip>
              </Marker>
            ))}
          {zoomedIn &&
            FACILITIES.filter((f) => byFacility[f.id]?.length).map((f) => (
              <Marker
                key={f.id}
                position={f.pos}
                icon={facilityPin(byFacility[f.id].length, activeFacility === f.id)}
                eventHandlers={{ click: () => select(f.area as Area, f.id) }}
              >
                <Tooltip direction="top" offset={[0, -12]}>{f.name} {byFacility[f.id].length}件</Tooltip>
              </Marker>
            ))}
          {zoomedIn &&
            Object.entries(AREA_COORDS)
              .filter(([id]) => rest[id]?.length)
              .map(([id, pos]) => (
                <Marker
                  key={`rest-${id}`}
                  position={pos}
                  icon={pin(rest[id].length, active === id && !activeFacility)}
                  eventHandlers={{ click: () => select(id as Area) }}
                >
                  <Tooltip direction="top" offset={[0, -16]}>{areaLabel(id)}（店舗未特定）{rest[id].length}件</Tooltip>
                </Marker>
              ))}
          {me && (
            <>
              <Circle center={me} radius={accuracy} pathOptions={{ color: "#2563EB", weight: 1, fillOpacity: 0.1 }} />
              <CircleMarker center={me} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563EB", fillOpacity: 1 }}>
                <Tooltip direction="top">現在地</Tooltip>
              </CircleMarker>
            </>
          )}
        </MapContainer>
        <button
          onClick={locate}
          disabled={locating}
          className="absolute bottom-6 right-3 z-[1000] flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-bold shadow-md"
        >
          {locating ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />}現在地
        </button>
      </div>

      {locError && <p className="mt-2 text-xs text-accent">{locError}</p>}
      {me && accuracy > 200 && (
        <p className="mt-2 text-xs text-slate-500">
          現在地の誤差が約<span className="tabular-nums">{Math.round(accuracy)}</span>mあります。Wi-FiやGPSをオンにすると正確になります。
        </p>
      )}
      {nearest && !active && (
        <p className="mt-2 text-xs text-slate-600">
          いちばん近いエリアは <button className="font-bold underline" onClick={() => select(nearest.id)}>{areaLabel(nearest.id)}</button>（約<span className="tabular-nums">{nearest.km.toFixed(1)}</span>km）です。
        </p>
      )}

      {active ? (
        <section className="mt-3 rounded-2xl border border-line bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold">{facility ? facility.name : areaLabel(active)}</h3>
              {facility && <p className="text-xs text-slate-500">{areaLabel(active)}</p>}
              <p className="text-xs text-slate-500">
                条件に合う商品 <span className="tabular-nums">{list.length}</span>件
                {km != null && <>・現在地から約<span className="tabular-nums">{km.toFixed(1)}</span>km</>}
              </p>
            </div>
            <button onClick={() => select(null)} aria-label="閉じる" className="rounded-full p-1 hover:bg-slate-100"><X size={18} /></button>
          </div>
          {list.length === 0 ? (
            <p className="text-sm text-slate-500">このエリアには条件に合う商品がありません。</p>
          ) : (
            <>
              <ul className="space-y-2">
                {list.slice(0, 3).map((i) => (
                  <li key={i.id} className="flex items-center gap-3">
                    {i.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.image_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover" />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500">{i.brand_name}</p>
                      <p className="truncate text-sm font-bold">{i.name}</p>
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums">{yen(i.price_tax_in)}</p>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => onShowList(active)}
                className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-ink py-2.5 text-sm font-bold text-white"
              >
                {facility ? (
                  <>{areaLabel(active)}の<span className="tabular-nums">{byArea[active]?.length ?? 0}</span>件をリストで見る</>
                ) : (
                  <>このエリアの<span className="tabular-nums">{list.length}</span>件をリストで見る</>
                )}
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </section>
      ) : (
        <p className="mt-2 text-xs text-slate-500">ピンをタップすると、そのエリアのおすすめを表示します。拡大すると百貨店・駅ナカなどの施設ごとに分かれます。</p>
      )}
    </div>
  );
}
