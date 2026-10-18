"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import { ChevronRight, Loader2, LocateFixed, X } from "lucide-react";
import type { Area, Item } from "@/lib/types";
import { AREA_COORDS, areaLabel, yen } from "@/lib/constants";

// 件数入りの丸いピン（画像アイコンを使わないので Leaflet の既定アイコン問題も起きない）
const pin = (count: number, active: boolean) =>
  L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;font:700 13px/1 system-ui;font-variant-numeric:tabular-nums;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);background:${active ? "#DC2626" : count ? "#0F172A" : "#94A3B8"};color:#fff">${count}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

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

  const nearest = useMemo(() => {
    if (!me) return null;
    return Object.entries(AREA_COORDS)
      .map(([id, pos]) => ({ id: id as Area, km: distanceKm(me, pos) }))
      .sort((a, b) => a.km - b.km)[0];
  }, [me]);

  const locate = () => {
    if (!navigator.geolocation) return setLocError("この端末では現在地を取得できません。");
    setLocating(true);
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const pos: [number, number] = [coords.latitude, coords.longitude];
        setMe(pos);
        setAccuracy(coords.accuracy);
        setFlyTarget(pos);
        setLocating(false);
        const near = Object.entries(AREA_COORDS).sort((a, b) => distanceKm(pos, a[1]) - distanceKm(pos, b[1]))[0];
        if (near && distanceKm(pos, near[1]) < 5) setActive(near[0] as Area);
      },
      (e) => {
        setLocating(false);
        setLocError(e.code === e.PERMISSION_DENIED ? "位置情報の利用が許可されていません。ブラウザの設定から許可してください。" : "現在地を取得できませんでした。");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const list = active ? byArea[active] ?? [] : [];
  const km = me && active ? distanceKm(me, AREA_COORDS[active]) : null;

  return (
    <div>
      <div className="relative isolate z-0 overflow-hidden rounded-2xl border border-line">
        <MapContainer center={[35.69, 139.745]} zoom={11.5} zoomSnap={0.5} scrollWheelZoom style={{ height: "55vh", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FlyTo pos={flyTarget} />
          {Object.entries(AREA_COORDS).map(([id, pos]) => (
            <Marker
              key={id}
              position={pos}
              icon={pin(byArea[id]?.length ?? 0, active === id)}
              eventHandlers={{ click: () => setActive(id as Area) }}
            >
              <Tooltip direction="top" offset={[0, -16]}>{areaLabel(id)} {byArea[id]?.length ?? 0}件</Tooltip>
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
          いちばん近いエリアは <button className="font-bold underline" onClick={() => setActive(nearest.id)}>{areaLabel(nearest.id)}</button>（約<span className="tabular-nums">{nearest.km.toFixed(1)}</span>km）です。
        </p>
      )}

      {active ? (
        <section className="mt-3 rounded-2xl border border-line bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold">{areaLabel(active)}</h3>
              <p className="text-xs text-slate-500">
                条件に合う商品 <span className="tabular-nums">{list.length}</span>件
                {km != null && <>・現在地から約<span className="tabular-nums">{km.toFixed(1)}</span>km</>}
              </p>
            </div>
            <button onClick={() => setActive(null)} aria-label="閉じる" className="rounded-full p-1 hover:bg-slate-100"><X size={18} /></button>
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
                このエリアの<span className="tabular-nums">{list.length}</span>件をリストで見る<ChevronRight size={16} />
              </button>
            </>
          )}
        </section>
      ) : (
        <p className="mt-2 text-xs text-slate-500">ピンをタップすると、そのエリアのおすすめを表示します。</p>
      )}
    </div>
  );
}
