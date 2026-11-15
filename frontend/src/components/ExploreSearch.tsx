import { useEffect, useRef, useState } from "react";
import type { SearchGridCell, SearchRegion } from "./VisibilityStatistics";

type Area = { latitude: number; longitude: number; radius_m: number };
type Result = { regions: SearchRegion[]; grid: SearchGridCell[]; grid_spacing_m: number;
  evaluated_cells: number; outside_coverage_cells: number; color_mode: string;
  slope_limit_deg?: number | null; slope_screened_cells?: number | null;
  slope_5m_cells?: number | null; slope_80m_cells?: number | null;
  slope_unchecked_cells?: number | null; slope_excluded_cells?: number | null; slope_warning?: string | null;
  roughness_limit_m?: number | null; roughness_screened_cells?: number | null;
  roughness_unchecked_cells?: number | null; roughness_excluded_cells?: number | null;
  surface_measured_cells?: number };
type Job = { status: "running" | "completed" | "failed"; progress: number; result: Result | null; error: string | null };
type Props = { area: Area; onAreaChange: (area: Area) => void;
  onRegions: (areas: SearchRegion[], grid: SearchGridCell[], spacing: number) => void;
  onCreateProject: (name: string, latitude: number, longitude: number, radius: number, arrival: string, duration: number,
    siteLatitude: number, siteLongitude: number) => Promise<void> };

const tone = { green: "#60ba7b", yellow: "#ff9900", red: "#da0004" };

export default function ExploreSearch({ area, onAreaChange, onRegions, onCreateProject }: Props) {
  const [center, setCenter] = useState(() => ({ latitude: String(area.latitude), longitude: String(area.longitude), radius: String(area.radius_m / 1000) }));
  const [arrival, setArrival] = useState(() => new Date().toISOString().slice(0, 16));
  const [duration, setDuration] = useState("336");
  const [sunLimit, setSunLimit] = useState("");
  const [earthLimit, setEarthLimit] = useState("");
  const [dailyEarth, setDailyEarth] = useState("");
  const [minArea, setMinArea] = useState("");
  const [slopeLimit, setSlopeLimit] = useState("");
  const [roughnessLimit, setRoughnessLimit] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [suggestions, setSuggestions] = useState<{ arrival: string; meeting: number | null; score: number }[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const currentSearch = useRef<{ arrival: string; duration: number; body: object } | null>(null);
  const requestedArea = useRef<Area | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => setCenter({ latitude: String(area.latitude), longitude: String(area.longitude), radius: String(area.radius_m / 1000) }),
    [area.latitude, area.longitude, area.radius_m]);
  useEffect(() => {
    controller.current?.abort();
    setRunning(false);
    setResult(null);
    setSuggestions([]);
    currentSearch.current = null;
    onRegions([], [], 0);
  }, [arrival, duration, sunLimit, earthLimit, dailyEarth, minArea, slopeLimit, roughnessLimit]);
  useEffect(() => {
    if (requestedArea.current?.latitude === area.latitude &&
      requestedArea.current?.longitude === area.longitude &&
      requestedArea.current?.radius_m === area.radius_m) return;
    controller.current?.abort();
    setRunning(false);
    setResult(null);
    setSuggestions([]);
    currentSearch.current = null;
  }, [area.latitude, area.longitude, area.radius_m]);

  function invalidate() {
    controller.current?.abort();
    requestedArea.current = null;
    setRunning(false);
    setResult(null);
    setSuggestions([]);
    currentSearch.current = null;
    onRegions([], [], 0);
  }

  function commitCenter() {
    const latitude = Number(center.latitude);
    const longitude = Number(center.longitude);
    const radius_m = Number(center.radius) * 1000;
    if (!center.latitude.trim() || !center.longitude.trim() || !center.radius.trim() ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > -80 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(radius_m) || radius_m < 50 || radius_m > 20000) {
      setError("Enter a latitude from −90 to −80, longitude from −180 to 180, and radius from 0.05 to 20 km.");
      return;
    }
    setError("");
    if (latitude !== area.latitude || longitude !== area.longitude || radius_m !== area.radius_m)
      onAreaChange({ latitude, longitude, radius_m });
  }

  async function scan(body: object, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<Result> {
    const started = await fetch("/api/visibility/regions/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    });
    if (!started.ok) {
      const detail = await started.json().catch(() => ({}));
      throw new Error(typeof detail.detail === "string" ? detail.detail : `Search failed (${started.status})`);
    }
    const { id } = await started.json() as { id: string };
    for (;;) {
      const response = await fetch(`/api/visibility/jobs/${encodeURIComponent(id)}`, { signal });
      if (!response.ok) throw new Error(`Search status unavailable (${response.status})`);
      const job = await response.json() as Job;
      if (job.status === "failed") throw new Error(job.error || "Search failed");
      if (job.status === "completed") {
        if (!job.result) throw new Error("Search returned no result");
        return job.result;
      }
      onProgress(job.progress);
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => { signal.removeEventListener("abort", cancelled); resolve(); }, 1000);
        function cancelled() { window.clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }
        signal.addEventListener("abort", cancelled, { once: true });
      });
    }
  }

  async function search() {
    const searchArea = { latitude: Number(center.latitude), longitude: Number(center.longitude), radius_m: Number(center.radius) * 1000 };
    const date = new Date(`${arrival}:00Z`);
    const hours = Number(duration);
    const circleArea = Math.PI * (searchArea.radius_m / 1000) ** 2;
    const minimum = minArea.trim() === "" ? Math.max(0.001, Math.min(4, circleArea * 0.05)) : Number(minArea);
    const daily = dailyEarth.trim() === "" ? 0 : Number(dailyEarth);
    const sun = Number(sunLimit);
    const earth = Number(earthLimit);
    const slope = slopeLimit.trim() === "" ? null : Number(slopeLimit);
    const roughness = roughnessLimit.trim() === "" ? null : Number(roughnessLimit);
    if (!Number.isFinite(date.getTime()) || !Number.isInteger(hours) || hours < 1 || hours > 8760 ||
      !center.latitude.trim() || !center.longitude.trim() || !center.radius.trim() ||
      !Number.isFinite(searchArea.latitude) || searchArea.latitude < -90 || searchArea.latitude > -80 ||
      !Number.isFinite(searchArea.longitude) || searchArea.longitude < -180 || searchArea.longitude > 180 ||
      !Number.isFinite(searchArea.radius_m) || searchArea.radius_m < 50 || searchArea.radius_m > 20000 ||
      !sunLimit.trim() || !earthLimit.trim() ||
      !Number.isFinite(minimum) || minimum < .001 || minimum > Math.min(1000, circleArea) ||
      !Number.isFinite(daily) || daily < 0 || daily > 24 ||
      !Number.isFinite(sun) || sun < 0 || sun > 8760 ||
      !Number.isFinite(earth) || earth < 0 || earth > 8760 ||
      (slope !== null && (!Number.isFinite(slope) || slope < 0 || slope > 90)) ||
      (roughness !== null && (!Number.isFinite(roughness) || roughness < 0 || roughness > 1000))) {
      setError("Enter the region, UTC timing, and both outage limits. Check any optional filters you entered.");
      return;
    }
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const body = { ...searchArea,
      arrival_utc: date.toISOString(), duration_hours: hours, max_no_sun_hours: sun,
      max_no_earth_hours: earth, min_daily_earth_hours: daily, min_area_km2: minimum,
      max_slope_deg: slope, max_roughness_m: roughness, sun_weight: 50 };
    setError("");
    setRunning(true);
    setResult(null);
    setSuggestions([]);
    onRegions([], [], 0);
    currentSearch.current = { arrival: date.toISOString(), duration: hours, body };
    requestedArea.current = searchArea;
    try {
      const found = await scan(body, next.signal, fraction => setProgress(`Scanning · ${Math.round(fraction * 100)}%`));
      if (next.signal.aborted) return;
      setResult(found);
      onRegions(found.regions, found.grid, found.grid_spacing_m);
    } catch (reason) {
      if (!next.signal.aborted) setError(reason instanceof Error ? reason.message : "Search failed");
    } finally {
      if (!next.signal.aborted) { setRunning(false); setProgress(""); }
    }
  }

  async function compareDates() {
    const original = currentSearch.current;
    if (!original) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setRunning(true);
    setError("");
    setSuggestions([]);
    const dates = [];
    try {
      for (const days of [7, 14, 21]) {
        const shifted = new Date(Date.parse(original.arrival) + days * 86400000).toISOString();
        setProgress(`Checking ${days} days later`);
        const found = await scan({ ...original.body, arrival_utc: shifted }, next.signal, () => {});
        const best = found.regions[0];
        dates.push({ arrival: shifted, meeting: best?.meeting_percent ?? null, score: best?.robust_score ?? 0 });
        if (!next.signal.aborted) setSuggestions([...dates].sort((a, b) =>
          (b.meeting ?? -1) - (a.meeting ?? -1) || b.score - a.score));
      }
    } catch (reason) {
      if (!next.signal.aborted) setError(reason instanceof Error ? reason.message : "Date comparison failed");
    } finally {
      if (!next.signal.aborted) { setRunning(false); setProgress(""); }
    }
  }

  async function save(areaResult: SearchRegion) {
    const search = currentSearch.current;
    if (!search || !name.trim()) { setError("Name the project first."); return; }
    setSaving(true);
    setError("");
    try {
      const candidateRadius = Math.min(20000, Math.max(50, Math.ceil(
        Math.sqrt(areaResult.area_km2 / 2) * 1000 + (result?.grid_spacing_m ?? 0) / Math.sqrt(2))));
      await onCreateProject(name.trim(), areaResult.center_latitude, areaResult.center_longitude,
        candidateRadius, search.arrival, search.duration,
        areaResult.representative_latitude, areaResult.representative_longitude);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create project");
    } finally { setSaving(false); }
  }

  const input = "mt-1 block h-9 w-full min-w-0 border border-[#555] bg-[#292929] px-2 text-xs font-normal text-white outline-none focus:border-accent [color-scheme:dark]";
  const label = "block min-w-0 text-xs text-[#aaa]";
  return <div className="orbis-explore mx-auto max-w-[1200px] space-y-3 pb-3 text-xs leading-relaxed">
    <p className="text-[#aaa]">Find candidate areas before creating a project.</p>
    <section className="orbis-panel space-y-3 p-3">
      <h3 className="font-medium text-white">Search area</h3>
      <p className="text-[#aaa]">Click the map or drag the white circle to move the area.</p>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        <label className={label}>Latitude
          <input className={input} type="text" inputMode="decimal" value={center.latitude}
            onChange={event => { setCenter(old => ({ ...old, latitude: event.target.value })); invalidate(); }} onBlur={commitCenter} /></label>
        <label className={label}>Longitude
          <input className={input} type="text" inputMode="decimal" value={center.longitude}
            onChange={event => { setCenter(old => ({ ...old, longitude: event.target.value })); invalidate(); }} onBlur={commitCenter} /></label>
      </div>
      <label className={label}>Search radius <span className="font-normal text-[#929ca1]">· km, up to 20</span>
        <input className={input} type="text" inputMode="decimal" value={center.radius}
          onChange={event => { setCenter(old => ({ ...old, radius: event.target.value })); invalidate(); }} onBlur={commitCenter} /></label>
    </section>
    <section className="orbis-panel space-y-3 p-3"><h3 className="font-medium text-white">Mission timing</h3>
      <div className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2">
        <label className={label}>Arrival <span className="font-normal text-[#929ca1]">· UTC</span>
          <input className={input} type="datetime-local" value={arrival} onChange={event => setArrival(event.target.value)} /></label>
        <label className={label}>Duration <span className="font-normal text-[#929ca1]">· hours</span>
          <input className={input} type="number" min={1} max={8760} value={duration} onChange={event => setDuration(event.target.value)} /></label>
      </div>
    </section>
    <section className="orbis-panel space-y-3 p-3">
      <h3 className="font-medium text-white">Filters</h3>
      <p className="text-[#aaa]">Set both outage limits. Add contact, area, slope, or roughness requirements if needed.</p>
      <div className="grid grid-cols-1 gap-4 min-[440px]:grid-cols-2">
        <label className={label}>Longest darkness <span className="text-[#999]">· h</span>
          <input className={input} type="number" min={0} max={8760} step="any" required placeholder="Hours" value={sunLimit} onChange={event => setSunLimit(event.target.value)} /></label>
        <label className={label}>Longest Earth outage <span className="text-[#999]">· h</span>
          <input className={input} type="number" min={0} max={8760} step="any" required placeholder="Hours" value={earthLimit} onChange={event => setEarthLimit(event.target.value)} /></label>
        <label className={label}>Earth contact / day <span className="text-[#999]">· h, optional</span>
          <input className={input} type="number" min={0} max={24} step="0.5" placeholder="No minimum" value={dailyEarth} onChange={event => setDailyEarth(event.target.value)} /></label>
        <label className={label}>Minimum candidate area <span className="text-[#999]">· km², optional</span>
          <input className={input} type="number" min={0.001} max={1000} step="any" placeholder="Auto" value={minArea} onChange={event => setMinArea(event.target.value)} /></label>
        <label className={label}>Maximum local slope <span className="text-[#999]">· °, optional</span>
          <input className={input} type="number" min={0} max={90} step="any" placeholder="No slope filter" value={slopeLimit} onChange={event => setSlopeLimit(event.target.value)} /></label>
        <label className={label}>Maximum roughness <span className="text-[#999]">· m, optional</span>
          <input className={input} type="number" min={0} max={1000} step="any" placeholder="No roughness filter" value={roughnessLimit} onChange={event => setRoughnessLimit(event.target.value)} /></label>
      </div>
    </section>
    <button type="button" disabled={running} onClick={() => void search()}
      className="min-h-10 w-full bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#079bc9] disabled:cursor-wait disabled:opacity-50">{running ? progress || "Calculating…" : "Search candidate areas"}</button>
    {error && <p role="alert" className="text-[#ef9292]">{error}</p>}
    {result && <section className="space-y-2 border-t border-[#444] pt-3">
      <div className="flex flex-wrap items-end justify-between gap-2"><h3 className="font-medium text-white">Candidate areas</h3>
        <span className="text-[11px] text-[#aeb6ba]">{result.evaluated_cells} sampled cells · {result.grid_spacing_m} m grid</span></div>
      {result.surface_measured_cells !== undefined && <p className="text-[11px] text-[#aeb6ba]">Coarse surface measurements available at {result.surface_measured_cells} of {result.evaluated_cells} sampled cells.</p>}
      <p className="text-[11px] text-[#aeb6ba]">{result.color_mode === "mission_needs" ? "Green meets entered limits; yellow is close; red misses them." : "Green ≥70%, yellow ≥35%, red <35% by weighted visibility."} Gray marks missing DEM or unchecked terrain limits. Colors are screening estimates, not landing safety.</p>
      {result.outside_coverage_cells > 0 && <p className="text-[11px] text-[#aeb6ba]">{result.outside_coverage_cells} cells outside map coverage.</p>}
      {result.slope_limit_deg != null && <p className="text-[11px] text-[#aeb6ba]">Slope ≤{result.slope_limit_deg}°: {result.slope_screened_cells} screened ({result.slope_5m_cells} at 5 m, {result.slope_80m_cells} at 80 m), {result.slope_excluded_cells} too steep, {result.slope_unchecked_cells} unchecked. Missing slope data skips this filter for those cells.</p>}
      {result.roughness_limit_m != null && <p className="text-[11px] text-[#aeb6ba]">Roughness ≤{result.roughness_limit_m} m: {result.roughness_screened_cells} screened, {result.roughness_excluded_cells} above limit, {result.roughness_unchecked_cells} unchecked. Measured from 80 m DEM heights within 400 m; missing values skip the filter.</p>}
      {result.slope_warning && <p role="status" className="text-[11px] text-[#ffbf70]">{result.slope_warning}</p>}
      {!result.regions.length && <p className="text-[#aeb6ba]">No sampled patch of this size passes the available filters. Reduce the patch size or review the limits.</p>}
      {result.regions.length > 0 && <label className="block text-[#b6bdc0]">Project name
        <input className={input} maxLength={100} value={name} placeholder="Name a saved candidate" onChange={event => setName(event.target.value)} /></label>}
      {result.regions.map((candidate, index) => <div key={`${candidate.center_latitude}-${candidate.center_longitude}`}
        className="border border-[#555] border-l-[3px] bg-[#303030] p-3" style={{ borderLeftColor: tone[candidate.band] }}>
        <div className="flex flex-wrap items-start justify-between gap-2"><span className="font-medium text-white">{String(index + 1).padStart(2, "0")} · ~{candidate.area_km2} km²</span>
          <span className="font-mono text-[#d5dbde]">{candidate.meeting_percent === null ? `${candidate.robust_score}% rank` : `${candidate.meeting_percent}% meets needs`}</span></div>
        <p className="mt-1 text-[#aeb6ba]">{candidate.center_latitude.toFixed(4)}°, {candidate.center_longitude.toFixed(4)}° · Sun {candidate.sun_percent}% · Earth {candidate.earth_percent}%</p>
        <p className="text-[#aeb6ba]">Dark gap avg {candidate.average_no_sun_hours}h, worst {candidate.longest_no_sun_hours}h · Earth gap avg {candidate.average_no_earth_hours}h, worst {candidate.longest_no_earth_hours}h</p>
        {result.slope_limit_deg != null && <p className="text-[#aeb6ba]">Slope: {candidate.slope_known_cells} checked · {candidate.slope_unchecked_cells} unchecked{candidate.representative_slope_deg != null ? ` · inspected point ${candidate.representative_slope_deg}° (${candidate.representative_slope_resolution_m} m)` : ""}</p>}
        <p className="text-[#aeb6ba]">Roughness P90 {candidate.roughness_p90_m == null ? "unknown" : `${candidate.roughness_p90_m} m`} ({candidate.roughness_known_cells}/{candidate.cells.length} cells) · mean DEM height {candidate.elevation_mean_m == null ? "unknown" : `${candidate.elevation_mean_m} m`}</p>
        <button type="button" disabled={saving} onClick={() => void save(candidate)}
          className="mt-2 min-h-9 border border-[#666] px-2.5 text-white hover:bg-[#444] disabled:opacity-50">Create project + candidate site</button>
      </div>)}
      {result.regions.length > 0 && !result.regions.some(candidate => candidate.band === "green") && <div className="space-y-2 pt-2">
        <p className="text-[#bbc3c7]">No green patch for this arrival. Compare three later dates in the same region.</p>
        <button type="button" disabled={running} onClick={() => void compareDates()}
          className="min-h-9 border border-[#666] px-3 text-white hover:bg-[#444] disabled:opacity-50">Compare +7, +14, +21 days</button>
      </div>}
      {suggestions.length > 0 && <div className="space-y-1 border-t border-[#484e52] pt-2"><p className="text-[#bcc4c7]">Sampled later dates · ranked by best patch</p>
        {suggestions.map(item => <button type="button" key={item.arrival}
          onClick={() => { setArrival(item.arrival.slice(0, 16)); setSuggestions([]); }}
          className="flex w-full justify-between gap-2 bg-[#303030] px-2.5 py-2 text-left hover:bg-[#444]">
          <span>{item.arrival.slice(0, 16).replace("T", " ")} UTC</span><span>{item.meeting === null ? `${item.score}% visibility rank` : `${item.meeting}% meets limits`}</span>
        </button>)}
        <p className="text-[10px] text-[#9ba4a9]">Selecting a date fills the form. Search again to inspect its full map.</p>
      </div>}
      <details className="text-[10px] text-[#9ba4a9]"><summary className="cursor-pointer">Model limits</summary>
        Patches rank by the fraction meeting entered limits, terrain data coverage, then the lower quartile of 50% Sun and 50% Earth visibility. Slope uses the 5 m slope map south of 87°S and an 80 m elevation-derived estimate elsewhere. Roughness is the RMS height residual after fitting a plane to 80 m DEM samples in a 400 m radius. Elevation is context only. Missing terrain measurements skip that filter and are counted. This screen cannot resolve small hazards or certify a landing zone. Date comparisons evaluate only the three dates shown.
      </details>
    </section>}
  </div>;
}
