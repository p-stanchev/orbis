import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Globe2, Sun, Play, Pause } from "lucide-react";
import TerrainScene, { type CelestialBody, type Ephemeris, type TerrainPatch } from "./TerrainScene";
import SplitWorkspace from "./SplitWorkspace";

type Props = {
  latitude: number;
  longitude: number;
  arrivalUtc: string;
  durationHours: number;
  siteName: string;
  map: ReactNode;
};

const fmt = (date: Date) => Number.isFinite(date.getTime())
  ? date.toISOString().slice(0, 16).replace("T", " ") + " UTC"
  : "Invalid arrival time";

const bodyStatus = (body: CelestialBody) => {
  if (body.terrain_visibility === "hidden") return body.geometric_visibility === "hidden" ? "Below geometric horizon" : "Blocked by terrain";
  if (body.terrain_visibility === "partial") return "Partly visible above terrain";
  return "Above terrain horizon";
};

export default function MissionAnalysis({ latitude, longitude, arrivalUtc, durationHours, siteName, map }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState<Ephemeris | null>(null);
  const [terrain, setTerrain] = useState<TerrainPatch | null>(null);
  const [error, setError] = useState("");
  const [terrainError, setTerrainError] = useState("");
  const [loading, setLoading] = useState(false);
  const arrival = useMemo(() => new Date(arrivalUtc), [arrivalUtc]);
  const duration = Math.max(1, durationHours);
  const viewTime = new Date(arrival.getTime() + elapsed * 3600_000);

  useEffect(() => { setElapsed(0); setPlaying(false); }, [arrivalUtc, latitude, longitude]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setElapsed(value => {
      const next = value + Math.max(0.25, duration / 200);
      if (next >= duration) { setPlaying(false); return duration; }
      return next;
    }), 800);
    return () => window.clearInterval(id);
  }, [playing, duration]);

  useEffect(() => {
    const controller = new AbortController();
    setTerrain(null);
    setTerrainError("");
    const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
    fetch(`/api/terrain/local-patch?${query}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || "Terrain unavailable");
        }
        return response.json() as Promise<TerrainPatch>;
      })
      .then(setTerrain)
      .catch(reason => { if (!controller.signal.aborted) setTerrainError(String(reason.message || reason)); });
    return () => controller.abort();
  }, [latitude, longitude]);

  useEffect(() => {
    const controller = new AbortController();
    if (!Number.isFinite(viewTime.getTime())) return;
    const params = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude), time: viewTime.toISOString(),
    });
    setLoading(true);
    setError("");
    fetch(`/api/ephemeris?${params}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || "Ephemeris unavailable");
        }
        return response.json() as Promise<Ephemeris>;
      })
      .then(data => { setResult(data); setError(""); })
      .catch(reason => {
        if (!controller.signal.aborted) { setError(String(reason.message || reason)); setResult(null); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [latitude, longitude, viewTime.getTime()]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#191919] text-[#ddd]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#444] px-3 py-2 text-xs">
        <span className="min-w-0 text-white">MISSION ANALYSIS <span className="ml-2 text-[#999]">{siteName}</span></span>
        <span className="text-[10px] text-[#999]">{terrain?.resolution ? `LOLA ${terrain.resolution}` : "Local DEM"}{terrain ? ` · ${Math.round(terrain.coverage_fraction * 100)}% coverage` : ""}</span>
      </div>
      <SplitWorkspace active splitId="analysis" primary={map} secondary={
        <div className="relative h-full min-h-0">
          <TerrainScene patch={terrain} ephemeris={result} siteLabel={siteName} />
          {terrainError && <p className="absolute left-3 right-3 top-3 bg-[#292929] p-2 text-xs text-[#ef9292]">{terrainError}. No terrain surface displayed.</p>}
          {!terrain && !terrainError && <p className="pointer-events-none absolute left-3 top-3 bg-[#292929]/80 p-2 text-xs">Loading local DEM...</p>}
        </div>
      } />
      <div className="orbis-scroll max-h-[45%] shrink-0 space-y-2 overflow-y-auto overscroll-contain border-t border-[#444] bg-[#252525] p-2.5 text-xs leading-relaxed sm:max-h-[40%] sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[#bbb]">MISSION TIME</span>
          <span className="font-mono text-[#eee]">{fmt(viewTime)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="bg-[#383838] p-2 hover:bg-[#484848]" aria-label={playing ? "Pause timeline" : "Play timeline"} onClick={() => { if (elapsed >= duration) setElapsed(0); setPlaying(!playing); }}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input type="range" min={0} max={duration} step={Math.max(0.25, duration / 1000)} value={elapsed}
            onChange={event => { setPlaying(false); setElapsed(Number(event.target.value)); }}
            aria-label="Time since mission arrival" className="min-w-0 flex-1 accent-[#03ace4]" />
          <span className="w-14 text-right font-mono text-[#aaa]">{elapsed.toFixed(1)} h</span>
        </div>
        <div className="flex justify-between text-[10px] text-[#999]"><span>{fmt(arrival)}</span><span>+{duration}h</span></div>
        <div className="border-t border-[#444] pt-2 text-[#bbb]">Live readings</div>
        <div className="grid gap-2 border-t border-[#444] pt-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,210px),1fr))" }}>
          {(["sun", "earth"] as const).map(body => (
            <div key={body} className="space-y-1 bg-[#303030] p-2">
              <div className="flex items-center gap-1" style={{ color: body === "sun" ? "#ff9900" : "#03ace4" }}>
                {body === "sun" ? <Sun size={13} /> : <Globe2 size={13} />} {body === "sun" ? "Sun" : "Earth"}
              </div>
              {result ? <>
                <div className="text-[#eee]">{bodyStatus(result[body])}</div>
                <div className="text-[#aaa]">Elevation {result[body].elevation_deg.toFixed(2)}° · azimuth {result[body].azimuth_deg.toFixed(1)}°</div>
                <div className="text-[#aaa]">Local horizon {result[body].terrain_horizon_deg?.toFixed(2)}°</div>
              </> : <div className="text-[#999]">{loading ? "Calculating..." : "Unavailable"}</div>}
            </div>
          ))}
        </div>
        {error && <div role="alert" className="break-words text-[#ef9292]">{error}</div>}
        <details className="text-[10px] leading-relaxed text-[#aaa]"><summary className="cursor-pointer">Model details</summary>
          Sun/Earth visibility uses sampled terrain horizons{result?.near_5m_used ? ", with 5 m DEM near the site" : ""} and the 80 m DEM farther out. {result?.terrain_coverage_min_km !== undefined ? `Far terrain is covered to at least ${result.terrain_coverage_min_km} km in every sampled direction. ` : ""}The 3D patch has 2x vertical relief; lighting and nearby shadows are illustrative. Power systems and ground stations are not modeled.
        </details>
      </div>
    </div>
  );
}
