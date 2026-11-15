import { useEffect, useState } from "react";
import { Globe2, Sun } from "lucide-react";
import SiteComparison from "./SiteComparison";

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
  sun_full?: BodyStats;
  earth_full?: BodyStats;
  geometric_sun?: BodyStats;
  geometric_earth?: BodyStats;
  geometric_both?: BodyStats;
  near_5m_used?: boolean;
  terrain_coverage_min_km?: number;
  solar_elevation_min_deg?: number;
  solar_elevation_max_deg?: number;
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
  slope_known_cells?: number | null; slope_unchecked_cells?: number | null;
  representative_slope_deg?: number | null; representative_slope_resolution_m?: number | null;
  cells: { latitude: number; longitude: number; score: number }[] };
export type SearchGridCell = { latitude: number; longitude: number; score: number | null;
  band: "green" | "yellow" | "red";
  status: "recommended" | "evaluated" | "below_minimum" | "no_data" | "slope_unchecked" };
type Region = { regions: SearchRegion[]; grid: SearchGridCell[]; sample_count: number;
  grid_spacing_m: number; evaluated_cells: number; outside_coverage_cells: number;
  slope_limit_deg?: number | null; slope_screened_cells?: number | null;
  slope_5m_cells?: number | null; slope_80m_cells?: number | null;
  slope_unchecked_cells?: number | null; slope_excluded_cells?: number | null; slope_warning?: string | null;
  color_mode: "mission_needs" | "relative_visibility"; model: string };
type RegionJob = { id: string; status: "running" | "completed" | "failed"; progress: number; result: Region | null; error: string | null };
type Props = { latitude: number; longitude: number; arrivalUtc: string; durationHours: number;
  project: { id: string; center_latitude: number; center_longitude: number; radius_m: number;
    sites: { id: string; name: string; latitude: number; longitude: number }[] };
  probePoint: { latitude: number; longitude: number } | null;
  onProbePoint: (point: { latitude: number; longitude: number } | null) => void;
  onProbeMode: (enabled: boolean) => void;
  onSelectSite: (siteId: string) => void;
  onSaveCandidate: (name: string, point: { latitude: number; longitude: number }) => Promise<void>;
  onSaveMission: (changes: { arrival_utc?: string; duration_hours?: number }) => Promise<void>;
  onRegions?: (projectId: string, regions: SearchRegion[], grid: SearchGridCell[], spacing: number) => void };

function formatDate(utc: string) { return utc.slice(0, 16).replace("T", " ") + " UTC"; }

function firstEvent(windows: Window[], start: string, event: "start_utc" | "end_utc") {
  return windows.map(window => window[event]).find(time => time > start) ?? null;
}

function eventLabel(windows: Window[], start: string, event: "start_utc" | "end_utc") {
  const time = firstEvent(windows, start, event);
  return time ? `~${formatDate(time)}` : "None in mission";
}

function nextChangeHours(windows: Window[], start: string) {
  const times = windows.flatMap(window => [window.start_utc, window.end_utc])
    .filter(time => time > start).sort();
  return times.length ? `~${((Date.parse(times[0]) - Date.parse(start)) / 3600_000).toFixed(1)} h` : "No change in mission";
}

function Results({ label, stats, color }: { label: "Sun" | "Earth" | "Sun and Earth"; stats: BodyStats; color: string }) {
  return (
    <section className="orbis-panel min-w-0 p-2">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color }}>
        {label === "Sun" ? <Sun size={17} className="shrink-0" /> : <Globe2 size={17} className="shrink-0" />}
        <span className="truncate">{label === "Sun and Earth" ? "Sun + Earth" : label}</span>
      </div>
      <div className="mt-0.5 pl-[25px] text-[10px] text-[#aaa]">Terrain horizon</div>
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-1 bg-[#353535] px-1.5 py-1.5"><span className="text-[10px] text-[#aaa]">Visible</span><span className="whitespace-nowrap font-mono text-xs tabular-nums text-white">{stats.visible_percent.toFixed(1)}%</span></div>
        <div className="flex items-center justify-between gap-1 bg-[#353535] px-1.5 py-1.5"><span className="text-[10px] text-[#aaa]">Hours</span><span className="whitespace-nowrap font-mono text-xs tabular-nums text-white">{stats.visible_hours.toFixed(1)}</span></div>
        <div className="flex items-center justify-between gap-1 bg-[#353535] px-1.5 py-1.5"><span className="text-[10px] text-[#aaa]">Windows</span><span className="whitespace-nowrap font-mono text-xs tabular-nums text-white">{stats.window_count}</span></div>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-1 border-b border-[#444] pb-2 text-[#aaa]">
        <span>Longest hidden</span><span className="whitespace-nowrap font-mono text-white">{stats.longest_hidden_hours.toFixed(1)} h</span>
      </div>
      <details className="pt-2">
        <summary className="cursor-pointer text-[#ddd]">Visibility windows ({stats.window_count})</summary>
        <div className="orbis-scroll mt-2 max-h-48 space-y-1 overflow-y-auto overscroll-contain">
          {stats.windows.map((window, index) => (
            <div key={`${window.start_utc}-${index}`} className="border-l-2 bg-[#343434] px-2 py-1.5" style={{ borderColor: color }}>
              <div className="font-mono text-[11px] text-[#fff]">{formatDate(window.start_utc)}</div>
              <div className="font-mono text-[11px] text-[#bbb]">to {formatDate(window.end_utc)}</div>
              <div className="text-[10px] text-[#aaa]">{window.hours.toFixed(1)} h</div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

export default function VisibilityStatistics({ latitude, longitude, arrivalUtc, durationHours, project, probePoint,
  onProbePoint, onProbeMode, onSelectSite, onSaveCandidate, onSaveMission, onRegions }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [region, setRegion] = useState<RegionJob | null>(null);
  const [regionError, setRegionError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [controls, setControls] = useState({ sun_weight: 70, max_no_sun_hours: null as number | null,
    max_no_earth_hours: null as number | null, min_daily_earth_hours: 0,
    max_slope_deg: null as number | null,
    min_area_km2: Math.min(4, Math.max(0.001, Math.PI * (project.radius_m / 1000) ** 2 / 4)) });
  const [parameters, setParameters] = useState(controls);
  const [pointLat, setPointLat] = useState("");
  const [pointLon, setPointLon] = useState("");
  const [candidateName, setCandidateName] = useState(`Candidate Site ${project.sites.length + 1}`);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [slopeLimit, setSlopeLimit] = useState("15");
  const [slope, setSlope] = useState<{ slope_p90_deg: number | null; footprint_radius_m: number | null;
    resolution_m: number | null; dataset: string | null } | null>(null);
  const [slopeError, setSlopeError] = useState("");
  const [planningStart, setPlanningStart] = useState(arrivalUtc.slice(0, 16));
  const [planningHours, setPlanningHours] = useState(String(durationHours));
  const [planningError, setPlanningError] = useState("");
  const [planningBusy, setPlanningBusy] = useState(false);
  const analysisLatitude = probePoint?.latitude ?? latitude;
  const analysisLongitude = probePoint?.longitude ?? longitude;
  const slopeThreshold = Number(slopeLimit);
  const slopeExceedsLimit = slope?.slope_p90_deg != null && slopeLimit.trim() !== "" &&
    Number.isFinite(slopeThreshold) && slopeThreshold >= 0 && slopeThreshold <= 90 &&
    slope.slope_p90_deg > slopeThreshold;

  useEffect(() => { setPlanningStart(arrivalUtc.slice(0, 16)); setPlanningHours(String(durationHours)); }, [arrivalUtc, durationHours]);
  useEffect(() => {
    setPointLat(String(analysisLatitude));
    setPointLon(String(analysisLongitude));
  }, [analysisLatitude, analysisLongitude]);

  useEffect(() => {
    const controller = new AbortController();
    setSlope(null);
    setSlopeError("");
    void fetch(`/api/terrain/slope?latitude=${analysisLatitude}&longitude=${analysisLongitude}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Slope estimate unavailable (${response.status})`);
        return response.json() as Promise<{ slope_p90_deg: number | null; footprint_radius_m: number | null;
          resolution_m: number | null; dataset: string | null }>;
      })
      .then(value => { if (!controller.signal.aborted) setSlope(value); })
      .catch(reason => { if (!controller.signal.aborted) setSlopeError(reason instanceof Error ? reason.message : "Slope estimate unavailable"); });
    return () => controller.abort();
  }, [analysisLatitude, analysisLongitude]);

  async function saveCandidate() {
    if (!probePoint) return;
    if (!candidateName.trim()) { setCandidateError("Enter a candidate site name."); return; }
    setCandidateBusy(true);
    setCandidateError("");
    try {
      await onSaveCandidate(candidateName.trim(), probePoint);
      setCandidateName(`Candidate Site ${project.sites.length + 2}`);
    }
    catch (reason) { setCandidateError(reason instanceof Error ? reason.message : "Could not save candidate site."); }
    finally { setCandidateBusy(false); }
  }

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
    parameters.min_daily_earth_hours, parameters.min_area_km2, parameters.max_slope_deg, retry]);

  return (
    <div className="orbis-statistics mx-auto max-w-[1200px] space-y-3 pb-3 text-xs leading-relaxed">
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
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 text-[#aaa]">
            Local slope
            <div className={`mt-1 text-sm ${slopeExceedsLimit ? "text-[#ff9900]" : "text-white"}`}>
              {slopeError || (slope === null ? "Checking…" : slope.slope_p90_deg === null ? "Unavailable at this point" : `${slope.slope_p90_deg.toFixed(1)}° estimated`)}
            </div>
            {slope?.slope_p90_deg != null && <div className="text-[11px] text-[#aaa]">
              {slope.dataset} · 90th percentile within {slope.footprint_radius_m} m
            </div>}
            {slope?.resolution_m === 80 && <div className="text-[11px] text-[#aaa]">Coarse terrain estimate; small hazards are unresolved.</div>}
          </div>
          <label className="w-32 text-[#aaa]">Planning limit (°)
            <input type="number" min={0} max={90} step="any" value={slopeLimit} onChange={event => setSlopeLimit(event.target.value)}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white" />
          </label>
        </div>
        {slopeExceedsLimit &&
          <p className="border-l-2 border-[#ff9900] bg-[#34302a] px-3 py-2 text-[#ddd]">Steeper than this planning limit. Review the terrain before treating this point as a landing candidate.</p>}
        {probePoint && <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-48 flex-1 text-[#aaa]">Candidate site name
            <input type="text" maxLength={100} value={candidateName} onChange={event => setCandidateName(event.target.value)}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white" />
          </label>
          <button type="button" disabled={candidateBusy} onClick={() => void saveCandidate()}
            className="min-h-10 bg-[#03ace4] px-3 py-2 text-white transition-colors hover:bg-[#079bc9] disabled:opacity-50">
            {candidateBusy ? "Saving…" : "Save as candidate site"}
          </button>
        </div>}
        {candidateError && <p role="alert" className="text-[#ef9292]">{candidateError}</p>}
        {planningError && <p role="alert" className="text-[#ef9292]">{planningError}</p>}
      </section>
      <SiteComparison key={`${project.id}-${arrivalUtc}-${durationHours}-${project.sites.map(site => `${site.id}:${site.latitude}:${site.longitude}`).join("|")}`}
        sites={project.sites} arrivalUtc={arrivalUtc} durationHours={durationHours} onSelectSite={onSelectSite} />
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
        <div className="orbis-result-grid">
          <Results label="Sun" stats={job.result.sun} color="#ff9900" />
          <Results label="Earth" stats={job.result.earth} color="#03ace4" />
          <Results label="Sun and Earth" stats={job.result.both} color="#60ba7b" />
        </div>
        {job.result.terrain_coverage_min_km !== undefined && job.result.terrain_coverage_min_km < 99 &&
          <p className="border-l-2 border-[#ff9900] bg-[#34302a] px-3 py-2 text-[#ddd]">Far terrain coverage is incomplete in at least one direction ({job.result.terrain_coverage_min_km} km). Visibility estimates may miss a distant obstruction.</p>}
        {job.result.geometric_sun && job.result.geometric_earth && job.result.sun_full && job.result.earth_full && <section className="orbis-panel space-y-2 p-3">
          <div className="font-medium text-white">Visibility basis</div>
          <div className="grid gap-2 text-[#aaa]" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,180px),1fr))" }}>
            <div>Sun, ideal horizon <span className="font-mono text-white">{job.result.geometric_sun.visible_percent.toFixed(1)}%</span></div>
            <div>Sun, full disk above terrain <span className="font-mono text-white">{job.result.sun_full.visible_percent.toFixed(1)}%</span></div>
            <div>Earth, ideal horizon <span className="font-mono text-white">{job.result.geometric_earth.visible_percent.toFixed(1)}%</span></div>
            <div>Earth, full disk above terrain <span className="font-mono text-white">{job.result.earth_full.visible_percent.toFixed(1)}%</span></div>
          </div>
          <p className="text-[10px] text-[#aaa]">The cards count intervals when any part of the disk clears sampled terrain. An ideal horizon ignores terrain. Partial Sun visibility does not establish usable power; Earth line of sight does not establish a communications link.</p>
        </section>}
        <section className="orbis-panel space-y-2 p-3">
          <div className="font-medium text-white">Transitions from arrival</div>
          <div className="grid gap-1 text-[#aaa]" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,180px),1fr))" }}>
            <div>Next sunrise <span className="block font-mono text-white">{eventLabel(job.result.sun.windows, job.result.start_utc, "start_utc")}</span></div>
            <div>Next sunset <span className="block font-mono text-white">{eventLabel(job.result.sun.windows, job.result.start_utc, "end_utc")}</span></div>
            <div>Next Earthrise <span className="block font-mono text-white">{eventLabel(job.result.earth.windows, job.result.start_utc, "start_utc")}</span></div>
            <div>Next Earthset <span className="block font-mono text-white">{eventLabel(job.result.earth.windows, job.result.start_utc, "end_utc")}</span></div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#aaa]">
            <span>Sun changes in <span className="font-mono text-white">{nextChangeHours(job.result.sun.windows, job.result.start_utc)}</span></span>
            <span>Earth changes in <span className="font-mono text-white">{nextChangeHours(job.result.earth.windows, job.result.start_utc)}</span></span>
          </div>
          {job.result.solar_elevation_min_deg !== undefined && job.result.solar_elevation_max_deg !== undefined && <div className="text-[#aaa]">Sampled solar elevation <span className="font-mono text-white">{job.result.solar_elevation_min_deg.toFixed(2)}° to {job.result.solar_elevation_max_deg.toFixed(2)}°</span></div>}
        </section>
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
          {job.result.model}. {job.result.terrain_coverage_min_km !== undefined && <>The 80 m DEM reaches at least {job.result.terrain_coverage_min_km} km in every sampled direction. The 5 m near field mosaic {job.result.near_5m_used ? "was used where covered" : "was unavailable at this point"}; its published grid includes interpolated pixels. </>}Azimuths are sampled every 2°, and terrain between rays or beyond coverage may be missed. Samples are {job.result.sample_step_minutes} minutes apart; transitions are refined within detected brackets. Panel orientation, battery energy, antenna and ground stations are not modeled.
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
          <label className="text-[#aaa]">Maximum local slope (°)
            <input type="number" min={0} max={90} step={0.5} placeholder="No slope filter"
              value={controls.max_slope_deg ?? ""}
              onChange={event => setControls(current => ({ ...current,
                max_slope_deg: event.target.value === "" ? null : Math.max(0, Math.min(90, Number(event.target.value))) }))}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white [color-scheme:dark]" />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-[#aaa]">Blank slope leaves it out. If slope is unavailable at a cell, that cell skips the filter and is marked unchecked.</p>
          <button type="button" disabled={region?.status === "running"}
            onClick={() => { setParameters(controls); setRetry(value => value + 1); }}
            className="min-h-9 bg-[#03ace4] px-3 py-1.5 text-white hover:bg-[#079bc9] disabled:opacity-50">Search region</button>
        </div>
        {region?.status === "running" && <p className="text-[#aaa]">Scanning areas… {Math.round(region.progress * 100)}%</p>}
        {(regionError || region?.status === "failed") && <p role="alert" className="text-[#ef9292]">{regionError || region?.error}</p>}
        {region?.result && <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#bbb]">
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#60ba7b]" />{region.result.color_mode === "mission_needs" ? "Meets limits" : "≥70%"}</span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#ff9900]" />{region.result.color_mode === "mission_needs" ? "Close to limits" : "35–70%"}</span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#da0004]" />{region.result.color_mode === "mission_needs" ? "Outside limits" : "<35%"}</span>
            {region.result.slope_limit_deg != null && (region.result.slope_unchecked_cells ?? 0) > 0 &&
              <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#879199]" />Slope unchecked</span>}
          </div>
          <div className="flex flex-wrap gap-3 text-[10px] text-[#aaa]"><span>{region.result.evaluated_cells} cells · {region.result.grid_spacing_m} m spacing</span><span>{region.result.regions.length} candidate patches</span>
            {region.result.outside_coverage_cells > 0 && <span>{region.result.outside_coverage_cells} outside DEM</span>}</div>
          {region.result.slope_limit_deg != null && <p className="text-[10px] text-[#bbb]">Slope ≤{region.result.slope_limit_deg}°: {region.result.slope_screened_cells} screened ({region.result.slope_5m_cells} at 5 m, {region.result.slope_80m_cells} at 80 m), {region.result.slope_excluded_cells} too steep, {region.result.slope_unchecked_cells} unchecked. Unchecked cells skip this filter and appear gray on the map. {region.result.slope_warning}</p>}
          {!region.result.regions.length && <p className="text-[#bbb]">No patch of this size passes the available filters. Try a smaller minimum area or review the slope limit.</p>}
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
                {parameters.max_slope_deg != null && <span className="block text-[10px] text-[#aaa]">Slope: {area.slope_known_cells} checked · {area.slope_unchecked_cells} unchecked{area.representative_slope_deg != null ? ` · inspected point ${area.representative_slope_deg}° (${area.representative_slope_resolution_m} m)` : ""}</span>}
              </span>
            </div>
          ))}</div>
          <details className="text-[10px] text-[#aaa]"><summary className="cursor-pointer">How patches are ranked</summary>
            Area coverage is the fraction of sampled cells that meet every entered limit with data available. Green patches have at least 75% coverage, yellow at least 25%, red less. Individual map cells use the limits directly; yellow is within 20% of an entered outage or contact limit. Without limits, colors use weighted visibility. When a slope limit is set, sampled cells above it are excluded from patches and cells without slope data skip that limit. Patches rank by coverage, slope data coverage, then lower-quartile weighted Sun/Earth visibility with {parameters.sun_weight}% Sun priority. These are sampled estimates, not a guarantee for every point. Visibility does not model generated power or a radio link. The 80 m DEM and {region.result.grid_spacing_m} m grid can miss small features.
          </details>
        </>}
      </section>
      {!job && !error && <p className="text-[#aaa]">Starting visibility analysis…</p>}
    </div>
  );
}
