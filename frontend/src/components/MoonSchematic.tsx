import type { Ephemeris } from "./TerrainScene";

export type OrbitGeometry = {
  time_utc: string;
  moon_xy_km: [number, number];
  sun_xy_km: [number, number];
  moon_distance_km: number;
  site_axis_xy: [number, number];
  earth_facing_axis_xy: [number, number];
};

const earth = { x: 400, y: 280 };
const earthRadius = 58;
const moonOrbitRadius = 176;
const moonRadius = 32;

function unit(vector: [number, number]) {
  const size = Math.hypot(vector[0], vector[1]);
  return size > 0.000001 ? { x: vector[0] / size, y: vector[1] / size } : { x: 1, y: 0 };
}

function point(origin: { x: number; y: number }, vector: { x: number; y: number }, distance: number) {
  return { x: origin.x + vector.x * distance, y: origin.y - vector.y * distance };
}

function rayEnd(origin: { x: number; y: number }, target: { x: number; y: number }, radius: number) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);
  return { x: target.x - radius * dx / distance, y: target.y - radius * dy / distance };
}

function projectedCircleCrossing(start: { x: number; y: number }, end: { x: number; y: number }, center: { x: number; y: number }, radius: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const along = ((center.x - start.x) * dx + (center.y - start.y) * dy) / length;
  const offsetSq = (center.x - start.x) ** 2 + (center.y - start.y) ** 2 - along ** 2;
  if (offsetSq >= radius ** 2) return null;
  const entry = along - Math.sqrt(radius ** 2 - offsetSq);
  return entry > 0 && entry < length ? entry : null;
}

function illuminatedHalf(origin: { x: number; y: number }, radius: number, sunDirection: { x: number; y: number }, color: string) {
  const angle = -Math.atan2(sunDirection.y, sunDirection.x) * 180 / Math.PI;
  return <rect x={origin.x} y={origin.y - radius} width={radius} height={radius * 2}
    transform={`rotate(${angle} ${origin.x} ${origin.y})`} fill={color} />;
}

function visibilityText(body: Ephemeris["sun"]) {
  if (body.terrain_visibility === "hidden") return body.geometric_visibility === "hidden" ? "below horizon" : "terrain blocked";
  if (body.terrain_visibility === "partial") return centerClearsTerrain(body) ? "center clear, disk partly visible" : "limb visible, center blocked";
  return "disk visible";
}

function centerClearsTerrain(body: Ephemeris["sun"]) {
  return body.terrain_horizon_deg !== undefined && body.elevation_deg > body.terrain_horizon_deg;
}

export default function MoonSchematic({ orbit, ephemeris, siteLabel, error }: {
  orbit: OrbitGeometry | null; ephemeris: Ephemeris | null; siteLabel: string;
  error: string }) {
  const moonDirection = orbit ? unit(orbit.moon_xy_km) : null;
  const sunDirection = orbit ? unit(orbit.sun_xy_km) : null;
  const moon = moonDirection ? point(earth, moonDirection, moonOrbitRadius) : null;
  const sun = sunDirection ? point(earth, sunDirection, 250) : null;
  const site = orbit && moon ? point(moon, unit(orbit.site_axis_xy), moonRadius) : null;
  const nearSide = orbit && moon ? point(moon, unit(orbit.earth_facing_axis_xy), moonRadius * 0.78) : null;
  const currentEphemeris = orbit && ephemeris && Date.parse(orbit.time_utc) === Date.parse(ephemeris.time_utc)
    ? ephemeris : null;
  const spinPhase = orbit ? ((Date.parse(orbit.time_utc) / 1000 % 86164) + 86164) % 86164 / 86164 * 2 * Math.PI : 0;
  const spinMarker = point(earth, { x: Math.cos(spinPhase), y: Math.sin(spinPhase) }, earthRadius * 0.72);
  const earthRay = site ? rayEnd(site, earth, earthRadius) : null;
  const sunRay = site && sun ? rayEnd(site, sun, 27) : null;
  const sunProjectionCrossing = site && sunRay ? projectedCircleCrossing(site, sunRay, earth, earthRadius + 4) : null;
  const sunRayTip = site && sunRay && sunProjectionCrossing !== null
    ? point(site, { x: (sunRay.x - site.x) / Math.hypot(sunRay.x - site.x, sunRay.y - site.y),
      y: (site.y - sunRay.y) / Math.hypot(sunRay.x - site.x, sunRay.y - site.y) },
      Math.min(70, Math.max(0, sunProjectionCrossing - 10))) : sunRay;

  return <div className="flex h-full min-h-0 flex-col bg-[#1b1e20] text-[#ddd]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3e4448] px-3 py-2 text-[11px]">
      <span className="font-medium text-white">Earth-centered · top-down</span>
      <span className="font-mono text-[#aeb8bd]">{orbit ? orbit.time_utc.slice(0, 16).replace("T", " ") + " UTC" : "Loading positions…"}</span>
    </div>
    <svg role="img" aria-label={`Earth-centered 2D orbit view with Moon, Sun and ${siteLabel}`} viewBox="0 0 800 560"
      preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1">
      <defs>
        <clipPath id="orbis-orbit-earth"><circle cx={earth.x} cy={earth.y} r={earthRadius} /></clipPath>
        {moon && <clipPath id="orbis-orbit-moon"><circle cx={moon.x} cy={moon.y} r={moonRadius} /></clipPath>}
        <marker id="orbis-orbit-sun-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#ffb45a" />
        </marker>
      </defs>
      <circle cx={earth.x} cy={earth.y} r={moonOrbitRadius} fill="none" stroke="#454d51" strokeWidth="1.5" strokeDasharray="4 7" />
      <circle cx={earth.x} cy={earth.y} r={earthRadius} fill="#173b50" stroke="#7ac2df" strokeWidth="2" />
      {sunDirection && <g clipPath="url(#orbis-orbit-earth)">{illuminatedHalf(earth, earthRadius, sunDirection, "#4b8caf")}</g>}
      {orbit && <>
        <line x1={earth.x} y1={earth.y} x2={spinMarker.x} y2={spinMarker.y} stroke="#c6f1ff" strokeWidth="1.5" opacity="0.7" />
        <circle cx={spinMarker.x} cy={spinMarker.y} r="4" fill="#d8f4ff" />
      </>}
      <text x={earth.x} y={earth.y + 6} textAnchor="middle" fill="white" fontSize="19" fontWeight="600">Earth</text>
      {moon && <>
        <circle cx={moon.x} cy={moon.y} r={moonRadius} fill="#34393c" stroke="#b9c1c4" strokeWidth="2" />
        {sunDirection && <g clipPath="url(#orbis-orbit-moon)">{illuminatedHalf(moon, moonRadius, sunDirection, "#8c9598")}</g>}
        {nearSide && <line x1={moon.x} y1={moon.y} x2={nearSide.x} y2={nearSide.y} stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />}
        <circle cx={moon.x} cy={moon.y} r={moonRadius} fill="none" stroke="#b9c1c4" strokeWidth="2" />
        <text x={moon.x} y={moon.y + 4} textAnchor="middle" fill="white" fontSize="11" fontWeight="600">Moon</text>
      </>}
      {sun && <>
        <circle cx={sun.x} cy={sun.y} r="27" fill="#ff9900" stroke="#ffcf8d" strokeWidth="2" />
        <text x={sun.x} y={sun.y + 5} textAnchor="middle" fill="#1b1e20" fontSize="13" fontWeight="700">Sun</text>
      </>}
      {site && currentEphemeris && earthRay && centerClearsTerrain(currentEphemeris.earth) &&
        <line x1={site.x} y1={site.y} x2={earthRay.x} y2={earthRay.y} stroke="#7ed2ef" strokeWidth="2.5"
          strokeDasharray={currentEphemeris.earth.terrain_visibility === "partial" ? "5 4" : undefined} />}
      {site && currentEphemeris && sunRayTip && centerClearsTerrain(currentEphemeris.sun) &&
        <line x1={site.x} y1={site.y} x2={sunRayTip.x} y2={sunRayTip.y} stroke="#ffb45a" strokeWidth="2.5"
          markerEnd={sunProjectionCrossing !== null ? "url(#orbis-orbit-sun-arrow)" : undefined}
          strokeDasharray={currentEphemeris.sun.terrain_visibility === "partial" ? "5 4" : undefined} />}
      {site && <>
        <circle cx={site.x} cy={site.y} r="9" fill="#03ace4" opacity="0.22" />
        <circle cx={site.x} cy={site.y} r="4.5" fill="#03ace4" stroke="white" strokeWidth="1.5" />
      </>}
      {!orbit && <text x={earth.x} y="520" textAnchor="middle" fill="#aeb8bd" fontSize="14">Calculating orbital positions…</text>}
    </svg>
    <div className="space-y-1 border-t border-[#3e4448] px-3 py-2 text-[10px] text-[#aeb8bd]">
      {error ? <span role="alert" className="text-[#ef9292]">{error}</span> : <>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {currentEphemeris ? <>
            <span className="text-[#7ed2ef]">Earth from site: {visibilityText(currentEphemeris.earth)}</span>
            <span className="text-[#ffb45a]">Sun from site: {visibilityText(currentEphemeris.sun)}</span>
          </> : <span>Geometric positions projected onto the ecliptic plane.</span>}
        </div>
        <details>
          <summary className="cursor-pointer text-[#d4dadd]">About this view</summary>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {orbit && <span>Earth–Moon {Math.round(orbit.moon_distance_km).toLocaleString()} km</span>}
            <span><span className="text-[#03ace4]">●</span> Site marker on Moon rim</span>
            <span><span className="text-white">━</span> Moon surface turns once per orbit; lit half faces Sun</span>
            <span>Earth spin dot · approximate 24 h; shading follows Sun</span>
          </div>
          <p className="mt-1">Rays begin at the site when each body’s center clears sampled lunar terrain. The Sun arrow stops where its top-down projection would cross Earth’s enlarged disk; it does not indicate an eclipse. Sizes and site placement are schematic. Eclipses, Earth ground-station contact, and solar power are not modeled.</p>
        </details>
      </>}
    </div>
  </div>;
}
