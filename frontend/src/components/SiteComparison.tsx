import { useEffect, useRef, useState } from "react";

type Site = { id: string; name: string; latitude: number; longitude: number };
type Body = { visible_percent: number; longest_hidden_hours: number };
type Analysis = { sun: Body; earth: Body; both: Body };
type Job = { status: "running" | "completed" | "failed"; result: Analysis | null; error: string | null };
type Row = { site: Site; result: Analysis | null; error: string | null };

type Props = {
  sites: Site[];
  arrivalUtc: string;
  durationHours: number;
  onSelectSite: (siteId: string) => void;
};

export default function SiteComparison({ sites, arrivalUtc, durationHours, onSelectSite }: Props) {
  const [selectedIds, setSelectedIds] = useState(() => sites.slice(0, 2).map(site => site.id));
  const [rows, setRows] = useState<Row[]>([]);
  const [completed, setCompleted] = useState(0);
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  function toggle(siteId: string) {
    setSelectedIds(current => current.includes(siteId)
      ? current.filter(id => id !== siteId)
      : current.length < 4 ? [...current, siteId] : current);
    setRows([]);
  }

  async function compare() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const chosen = sites.filter(site => selectedIds.includes(site.id));
    setRows([]);
    setCompleted(0);
    setRunning(true);

    for (const site of chosen) {
      if (active.signal.aborted) return;
      let row: Row;
      try {
        const started = await fetch("/api/visibility/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: site.latitude, longitude: site.longitude,
            arrival_utc: arrivalUtc, duration_hours: durationHours }),
          signal: active.signal,
        });
        if (!started.ok) throw new Error(`Could not start calculation (${started.status})`);
        const { id } = await started.json() as { id: string };
        let job: Job;
        do {
          if (active.signal.aborted) return;
          const response = await fetch(`/api/visibility/jobs/${encodeURIComponent(id)}`, { signal: active.signal });
          if (!response.ok) throw new Error(`Could not load calculation (${response.status})`);
          job = await response.json() as Job;
          if (job.status === "running") await new Promise(resolve => window.setTimeout(resolve, 1000));
        } while (job.status === "running");
        row = { site, result: job.result, error: job.status === "failed" ? job.error || "Calculation failed" : job.result ? null : "No result returned" };
      } catch (reason) {
        if (active.signal.aborted) return;
        row = { site, result: null, error: reason instanceof Error ? reason.message : "Calculation unavailable" };
      }
      if (active.signal.aborted) return;
      setRows(current => [...current, row]);
      setCompleted(value => value + 1);
    }
    if (!active.signal.aborted) setRunning(false);
  }

  const bestSun = Math.max(...rows.map(row => row.result?.sun.visible_percent ?? -1));
  const bestEarthGap = Math.min(...rows.map(row => row.result?.earth.longest_hidden_hours ?? Infinity));

  return (
    <details className="orbis-panel p-3">
      <summary className="cursor-pointer text-sm font-medium text-white">Compare landing sites</summary>
      <div className="mt-3 space-y-3">
        <p className="text-[#aaa]">Choose two to four sites in this project. Each uses the same arrival time and mission duration.</p>
        {sites.length < 2 ? <p className="text-[#aaa]">Add a second landing site to compare locations.</p> : <>
          <div className="grid gap-1 sm:grid-cols-2">
            {sites.map(site => <label key={site.id} className="flex min-w-0 items-center gap-2 bg-[#343434] px-2 py-2 text-[#ddd]">
              <input type="checkbox" checked={selectedIds.includes(site.id)}
                disabled={running || (!selectedIds.includes(site.id) && selectedIds.length >= 4)}
                onChange={() => toggle(site.id)} className="accent-[#03ace4]" />
              <span className="truncate">{site.name}</span>
            </label>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={running || selectedIds.length < 2} onClick={() => void compare()}
              className="min-h-9 bg-[#03ace4] px-3 py-1.5 text-white hover:bg-[#079bc9] disabled:cursor-not-allowed disabled:opacity-50">
              Compare {selectedIds.length} sites
            </button>
            {running && <span role="status" className="text-[#aaa]">Calculating {completed} of {selectedIds.length} sites...</span>}
          </div>
        </>}
        {rows.length > 0 && <div className="grid gap-2">
          {rows.map(row => <div key={row.site.id} className="border-l-2 border-[#03ace4] bg-[#343434] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-white">{row.site.name} <span className="font-normal text-[#aaa]">{row.site.latitude.toFixed(4)}°, {row.site.longitude.toFixed(4)}°</span></div>
              <button type="button" onClick={() => onSelectSite(row.site.id)} className="text-[#66c9eb] hover:underline">Show on map</button>
            </div>
            {row.error ? <p className="mt-2 text-[#ef9292]">{row.error}</p> : row.result &&
              <div className="mt-2 grid gap-2 text-[#bbb] min-[480px]:grid-cols-2">
                <span>Sun visible <strong className="font-medium text-white">{row.result.sun.visible_percent.toFixed(1)}%</strong>{row.result.sun.visible_percent === bestSun && rows.length > 1 ? " · highest shown" : ""}</span>
                <span>Potential Earth visibility <strong className="font-medium text-white">{row.result.earth.visible_percent.toFixed(1)}%</strong></span>
                <span>Longest darkness <strong className="font-medium text-white">{row.result.sun.longest_hidden_hours.toFixed(1)} h</strong></span>
                <span>Longest Earth obstruction <strong className="font-medium text-white">{row.result.earth.longest_hidden_hours.toFixed(1)} h</strong>{row.result.earth.longest_hidden_hours === bestEarthGap && rows.length > 1 ? " · shortest shown" : ""}</span>
                <span>Sun and Earth together <strong className="font-medium text-white">{row.result.both.visible_percent.toFixed(1)}%</strong></span>
              </div>}
          </div>)}
        </div>}
        {rows.length > 0 && <p className="text-[10px] text-[#aaa]">Estimates use sampled terrain horizons, including the 5 m DEM near sites where available and the 80 m DEM farther out. Any visible part of the disk counts. Earth visibility is potential line of sight, not an operational communications link.</p>}
      </div>
    </details>
  );
}
