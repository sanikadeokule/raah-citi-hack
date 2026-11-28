"use client";
// Leaflet map of the student's home and the nearest centres. Needs internet for map tiles;
// offline the list below it still shows every centre with its distance.
/* eslint-disable @typescript-eslint/no-explicit-any */
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { THEME } from "@/lib/theme";
import { useApp } from "@/lib/store";

export function CentreMap({ centres, home, className = "h-56" }: { centres: any[]; home: { lat?: number; lon?: number; label: string }; className?: string }) {
  const { t, online } = useApp();
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!online || !el.current) return;
    let map: any;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18, attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      const pts: [number, number][] = [];
      if (home.lat != null && home.lon != null) {
        pts.push([home.lat, home.lon]);
        L.circleMarker([home.lat, home.lon], { radius: 9, color: "#fff", weight: 2, fillColor: THEME.saffron, fillOpacity: 1 })
          .addTo(map).bindPopup(`${home.label}`);
      }
      centres.filter((c) => c.lat != null).forEach((c, i) => {
        pts.push([c.lat, c.lon]);
        L.circleMarker([c.lat, c.lon], { radius: 9, color: "#fff", weight: 2, fillColor: THEME.navy, fillOpacity: 1 })
          .addTo(map)
          .bindTooltip(String(i + 1), { permanent: true, direction: "center", className: "centre-num" })
          .bindPopup(`<b>${c.name}</b><br>${c.distance_km ?? "—"} km${c.approximate ? ` (${t("approx_distance")})` : ""}`);
        if (home.lat != null && home.lon != null) L.polyline([[home.lat, home.lon], [c.lat, c.lon]], { color: THEME.navy, weight: 1, dashArray: "4 4" }).addTo(map);
      });
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
      else if (pts.length) map.setView(pts[0], 11);
    });
    return () => { cancelled = true; map?.remove(); };
  }, [centres, home.lat, home.lon, home.label, online, t]);

  if (!online) return <p className="mb-2 text-xs text-[var(--muted)]">{t("map_offline")}</p>;
  return (
    <>
      <div ref={el} className={`mb-1 w-full overflow-hidden rounded-xl ring-1 ring-black/10 ${className}`} role="img" aria-label={t("nearest_centres")} />
      {centres.some((c) => c.approximate) && <p className="mb-2 text-xs text-[var(--muted)]">{t("map_approx_note")}</p>}
    </>
  );
}
