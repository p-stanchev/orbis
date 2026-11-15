import { useEffect, useRef, useState } from "react";
import { CalendarSearch, ArrowUpRight } from "lucide-react";
import NumericInput from "./NumericInput";

type Site = { id: string; name: string; latitude: number; longitude: number };
type Project = { id: string; name: string; arrival_utc: string; duration_hours: number; sites: Site[] };
type Arrival = { arrival_utc: string; end_utc: string; sun_percent: number; earth_percent: number;
  both_percent: number; darkness_hours: number; earth_outage_hours: number; feasible: boolean;
  violations: { label: string; actual_hours: number; limit_hours: number }[] };
type Result = { start_utc: string; search_days: number; duration_hours: number; daily: Arrival[];
  ranked: Arrival[]; feasible_days: number; landing_uncertainty_m: number;
  horizon_coverage_min_km: number; sample_step_minutes: number; model: string };
type Props = { projects: Project[]; initialProjectId?: string; initialSiteId?: string; uncertaintyM: number;
  onInspect: (projectId: string, siteId: string, arrival: string, duration: number) => void;
  onApply: (projectId: string, siteId: string, arrival: string, duration: number) => Promise<void>;
  onSearchArea: (latitude: number, longitude: number, arrival: string, duration: number, darkness: number, earthOutage: number) => void };

const dateText = (value: string) => new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const field = "mt-1 h-9 w-full min-w-0 border border-[#555] bg-[#292929] px-2 text-xs text-white outline-none focus:border-accent [color-scheme:dark]";
const label = "block min-w-0 text-xs text-[#aaa]";

export default function OptimalLandingWindow({ projects, initialProjectId, initialSiteId, uncertaintyM, onInspect, onApply, onSearchArea }: Props) {
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const project = projects.find(item => item.id === projectId);
  const [siteId, setSiteId] = useState(initialSiteId ?? "");
  const site = project?.sites.find(item => item.id === siteId);
  const [start, setStart] = useState(() => (projects.find(item => item.id === initialProjectId)?.arrival_utc ?? new Date().toISOString()).slice(0, 16));
  const [days, setDays] = useState(30);
  const [duration, setDuration] = useState(String(project?.duration_hours ?? 336));
  const [darkness, setDarkness] = useState("24");
  const [outage, setOutage] = useState("12");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!projectId && initialProjectId) setProjectId(initialProjectId);
  }, [initialProjectId, projectId]);
  useEffect(() => {
    if (project && !project.sites.some(item => item.id === siteId)) setSiteId(project.sites[0]?.id ?? "");
  }, [project, siteId]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    setBusy(false);
    setResult(null);
  }, [projectId, siteId, start, days, duration, darkness, outage, uncertaintyM]);

  async function search() {
    if (!project || !site) { setError("Choose a landing site first."); return; }
    const durationHours = Number(duration);
    const darkHours = Number(darkness);
    const outageHours = Number(outage);
    const arrival = new Date(`${start}Z`);
    if (!start || !Number.isFinite(arrival.getTime()) || !duration.trim() || !Number.isFinite(durationHours) || durationHours < 1 || durationHours > 8760 ||
      !darkness.trim() || !outage.trim() || !Number.isFinite(darkHours) || !Number.isFinite(outageHours) || darkHours < 0 || outageHours < 0) {
      setError("Enter a valid UTC start, mission duration, and nonnegative outage limits."); return;
    }
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setProgress(0); setError(""); setResult(null);
    try {
      const response = await fetch("/api/visibility/windows/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, signal: active.signal,
        body: JSON.stringify({ latitude: site.latitude, longitude: site.longitude, arrival_utc: arrival.toISOString(),
          duration_hours: durationHours, search_days: days, max_no_sun_hours: darkHours,
          max_no_earth_hours: outageHours, landing_uncertainty_m: uncertaintyM }) });
      if (!response.ok) throw new Error(`Could not start search (${response.status}).`);
      const started: { id: string } = await response.json();
      while (!active.signal.aborted) {
        const statusResponse = await fetch(`/api/visibility/jobs/${encodeURIComponent(started.id)}`, { signal: active.signal });
        if (!statusResponse.ok) throw new Error(`Could not read search (${statusResponse.status}).`);
        const job: { status: string; progress: number; result: Result | null; error: string | null } = await statusResponse.json();
        setProgress(job.progress);
        if (job.status === "completed") { setResult(job.result); break; }
        if (job.status === "failed") throw new Error(job.error ?? "Search failed.");
        await new Promise(resolve => setTimeout(resolve, 700));
      }
    } catch (reason) {
      if (!active.signal.aborted) setError(reason instanceof Error ? reason.message : "Search failed.");
    } finally { if (!active.signal.aborted) setBusy(false); }
  }

  const top = result?.ranked.filter(item => item.feasible).slice(0, 5) ?? [];
  const alternatives = result?.ranked.filter(item => !item.feasible).slice(0, top.length ? 2 : 5) ?? [];
  function row(item: Arrival, index: number) {
    return <div key={item.arrival_utc} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#444] py-2.5">
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] text-accent">#{index + 1}</span>
        <strong className="text-xs text-white">{dateText(item.arrival_utc)}</strong>
        <span className={`text-[11px] ${item.feasible ? "text-[#73bd87]" : "text-[#e4a85e]"}`}>{item.feasible ? "Site meets limits" : "Closest alternative"}</span></div>
        <p className="mt-1 text-[11px] text-[#b9c1c5]">Sun {item.sun_percent.toFixed(1)}% · Earth {item.earth_percent.toFixed(1)}% · Both {item.both_percent.toFixed(1)}%</p>
        <p className="text-[11px] text-[#b9c1c5]">Longest darkness {item.darkness_hours.toFixed(1)} h · Earth outage {item.earth_outage_hours.toFixed(1)} h</p>
        {item.violations.length > 0 && <p className="text-[11px] text-[#e4a85e]">Misses: {item.violations.map(v => `${v.label} ${v.actual_hours.toFixed(1)} h > ${v.limit_hours} h`).join("; ")}</p>}
      </div>
      <div className="flex flex-wrap gap-1"><button type="button" onClick={() => onInspect(projectId, siteId, item.arrival_utc, Number(duration))}
        className="flex min-h-9 items-center gap-1 border border-[#596269] px-2 text-[11px] text-white hover:border-accent">Inspect <ArrowUpRight size={13} /></button>
        <button type="button" onClick={() => site && onSearchArea(site.latitude, site.longitude, item.arrival_utc, Number(duration), Number(darkness), Number(outage))}
          className="min-h-9 border border-[#596269] px-2 text-[11px] text-white hover:border-accent">Use in candidate search</button>
        <button type="button" disabled={!!saving} onClick={async () => { setSaving(item.arrival_utc); setError(""); try { await onApply(projectId, siteId, item.arrival_utc, Number(duration)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save arrival date."); } finally { setSaving(""); } }}
          className="min-h-9 bg-accent px-2 text-[11px] font-medium text-white hover:brightness-90 disabled:opacity-50">{saving === item.arrival_utc ? "Saving…" : "Save to project"}</button></div>
    </div>;
  }

  return <div className="orbis-explore mx-auto max-w-[1200px] space-y-3 pb-3 text-xs leading-relaxed">
    <div className="flex items-start justify-between gap-2"><div><h3 className="text-base font-semibold text-white">Optimal landing window</h3>
      <p className="mt-1 text-[#aaa]">Find favorable arrival times for a selected landing site under your outage limits.</p></div><CalendarSearch size={18} className="shrink-0 text-accent" /></div>
    <section className="orbis-panel space-y-3 p-3">
      <div className="grid gap-3 min-[480px]:grid-cols-2"><label className={label}>Project
        <select className={field} value={projectId} onChange={event => { const next = projects.find(item => item.id === event.target.value); setProjectId(event.target.value); setSiteId(next?.sites[0]?.id ?? ""); setStart((next?.arrival_utc ?? new Date().toISOString()).slice(0, 16)); setDuration(String(next?.duration_hours ?? 336)); }}>
          <option value="">Select project</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className={label}>Landing site
          <select className={field} value={siteId} onChange={event => setSiteId(event.target.value)} disabled={!project}>
            <option value="">Select site</option>{project?.sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      {site && <p className="text-[11px] text-[#aeb8bd]">{site.latitude.toFixed(5)}°, {site.longitude.toFixed(5)}° · {uncertaintyM.toLocaleString()} m landing uncertainty from Candidate search</p>}
      <div className="grid gap-3 min-[480px]:grid-cols-2"><label className={label}>Search starts · UTC
        <input className={field} type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label>
        <label className={label}>Mission duration · hours
          <NumericInput className={field} min={1} max={8760} value={duration} onValueChange={setDuration} /></label></div>
      <div><span className={label}>Search period</span><div className="mt-1 grid grid-cols-3 border border-[#555]">{[30, 60, 90].map(value =>
        <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}
          className={`min-h-9 border-r border-[#555] px-2 text-xs last:border-r-0 ${days === value ? "border-b-2 border-b-accent bg-[#303b40] text-white" : "text-[#bbb] hover:bg-[#383838]"}`}>{value} days</button>)}</div></div>
      <div className="grid gap-3 min-[480px]:grid-cols-2"><label className={label}>Maximum darkness · h
        <NumericInput className={field} min={0} max={8760} value={darkness} onValueChange={setDarkness} /></label>
        <label className={label}>Maximum Earth outage · h
          <NumericInput className={field} min={0} max={8760} value={outage} onValueChange={setOutage} /></label></div>
      <button type="button" disabled={busy || !site} onClick={() => void search()}
        className="min-h-10 w-full bg-accent px-3 py-2 font-medium text-white hover:brightness-90 disabled:opacity-50">{busy ? `Searching… ${Math.round(progress * 100)}%` : "Find optimal dates"}</button>
      <p className="text-[11px] text-[#aeb8bd]">Saving changes this project's arrival time and duration for every site. Inspect previews without saving. Use in candidate search fills its area, date, duration, and outage limits so you can check nearby terrain.</p>
    </section>
    {error && <p role="alert" className="text-[#ef9292]">{error}</p>}
    {result && <section className="orbis-panel space-y-3 p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-white">Landing opportunities</h3>
      <span className="text-[11px] text-[#aaa]">{result.feasible_days} of {result.search_days} daily arrivals meet both limits</span></div>
      <div className="flex gap-[2px] overflow-x-auto pb-2" aria-label="Daily arrival suitability">
        {result.daily.map((item, index) => <button key={item.arrival_utc} type="button" title={`Day ${index + 1} · ${dateText(item.arrival_utc)} · ${item.feasible ? "Meets limits" : item.violations.map(v => v.label).join(" and ") + " exceeds limit"}`}
          onClick={() => onInspect(projectId, siteId, item.arrival_utc, Number(duration))}
          className={`h-12 min-w-[8px] flex-1 ${item.feasible ? "bg-[#70af7d]" : item.violations.length === 1 ? "bg-[#de973e]" : "bg-[#ba3939]"} hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`} aria-label={`Inspect day ${index + 1}, ${dateText(item.arrival_utc)}`} />)}</div>
      <div className="flex justify-between text-[11px] text-[#aaa]"><span>{dateText(result.start_utc)}</span><span>Day {result.search_days}</span></div>
      <p className="text-[11px] text-[#aaa]">Green meets both site limits · amber misses one · red misses both. Select a day to preview it. Candidate Search also requires a qualifying area and may reach a different result.</p>
      {top.length > 0 ? <div><h4 className="font-medium text-white">Top arrival times</h4>{top.map(row)}</div> : <p className="border-t border-[#444] pt-3 text-[#e4a85e]">No sampled arrival meets both limits. These are the closest alternatives, with each missed limit shown below.</p>}
      {alternatives.length > 0 && <div><h4 className="font-medium text-white">Closest alternatives</h4>{alternatives.map((item, index) => row(item, top.length + index))}</div>}
      <details className="border-t border-[#444] pt-2 text-[11px] text-[#aeb8bd]"><summary className="cursor-pointer text-white">Method and limits</summary><p className="mt-2">{result.model}</p>
        <p className="mt-1">Sample interval {result.sample_step_minutes} min; distant DEM coverage reaches at least {result.horizon_coverage_min_km.toFixed(1)} km across sampled positions. Shorter opportunities between sampled arrivals can be missed.</p></details>
    </section>}
  </div>;
}
