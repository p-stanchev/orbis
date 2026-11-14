import { useEffect, useState } from "react";
import { Globe2, Sun } from "lucide-react";

type Window = { start_utc: string; end_utc: string; hours: number };
type BodyStats = {
  windows: Window[];
  visible_hours: number;
  visible_percent: number;
  longest_hidden_hours: number;
  window_count: number;
};
type Analysis = {
  model: string;
  terrain_horizon_applied: boolean;
  ground_station_applied: boolean;
  power_model_applied: boolean;
  sample_step_minutes: number;
  sun: BodyStats;
  earth: BodyStats;
  both: BodyStats;
  timeline: { start_utc: string; end_utc: string; hours: number; sun: boolean; earth: boolean }[];
  start_utc: string;
  end_utc: string;
};
type Job = { id: string; status: "running" | "completed" | "failed"; progress: number;
  result: Analysis | null; error: string | null };
export type SearchRegion = { center_latitude: number; center_longitude: number; area_km2: number;
  representative_latitude: number; representative_longitude: number;
  sun_percent: number; earth_percent: number; score: number; robust_score: number; band: "green" | "yellow" | "red";
  meeting_percent: number | null; average_no_sun_hours: number; average_no_earth_hours: number;
  average_daily_earth_hours: number;
  longest_no_sun_hours: number; longest_no_earth_hours: number; least_daily_earth_hours: number;
  sun_range: [number, number]; earth_range: [number, number];
  cells: { latitude: number; longitude: number; score: number }[] };
export type SearchGridCell = { latitude: number; longitude: number; score: number | null;
  band: "green" | "yellow" | "red";
  status: "recommended" | "evaluated" | "below_minimum" | "no_data" };
type Region = { regions: SearchRegion[]; grid: SearchGridCell[]; sample_count: number;
  grid_spacing_m: number; evaluated_cells: number; outside_coverage_cells: number;
  color_mode: "mission_needs" | "relative_visibility"; model: string };
type RegionJob = { id: string; status: "running" | "completed" | "failed"; progress: number; result: Region | null; error: string | null };
type Props = { latitude: number; longitude: number; arrivalUtc: string; durationHours: number;
  project: { id: string; center_latitude: number; center_longitude: number; radius_m: number };
  probePoint: { latitude: number; longitude: number } | null;
  onProbePoint: (point: { latitude: number; longitude: number } | null) => void;
  onProbeMode: (enabled: boolean) => void;
  onSaveMission: (changes: { arrival_utc?: string; duration_hours?: number }) => Promise<void>;
  onRegions?: (projectId: string, regions: SearchRegion[], grid: SearchGridCell[], spacing: number) => void };

function formatDate(utc: string) { return utc.slice(0, 16).replace("T", " ") + " UTC"; }

function Results({ label, stats, color }: { label: "Sun" | "Earth" | "Sun and Earth"; stats: BodyStats; color: string }) {
  return (
    <section className="orbis-panel min-w-0 space-y-2 p-3">
      <div className="flex items-center gap-2 font-medium" style={{ color }}>
        {label === "Sun" ? <Sun size={16} /> : <Globe2 size={16} />}
        {label} · terrain horizon visibility
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#353535] p-2"><div className="text-base text-white">{stats.visible_percent.toFixed(1)}%</div><div className="text-[10px] text-[#aaa]">Time visible</div></div>
        <div className="bg-[#353535] p-2"><div className="text-base text-white">{stats.visible_hours.toFixed(1)}h</div><div className="text-[10px] text-[#aaa]">Visible total</div></div>
        <div className="bg-[#353535] p-2"><div className="text-base text-white">{stats.window_count}</div><div className="text-[10px] text-[#aaa]">Windows</div></div>
      </div>
      <div className="text-[#aaa]">Longest continuous hidden period: <span className="font-medium text-[#eee]">{stats.longest_hidden_hours.toFixed(1)} hours</span></div>
      <details className="border-t border-[#444] pt-2">
        <summary className="cursor-pointer text-[#ddd]">{stats.window_count ? `View ${stats.window_count} window${stats.window_count === 1 ? "" : "s"}` : "No visibility windows"}</summary>
        <div className="orbis-scroll max-h-48 space-y-1 overflow-y-auto overscroll-contain">
          {stats.windows.map((window, index) => (
            <div key={`${window.start_utc}-${index}`} className="border-l-2 bg-[#343434] px-2 py-1.5" style={{ borderColor: color }}>
              <div className="text-[#fff]">{formatDate(window.start_utc)}</div>
              <div className="text-[#bbb]">to {formatDate(window.end_utc)} · {window.hours.toFixed(1)} h</div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

export default function VisibilityStatistics({ latitude, longitude, arrivalUtc, durationHours, project, probePoint,
  onProbePoint, onProbeMode, onSaveMission, onRegions }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [region, setRegion] = useState<RegionJob | null>(null);
  const [regionError, setRegionError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [controls, setControls] = useState({ sun_weight: 70, max_no_sun_hours: null as number | null,
    max_no_earth_hours: null as number | null, min_daily_earth_hours: 0,
    min_area_km2: Math.min(4, Math.max(0.001, Math.PI * (project.radius_m / 1000) ** 2 / 4)) });
  const [parameters, setParameters] = useState(controls);
  const [pointLat, setPointLat] = useState("");
  const [pointLon, setPointLon] = useState("");
  const [planningStart, setPlanningStart] = useState(arrivalUtc.slice(0, 16));
  const [planningHours, setPlanningHours] = useState(String(durationHours));
  const [planningError, setPlanningError] = useState("");
  const [planningBusy, setPlanningBusy] = useState(false);
  const analysisLatitude = probePoint?.latitude ?? latitude;
  const analysisLongitude = probePoint?.longitude ?? longitude;

  useEffect(() => { setPlanningStart(arrivalUtc.slice(0, 16)); setPlanningHours(String(durationHours)); }, [arrivalUtc, durationHours]);
  useEffect(() => {
    setPointLat(String(analysisLatitude));
    setPointLon(String(analysisLongitude));
  }, [analysisLatitude, analysisLongitude]);

  async function savePlanningWindow() {
    const date = new Date(`${planningStart}:00Z`);
    const hours = Number(planningHours);
    if (!Number.isFinite(date.getTime()) || !Number.isInteger(hours) || hours < 1 || hours > 8760) {
      setPlanningError("Enter a valid UTC start and 1–8760 whole hours.");
      return;
    }
    setPlanningBusy(true);
    setPlanningError("");
    try { await onSaveMission({ arrival_utc: date.toISOString(), duration_hours: hours }); }
    catch (reason) { setPlanningError(reason instanceof Error ? reason.message : "Could not save planning window."); }
    finally { setPlanningBusy(false); }
  }

  function analyzeCoordinates() {
    const lat = Number(pointLat);
    const lon = Number(pointLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > -80 || lon < -180 || lon > 180) {
      setPlanningError("Point must be within 80°S–90°S and longitude −180°–180°.");
      return;
    }
    setPlanningError("");
    onProbePoint({ latitude: lat, longitude: lon });
  }

  useEffect(() => {
    const controller = new AbortController();
    let timeout: number | undefined;
    setJob(null);
    setError("");

    async function check(id: string) {
      try {
        const response = await fetch(`/api/visibility/jobs/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not fetch calculation (${response.status})`);
        const data = await response.json() as Job;
        if (controller.signal.aborted) return;
        setJob(data);
        if (data.status === "running") timeout = window.setTimeout(() => void check(id), 1000);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Calculation unavailable");
      }
    }
    async function begin() {
      try {
        const response = await fetch("/api/visibility/jobs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: analysisLatitude, longitude: analysisLongitude,
            arrival_utc: arrivalUtc, duration_hours: durationHours,
            recalculate: retry > 0 }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(typeof data.detail === "string" ? data.detail : "Could not start visibility calculation");
        }
        const data = await response.json() as { id: string };
        if (!controller.signal.aborted) void check(data.id);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Calculation unavailable");
      }
    }
    void begin();
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [analysisLatitude, analysisLongitude, arrivalUtc, durationHours, retry]);

  useEffect(() => {
    const controller = new AbortController();
    let timeout: number | undefined;
    setRegion(null);
    setRegionError("");
    onRegions?.(project.id, [], [], 0);
    async function check(id: string) {
      try {
        const response = await fetch(`/api/visibility/jobs/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not fetch candidate scan (${response.status})`);
        const data = await response.json() as RegionJob;
        if (controller.signal.aborted) return;
        setRegion(data);
        if (data.status === "completed" && data.result) onRegions?.(project.id, data.result.regions,
          data.result.grid, data.result.grid_spacing_m);
        if (data.status === "running") timeout = window.setTimeout(() => void check(id), 1000);
      } catch (reason) {
        if (!controller.signal.aborted) setRegionError(reason instanceof Error ? reason.message : "Candidate scan unavailable");
      }
    }
    async function begin() {
      try {
        const response = await fetch("/api/visibility/regions/jobs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: project.center_latitude, longitude: project.center_longitude,
            radius_m: project.radius_m, arrival_utc: arrivalUtc, duration_hours: durationHours,
            ...parameters, recalculate: retry > 0 }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(typeof data.detail === "string" ? data.detail : "Could not start candidate scan");
        }
        const data = await response.json() as { id: string };
        if (!controller.signal.aborted) void check(data.id);
      } catch (reason) {
        if (!controller.signal.aborted) setRegionError(reason instanceof Error ? reason.message : "Candidate scan unavailable");
      }
    }
    void begin();
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [project.id, project.center_latitude, project.center_longitude, project.radius_m, arrivalUtc, durationHours,
    parameters.sun_weight, parameters.max_no_sun_hours, parameters.max_no_earth_hours,
    parameters.min_daily_earth_hours, parameters.min_area_km2, retry]);

  return (
    <div className="space-y-3 pb-3 text-xs leading-relaxed">
      <section className="orbis-panel space-y-3 p-3">
        <div className="font-medium text-white">Planning window · UTC</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[170px] flex-1 text-[#aaa]">Start
            <input type="datetime-local" value={planningStart} onChange={event => setPlanningStart(event.target.value)}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white [color-scheme:dark]" />
          </label>
          <label className="w-28 text-[#aaa]">Hours
            <input type="number" min={1} max={8760} step={1} value={planningHours}
              onChange={event => setPlanningHours(event.target.value)}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white [color-scheme:dark]" />
          </label>
          <button type="button" disabled={planningBusy} onClick={() => void savePlanningWindow()}
            className="min-h-10 bg-[#03ace4] px-3 py-2 text-white transition-colors hover:bg-[#079bc9] disabled:opacity-50">Apply time</button>
        </div>
        <div className="font-medium text-white">Point analysis</div>
        <p className="text-[#aaa]">A probe computes the chosen coordinate independently and does not move a landing site. Area averages can differ sharply from a nearby point.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-28 flex-1 text-[#aaa]">Latitude
            <input type="number" min={-90} max={-80} step="any" value={pointLat}
              onChange={event => setPointLat(event.target.value)} className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white" />
          </label>
          <label className="min-w-28 flex-1 text-[#aaa]">Longitude
            <input type="number" min={-180} max={180} step="any" value={pointLon}
              onChange={event => setPointLon(event.target.value)} className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white" />
          </label>
          <button type="button" onClick={analyzeCoordinates} className="min-h-10 border border-[#666] px-3 py-2 text-white transition-colors hover:bg-[#383838]">Analyze point</button>
          <button type="button" onClick={() => onProbeMode(true)} className="min-h-10 border border-[#666] px-3 py-2 text-white transition-colors hover:bg-[#383838]">Pick on map</button>
          {probePoint && <button type="button" onClick={() => onProbePoint(null)} className="px-3 py-2 text-[#aaa]">Use selected site</button>}
        </div>
        {planningError && <p role="alert" className="text-[#ef9292]">{planningError}</p>}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-white">Estimated visibility windows · {probePoint ? "inspected point" : "selected site / search center"}</div>
        <button type="button" disabled={job?.status === "running" || region?.status === "running"}
          onClick={() => { setParameters(controls); setRetry(value => value + 1); }}
          className="min-h-10 border border-[#666] bg-[#383838] px-3 py-1.5 text-white transition-colors hover:bg-[#484848] disabled:opacity-50">
          Recalculate
        </button>
        {job?.status === "running" && <div className="text-[#aaa]">Calculating… {Math.round(job.progress * 100)}%</div>}
      </div>
      {job?.status === "running" && <div role="progressbar" aria-label="Visibility calculation" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100} className="h-1 w-full bg-[#444]">
        <div className="h-full bg-[#03ace4]" style={{ width: `${job.progress * 100}%` }} />
      </div>}
      {(error || job?.status === "failed") && (
        <div role="alert" className="space-y-2 text-[#ef9292]">
          <p>{error || job?.error || "Calculation failed"}</p>
          <button type="button" className="bg-[#444] px-2 py-1 text-white" onClick={() => setRetry(value => value + 1)}>Try again</button>
        </div>
      )}
      {job?.result && <>
        <section className="orbis-panel grid grid-cols-1 gap-2 p-3 min-[430px]:grid-cols-2 [&>div]:min-w-0 [&>div]:break-words">
          <div><span className="text-[#aaa]">From</span><div className="text-white">{formatDate(job.result.start_utc)}</div></div>
          <div><span className="text-[#aaa]">Until</span><div className="text-white">{formatDate(job.result.end_utc)}</div></div>
          <div><span className="text-[#aaa]">Coordinate</span><div className="text-white">{analysisLatitude.toFixed(6)}°, {analysisLongitude.toFixed(6)}°</div></div>
          <div><span className="text-[#aaa]">Sun and Earth together</span><div className="text-white">{job.result.both.visible_hours.toFixed(1)}h · {job.result.both.visible_percent.toFixed(1)}%</div></div>
        </section>
        <Results label="Sun" stats={job.result.sun} color="#ff9900" />
        <Results label="Earth" stats={job.result.earth} color="#03ace4" />
        <Results label="Sun and Earth" stats={job.result.both} color="#60ba7b" />
        <section className="orbis-panel space-y-2 p-3">
          <div className="font-medium text-white">Mission timeline</div>
          <div className="orbis-scroll max-h-64 overflow-y-auto overscroll-contain">
            {job.result.timeline.map((entry, index) => (
              <div key={`${entry.start_utc}-${index}`} className="grid gap-1 border-b border-[#444] py-1.5 min-[560px]:grid-cols-[1fr_auto] min-[560px]:gap-2">
                <span>{formatDate(entry.start_utc)} → {formatDate(entry.end_utc)}</span>
                <span className="font-mono min-[560px]:text-right">{entry.sun ? "Sun" : "No Sun"} · {entry.earth ? "Earth" : "No Earth"} · {entry.hours.toFixed(1)}h</span>
              </div>
            ))}
          </div>
        </section>
        <details className="text-[#aaa]"><summary className="cursor-pointer">Calculation details</summary>
          Visibility uses the 80 m DEM horizon up to 100 km, limited by coverage. A window means any part of the disk clears sampled terrain. This does not model panel orientation, battery energy, antenna or ground stations. Samples are {job.result.sample_step_minutes} minutes apart; transitions are refined.
        </details>
      </>}
      <section className="space-y-2 border-t border-[#484848] pt-3">
        <div className="font-medium text-white">Search region <span className="text-[#888]">· {Math.round(project.radius_m / 1000 * 10) / 10} km</span></div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,150px),1fr))" }}>
          <label className="text-[#aaa]">Survive without Sun (h)
            <input type="number" min={0} max={8760} step={1} placeholder="No limit"
              value={controls.max_no_sun_hours ?? ""}
              onChange={event => setControls(current => ({ ...current,
                max_no_sun_hours: event.target.value === "" ? null : Math.max(0, Math.min(8760, Number(event.target.value))) }))}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white [color-scheme:dark]" />
          </label>
          <label className="text-[#aaa]">Max Earth outage (h)
            <input type="number" min={0} max={8760} step={1} placeholder="No limit"
              value={controls.max_no_earth_hours ?? ""}
              onChange={event => setControls(current => ({ ...current,
                max_no_earth_hours: event.target.value === "" ? null : Math.max(0, Math.min(8760, Number(event.target.value))) }))}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white [color-scheme:dark]" />
          </label>
          <label className="text-[#aaa]">Earth contact / day (h)
            <input type="number" min={0} max={24} step={0.5} value={controls.min_daily_earth_hours}
              onChange={event => setControls(current => ({ ...current,
                min_daily_earth_hours: Math.max(0, Math.min(24, Number(event.target.value) || 0)) }))}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white [color-scheme:dark]" />
          </label>
          <label className="text-[#aaa]">Sun ranking priority (%)
            <input type="number" min={0} max={100} step={5} value={controls.sun_weight}
              onChange={event => setControls(current => ({ ...current,
                sun_weight: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }))}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white [color-scheme:dark]" />
          </label>
          <label className="text-[#aaa]">Minimum area (km²)
            <input type="number" min={0.001} max={1000} step={0.1} value={controls.min_area_km2}
              onChange={event => setControls(current => ({ ...current,
                min_area_km2: Math.max(0.001, Math.min(1000, Number(event.target.value) || 0.001)) }))}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white [color-scheme:dark]" />
          </label>
        </div>
        <p className="text-[10px] text-[#aaa]">Set the hours your mission can tolerate, then press Recalculate. Blank outage limits are unconstrained.</p>
        {region?.status === "running" && <p className="text-[#aaa]">Scanning areas… {Math.round(region.progress * 100)}%</p>}
        {(regionError || region?.status === "failed") && <p role="alert" className="text-[#ef9292]">{regionError || region?.error}</p>}
        {region?.result && <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#bbb]">
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#60ba7b]" />{region.result.color_mode === "mission_needs" ? "Meets limits" : "≥70%"}</span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#ff9900]" />{region.result.color_mode === "mission_needs" ? "Close to limits" : "35–70%"}</span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#da0004]" />{region.result.color_mode === "mission_needs" ? "Outside limits" : "<35%"}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-[10px] text-[#aaa]"><span>{region.result.evaluated_cells} cells · {region.result.grid_spacing_m} m spacing</span><span>{region.result.regions.length} candidate patches</span>
            {region.result.outside_coverage_cells > 0 && <span>{region.result.outside_coverage_cells} outside DEM</span>}</div>
          {!region.result.regions.length && <p className="text-[#bbb]">No fully covered patch of this size was found. Try a smaller minimum area.</p>}
          <div className="space-y-1">{region.result.regions.map((area, index) => (
            <div key={`${area.center_latitude}-${area.center_longitude}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border-l-2 bg-[#30343a] px-3 py-2"
              style={{ borderColor: area.band === "green" ? "#60ba7b" : area.band === "yellow" ? "#ff9900" : "#da0004" }}>
              <span className="min-w-0 flex-1 font-medium text-white">{String(index + 1).padStart(2, "0")} · {area.area_km2} km² <span className="font-normal text-[#aaa]">near {area.center_latitude.toFixed(4)}°, {area.center_longitude.toFixed(4)}°</span>
                <button type="button" className="ml-2 font-normal text-[#66c9eb] hover:underline" onClick={() => onProbePoint({
                  latitude: area.representative_latitude, longitude: area.representative_longitude,
                })}>Inspect point ↗</button>
              </span>
              <span className="shrink-0 text-right font-mono text-[#ddd]">
                {area.meeting_percent !== null && <span className="block font-medium">{area.meeting_percent}% of sampled area meets limits</span>}
                <span className="block">Sun avg {area.sun_percent}% · Earth avg {area.earth_percent}%</span>
                <span className="block text-[10px] text-[#aaa]">Dark avg {area.average_no_sun_hours}h · worst {area.longest_no_sun_hours}h</span>
                <span className="block text-[10px] text-[#aaa]">Earth gap avg {area.average_no_earth_hours}h · worst {area.longest_no_earth_hours}h</span>
                <span className="block text-[10px] text-[#aaa]">Least daily Earth contact avg {area.average_daily_earth_hours}h</span>
              </span>
            </div>
          ))}</div>
          <details className="text-[10px] text-[#aaa]"><summary className="cursor-pointer">How patches are ranked</summary>
            Area coverage is the fraction of sampled cells that meet every entered limit. Green patches have at least 75% coverage, yellow at least 25%, red less. Individual map cells use the limits directly; yellow is within 20% of an entered limit (or one sample interval for an outage). Without limits, colors use weighted visibility. Patches rank by coverage, then lower-quartile weighted Sun/Earth visibility with {parameters.sun_weight}% Sun priority. These are sampled estimates, not a guarantee for every point. Visibility does not model generated power or a radio link. The 80 m DEM and {region.result.grid_spacing_m} m grid can miss small features.
          </details>
        </>}
      </section>
      {!job && !error && <p className="text-[#aaa]">Starting visibility analysis…</p>}
    </div>
  );
}
