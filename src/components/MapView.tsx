"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip } from "react-leaflet";
import type { Area, Item } from "@/lib/types";
import { AREA_COORDS, areaLabel } from "@/lib/constants";

// 件数入りの丸いピン（画像アイコンを使わないので Leaflet の既定アイコン問題も起きない）
const pin = (count: number, active: boolean) =>
  L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;font:700 13px/1 system-ui;font-variant-numeric:tabular-nums;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);background:${active ? "#DC2626" : count ? "#0F172A" : "#94A3B8"};color:#fff">${count}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

export default function MapView({
  items, selected, onSelect,
}: {
  items: Item[]; // エリア以外の条件で絞り込んだ商品
  selected: Area | "online" | null;
  onSelect: (area: Area) => void;
}) {
  const counts: Record<string, number> = {};
  for (const i of items) for (const a of i.areas) counts[a] = (counts[a] ?? 0) + 1;

  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <MapContainer center={[35.69, 139.745]} zoom={11.5} zoomSnap={0.5} scrollWheelZoom style={{ height: "60vh", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {Object.entries(AREA_COORDS).map(([id, pos]) => (
          <Marker
            key={id}
            position={pos}
            icon={pin(counts[id] ?? 0, selected === id)}
            eventHandlers={{ click: () => onSelect(id as Area) }}
          >
            <Tooltip direction="top" offset={[0, -16]}>{areaLabel(id)} {counts[id] ?? 0}件</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
