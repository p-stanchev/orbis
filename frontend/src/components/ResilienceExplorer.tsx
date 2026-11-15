import { useEffect, useRef, useState } from "react";
import NumericInput from "./NumericInput";

type Site = { id: string; name: string; latitude: number; longitude: number };
export type ResilienceProject = { id: string; name: string; arrival_utc: string; duration_hours: number;
  center_latitude: number; center_longitude: number; radius_m: number; sites: Site[] };
type Body = { visible_percent: number; visible_hours: number; longest_hidden_hours: number };
type Analysis = { sun: Body; earth: Body; both: Body; start_utc: string; end_utc: string;
  terrain_coverage_min_km?: number; near_5m_used?: boolean };
type Job = { status: "running" | "completed" | "failed"; progress: number;
  result: Analysis | null; error: string | null };
type Scenario = { name: string; latitude: number; longitude: number; start: string; hours: number; data: Analysis };

const input = "mt-1 block h-9 w-full min-w-0 border border-[#555] bg-[#292929] px-2 text-xs text-white [color-scheme:dark]";
const label = "block min-w-0 text-xs text-[#aaa]";

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const latA = a.latitude * Math.PI / 180;
  const latB = b.latitude * Math.PI / 180;
  const dLat = latB - latA;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 2 * 1737400 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function dateValue(value: string) {
  return new Date(`${value}:00Z`);
}

function signed(value: number, unit: string) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${unit}`;
}

async function calculate(point: { latitude: number; longitude: number }, start: string, hours: number,
  signal: AbortSignal, onProgress: (value: number) => void): Promise<Analysis> {
  const response = await fetch("/api/visibility/jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: point.latitude, longitude: point.longitude,
      arrival_utc: start, duration_hours: hours }), signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Calculation could not start (${response.status})`);
  }
  const { id } = await response.json() as { id: string };
  for (;;) {
    const current = await fetch(`/api/visibility/jobs/${encodeURIComponent(id)}`, { signal });
    if (!current.ok) throw new Error(`Calculation status unavailable (${current.status})`);
    const job = await current.json() as Job;
    if (job.status === "failed") throw new Error(job.error || "Calculation failed");
    if (job.status === "completed") {
      if (!job.result) throw new Error("Calculation returned no result");
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

export default function ResilienceExplorer({ projects, initialProjectId }: {
  projects: ResilienceProject[]; initialProjectId?: string }) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const project = projects.find(item => item.id === projectId);
  const [baselineSiteId, setBaselineSiteId] = useState(project?.sites[0]?.id ?? "center");
  const [scenarioSiteId, setScenarioSiteId] = useState(project?.sites[1]?.id ?? project?.sites[0]?.id ?? "center");
  const [baselineStart, setBaselineStart] = useState(project?.arrival_utc.slice(0, 16) ?? "");
  const [scenarioStart, setScenarioStart] = useState(project ? new Date(Date.parse(project.arrival_utc) + 7 * 86400000).toISOString().slice(0, 16) : "");
  const [baselineHours, setBaselineHours] = useState(String(project?.duration_hours ?? 336));
  const [scenarioHours, setScenarioHours] = useState(String(project?.duration_hours ?? 336));
  const [customLat, setCustomLat] = useState(String(project?.center_latitude ?? -85));
  const [customLon, setCustomLon] = useState(String(project?.center_longitude ?? 0));
  const [result, setResult] = useState<{ baseline: Scenario; scenario: Scenario } | null>(null);
  const [progress, setProgress] = useState({ baseline: 0, scenario: 0 });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [alternatives, setAlternatives] = useState<{ site: Site; data: Analysis }[]>([]);
  const [alternativeBusy, setAlternativeBusy] = useState(false);
  const [alternativeDone, setAlternativeDone] = useState(0);
  const [alternativeError, setAlternativeError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!projects.some(item => item.id === projectId)) chooseProject(projects[0]?.id ?? "");
  }, [projects, projectId]);
  useEffect(() => {
    controller.current?.abort();
    setRunning(false);
    setResult(null);
    setError("");
    setAlternatives([]);
    setAlternativeBusy(false);
    setAlternativeError("");
  }, [projectId, baselineSiteId, scenarioSiteId, baselineStart, scenarioStart,
    baselineHours, scenarioHours, customLat, customLon]);

  function chooseProject(id: string) {
    const selected = projects.find(item => item.id === id);
    setProjectId(id);
    setBaselineSiteId(selected?.sites[0]?.id ?? "center");
    setScenarioSiteId(selected?.sites[1]?.id ?? selected?.sites[0]?.id ?? "center");
    setBaselineStart(selected?.arrival_utc.slice(0, 16) ?? "");
    setScenarioStart(selected ? new Date(Date.parse(selected.arrival_utc) + 7 * 86400000).toISOString().slice(0, 16) : "");
    setBaselineHours(String(selected?.duration_hours ?? 336));
    setScenarioHours(String(selected?.duration_hours ?? 336));
    setCustomLat(String(selected?.center_latitude ?? -85));
    setCustomLon(String(selected?.center_longitude ?? 0));
  }

  function location(id: string) {
    if (!project) return null;
    if (id === "center") return { name: "Project center", latitude: project.center_latitude, longitude: project.center_longitude };
    if (id === "custom") return { name: "Nearby point", latitude: Number(customLat), longitude: Number(customLon) };
    return project.sites.find(site => site.id === id) ?? null;
  }

  async function compare() {
    if (!project) return;
    const baseline = location(baselineSiteId);
    const scenario = location(scenarioSiteId);
    const first = dateValue(baselineStart);
    const second = dateValue(scenarioStart);
    const firstHours = Number(baselineHours);
    const secondHours = Number(scenarioHours);
    if (!baseline || !scenario || !Number.isFinite(first.getTime()) || !Number.isFinite(second.getTime()) ||
      !Number.isFinite(firstHours) || !Number.isFinite(secondHours) || firstHours < 1 || secondHours < 1 ||
      firstHours > 8760 || secondHours > 8760 ||
      !Number.isFinite(scenario.latitude) || !Number.isFinite(scenario.longitude) ||
      scenario.latitude < -90 || scenario.latitude > -80 || scenario.longitude < -180 || scenario.longitude > 180 ||
      distanceMeters({ latitude: project.center_latitude, longitude: project.center_longitude }, scenario) > project.radius_m + 0.5) {
      setError("Enter valid UTC dates and durations, and keep the scenario point inside this project's search radius.");
      return;
    }
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setError("");
    setResult(null);
    setAlternatives([]);
    setAlternativeError("");
    setProgress({ baseline: 0, scenario: 0 });
    setRunning(true);
    try {
      const [baselineData, scenarioData] = await Promise.all([
        calculate(baseline, first.toISOString(), firstHours, active.signal,
          value => setProgress(current => ({ ...current, baseline: value }))),
        calculate(scenario, second.toISOString(), secondHours, active.signal,
          value => setProgress(current => ({ ...current, scenario: value }))),
      ]);
      if (!active.signal.aborted) setResult({
        baseline: { ...baseline, start: first.toISOString(), hours: firstHours, data: baselineData },
        scenario: { ...scenario, start: second.toISOString(), hours: secondHours, data: scenarioData },
      });
    } catch (reason) {
      if (!active.signal.aborted) {
        active.abort();
        setError(reason instanceof Error ? reason.message : "Comparison unavailable");
      }
    } finally {
      if (controller.current === active) setRunning(false);
    }
  }

  async function rankSavedSites() {
    if (!project || !result) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setAlternativeBusy(true);
    setAlternativeDone(0);
    setAlternativeError("");
    setAlternatives([]);
    const ranked: { site: Site; data: Analysis }[] = [];
    let failures = 0;
    for (const site of project.sites) {
      if (active.signal.aborted) return;
      try {
        const data = site.latitude === result.scenario.latitude && site.longitude === result.scenario.longitude
          ? result.scenario.data
          : await calculate(site, result.scenario.start, result.scenario.hours, active.signal, () => {});
        ranked.push({ site, data });
      } catch {
        if (active.signal.aborted) return;
        failures += 1;
      }
      setAlternativeDone(value => value + 1);
    }
    if (!active.signal.aborted) {
      ranked.sort((a, b) => a.data.earth.longest_hidden_hours - b.data.earth.longest_hidden_hours ||
        a.data.sun.longest_hidden_hours - b.data.sun.longest_hidden_hours);
      setAlternatives(ranked);
      if (failures) setAlternativeError(`${failures} site${failures === 1 ? "" : "s"} could not be evaluated.`);
      setAlternativeBusy(false);
    }
  }

  const rows = result ? [
    { label: "Sun visible", base: result.baseline.data.sun.visible_percent, next: result.scenario.data.sun.visible_percent, unit: "%", deltaUnit: " pp", favorable: 1 },
    { label: "Sun visible hours", base: result.baseline.data.sun.visible_hours, next: result.scenario.data.sun.visible_hours, unit: " h", favorable: 1 },
    { label: "Longest darkness", base: result.baseline.data.sun.longest_hidden_hours, next: result.scenario.data.sun.longest_hidden_hours, unit: " h", favorable: -1 },
    { label: "Potential Earth visibility", base: result.baseline.data.earth.visible_percent, next: result.scenario.data.earth.visible_percent, unit: "%", deltaUnit: " pp", favorable: 1 },
    { label: "Earth visible hours", base: result.baseline.data.earth.visible_hours, next: result.scenario.data.earth.visible_hours, unit: " h", favorable: 1 },
    { label: "Longest Earth obstruction", base: result.baseline.data.earth.longest_hidden_hours, next: result.scenario.data.earth.longest_hidden_hours, unit: " h", favorable: -1 },
    { label: "Sun + Earth together", base: result.baseline.data.both.visible_percent, next: result.scenario.data.both.visible_percent, unit: "%", deltaUnit: " pp", favorable: 1 },
  ] : [];
  const sameWindow = result?.baseline.start === result?.scenario.start && result?.baseline.hours === result?.scenario.hours;
  const sunDelta = result ? result.scenario.data.sun.visible_percent - result.baseline.data.sun.visible_percent : 0;
  const earthDelta = result ? result.scenario.data.earth.visible_percent - result.baseline.data.earth.visible_percent : 0;

  return <div className="orbis-explore mx-auto max-w-[1200px] space-y-3 pb-3 text-xs leading-relaxed">
    {!projects.length ? <section className="orbis-panel p-3 text-[#aaa]">Create a project in Candidate search to compare mission scenarios.</section> : <>
      <section className="orbis-panel space-y-3 p-3">
        <div className="font-medium text-white">Baseline mission</div>
        <p className="text-[#aaa]">Start with a saved project. This comparison does not change its schedule or sites.</p>
        <div className="grid gap-3 min-[540px]:grid-cols-2">
          <label className={label}>Project<select className={input} value={projectId} onChange={event => chooseProject(event.target.value)}>
            {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label className={label}>Baseline location<select className={input} value={baselineSiteId} onChange={event => setBaselineSiteId(event.target.value)}>
            <option value="center">Project center</option>
            {project?.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select></label>
          <label className={label}>Arrival · UTC<input className={input} type="datetime-local" value={baselineStart} onChange={event => setBaselineStart(event.target.value)} /></label>
          <label className={label}>Duration · hours<NumericInput className={input} min={1} max={8760} step={1} value={baselineHours} onValueChange={setBaselineHours} /></label>
        </div>
      </section>
      <section className="orbis-panel space-y-3 p-3">
        <div className="font-medium text-white">What if…</div>
        <div className="flex flex-wrap gap-1">
          {[0, 7, 14, 21].map(days => <button type="button" key={days}
            onClick={() => { const date = dateValue(baselineStart); if (Number.isFinite(date.getTime())) setScenarioStart(new Date(date.getTime() + days * 86400000).toISOString().slice(0, 16)); }}
            className="min-h-8 border border-[#555] px-2 text-[#ddd] hover:bg-[#383838]">{days ? `+${days} days` : "Same arrival"}</button>)}
        </div>
        <div className="grid gap-3 min-[540px]:grid-cols-2">
          <label className={label}>Scenario arrival · UTC<input className={input} type="datetime-local" value={scenarioStart} onChange={event => setScenarioStart(event.target.value)} /></label>
          <label className={label}>Scenario duration · hours<NumericInput className={input} min={1} max={8760} step={1} value={scenarioHours} onValueChange={setScenarioHours} /></label>
          <label className={label}>Scenario location<select className={input} value={scenarioSiteId} onChange={event => setScenarioSiteId(event.target.value)}>
            <option value="center">Project center</option>
            {project?.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            <option value="custom">Nearby point · coordinates</option>
          </select></label>
        </div>
        {scenarioSiteId === "custom" && <div className="grid gap-3 min-[540px]:grid-cols-2">
          <label className={label}>Latitude<NumericInput className={input} min={-90} max={-80} step="any" increment={0.0001} value={customLat} onValueChange={setCustomLat} /></label>
          <label className={label}>Longitude<NumericInput className={input} min={-180} max={180} step="any" increment={0.0001} value={customLon} onValueChange={setCustomLon} /></label>
          <p className="text-[#aaa] min-[540px]:col-span-2">Nearby point must be within the {Math.round((project?.radius_m ?? 0) / 100) / 10} km project radius.</p>
        </div>}
      </section>
      <button type="button" disabled={running || alternativeBusy || !project} onClick={() => void compare()}
        className="min-h-10 w-full bg-accent px-3 py-2 font-medium text-white transition-[filter] hover:brightness-90 disabled:opacity-50">
        {running ? `Comparing · baseline ${Math.round(progress.baseline * 100)}% · scenario ${Math.round(progress.scenario * 100)}%` : "Compare scenarios"}
      </button>
      {error && <p role="alert" className="text-[#ef9292]">{error}</p>}
      {result && <section className="orbis-panel space-y-3 p-3">
        <div className="font-medium text-white">Scenario difference</div>
        <div className="grid gap-2 min-[560px]:grid-cols-2">
          {[result.baseline, result.scenario].map((item, index) => <div key={index} className="min-w-0 bg-[#343434] p-2 text-[#bbb]">
            <div className="font-medium text-white">{index ? "What if" : "Baseline"} · {item.name}</div>
            <div>{item.start.slice(0, 16).replace("T", " ")} UTC · {item.hours} h</div>
            <div>{item.latitude.toFixed(5)}°, {item.longitude.toFixed(5)}°</div>
          </div>)}
        </div>
        <div className="orbis-scroll overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-[#ccc]">
            <thead><tr className="border-b border-[#555] text-[#aaa]"><th className="py-2 font-normal">Measure</th><th className="py-2 text-right font-normal">Baseline</th><th className="py-2 text-right font-normal">What if</th><th className="py-2 text-right font-normal">Change</th></tr></thead>
            <tbody>{rows.map(row => {
              const change = row.next - row.base;
              return <tr key={row.label} className="border-b border-[#414141]">
                <th className="py-2 pr-2 font-normal">{row.label}</th>
                <td className="py-2 text-right font-mono">{row.base.toFixed(1)}{row.unit}</td>
                <td className="py-2 text-right font-mono">{row.next.toFixed(1)}{row.unit}</td>
                <td className={`py-2 text-right font-mono ${Math.abs(change) < 0.05 ? "text-[#bbb]" : change * row.favorable > 0 ? "text-[#60ba7b]" : "text-[#ff9900]"}`}>{signed(change, "deltaUnit" in row ? row.deltaUnit ?? row.unit : row.unit)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="border-l-2 border-accent bg-[#33383a] px-3 py-2 text-[#ddd]">
          <div>Sun visibility {sunDelta > 0.05 ? "rises" : sunDelta < -0.05 ? "falls" : "is nearly unchanged"}{Math.abs(sunDelta) > 0.05 ? ` by ${Math.abs(sunDelta).toFixed(1)} percentage points` : ""}. Potential Earth visibility {earthDelta > 0.05 ? "rises" : earthDelta < -0.05 ? "falls" : "is nearly unchanged"}{Math.abs(earthDelta) > 0.05 ? ` by ${Math.abs(earthDelta).toFixed(1)} percentage points` : ""}.</div>
          {sameWindow && result.baseline.name !== result.scenario.name && sunDelta > 0 && earthDelta > 0 &&
            <div className="mt-1">For this same mission window, the alternative location has higher sampled Sun and Earth visibility. Inspect its terrain and outage lengths before choosing it.</div>}
          {sameWindow && result.baseline.name !== result.scenario.name && sunDelta * earthDelta < 0 &&
            <div className="mt-1">The alternative improves one visibility measure while reducing the other. The outage rows show the tradeoff for this mission window.</div>}
        </div>
        {result.baseline.hours !== result.scenario.hours && <p className="text-[#ffbf70]">Mission durations differ. Compare percentages for exposure across different lengths; total hours reflect each mission's duration.</p>}
        {(result.baseline.data.terrain_coverage_min_km !== undefined && result.baseline.data.terrain_coverage_min_km < 99 ||
          result.scenario.data.terrain_coverage_min_km !== undefined && result.scenario.data.terrain_coverage_min_km < 99) &&
          <p className="text-[#ffbf70]">At least one location has incomplete distant terrain coverage; a terrain obstruction may be missed.</p>}
        <p className="text-[10px] text-[#aaa]">Each scenario uses its own sampled terrain horizon and mission interval. Sun visibility counts any part of the disk above terrain and does not establish usable solar power. Earth visibility is potential line of sight, not a confirmed communications link. Differences are estimates, not a mission recommendation.</p>
        {(project?.sites.length ?? 0) > 1 && <div className="space-y-2 border-t border-[#494949] pt-3">
          <div className="font-medium text-white">Saved site alternatives</div>
          <p className="text-[#aaa]">Find the shortest sampled Earth obstruction for the scenario date and duration; darkness breaks ties. This ranking uses saved sites only.</p>
          <button type="button" disabled={alternativeBusy} onClick={() => void rankSavedSites()}
            className="min-h-9 border border-[#666] px-3 text-white hover:bg-[#383838] disabled:opacity-50">
            {alternativeBusy ? `Checking ${alternativeDone} of ${project?.sites.length ?? 0}…` : "Rank saved sites"}
          </button>
          {alternativeError && <p role="status" className="text-[#ffbf70]">{alternativeError}</p>}
          {alternatives.length > 0 && <div className="grid gap-1">
            {alternatives.map((item, index) => <div key={item.site.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#343434] px-2.5 py-2">
              <span className="min-w-0 flex-1 font-medium text-white">{index + 1}. {item.site.name}</span>
              <span className="font-mono text-[#ddd]">Earth gap {item.data.earth.longest_hidden_hours.toFixed(1)} h · darkness {item.data.sun.longest_hidden_hours.toFixed(1)} h</span>
              <button type="button" onClick={() => setScenarioSiteId(item.site.id)} className="text-accent hover:underline">Use as scenario</button>
            </div>)}
          </div>}
        </div>}
      </section>}
    </>}
  </div>;
}
