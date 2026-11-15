import { useState, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

type Window = { start_utc: string; end_utc: string; hours: number };
type Props = {
  startUtc: string;
  durationHours: number;
  elapsedHours: number;
  onTimeChange: (hours: number) => void;
  sun: Window[];
  earth: Window[];
  both: Window[];
};
type Scale = "mission" | "day";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const formatUtc = (time: number) => new Date(time).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const formatHours = (hours: number) => hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(2)} h`;

export default function VisibilityTimeline({ startUtc, durationHours, elapsedHours, onTimeChange, sun, earth, both }: Props) {
  const [scale, setScale] = useState<Scale>("mission");
  const [windowStart, setWindowStart] = useState(0);
  const [hovered, setHovered] = useState<{ label: string; start: number; end: number } | null>(null);
  const start = Date.parse(startUtc);
  const duration = Math.max(0, durationHours);
  const span = scale === "mission" ? duration : Math.min(duration, 24);
  const viewStart = scale === "mission" ? 0 : windowStart;
  const viewEnd = Math.min(duration, viewStart + span);
  const viewHours = Math.max(0.000001, viewEnd - viewStart);
  const selectedTime = start + clamp(elapsedHours, 0, duration) * 3600_000;
  const rows = [
    { label: "Sun", color: "#ff9900", windows: sun },
    { label: "Earth", color: "#03ace4", windows: earth },
    { label: "Both", color: "#60ba7b", windows: both },
  ];

  function seek(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onTimeChange(clamp(viewStart + (event.clientX - rect.left) / rect.width * viewHours, 0, duration));
  }

  function navigate(direction: number) {
    const lastStart = Math.floor(Math.max(0, duration - 0.000001) / span) * span;
    const next = clamp(viewStart + direction * span, 0, lastStart);
    setWindowStart(next);
    onTimeChange(next);
  }

  function changeScale(next: Scale) {
    const nextSpan = next === "mission" ? duration : Math.min(duration, 24);
    setScale(next);
    setWindowStart(next === "mission" ? 0 : Math.floor(
      clamp(elapsedHours, 0, Math.max(0, duration - 0.000001)) / nextSpan) * nextSpan);
  }

  return <section className="orbis-panel space-y-3 p-3 sm:p-4">
    <div className="flex flex-col gap-3 @min-[580px]:flex-row @min-[580px]:items-center @min-[580px]:justify-between">
      <div><h3 className="text-sm font-semibold text-white">Visibility over time</h3>
        <p className="text-[10px] text-[#aeb8bd]">Terrain-aware · any visible part of disk</p></div>
      <div className="flex w-full items-center justify-between gap-2 @min-[580px]:w-auto">
        <div role="group" aria-label="Timeline scale" className="flex border border-[#50585c]">
          {(["mission", "day"] as const).map(value => <button key={value} type="button"
            aria-pressed={scale === value} onClick={() => changeScale(value)}
            className={`min-h-8 px-2.5 capitalize ${scale === value ? "bg-[#3a5260] text-white" : "text-[#b9c2c6] hover:bg-[#424a4e]"}`}>{value === "mission" ? "Full" : value}</button>)}
        </div>
        <div className="flex border border-[#50585c]">
          <button type="button" onClick={() => navigate(-1)} disabled={scale === "mission" || viewStart <= 0}
            aria-label="Previous day" className="flex min-h-8 min-w-8 items-center justify-center text-[#d2d9dc] hover:bg-[#424a4e] disabled:opacity-40"><ArrowLeft size={15} /></button>
          <button type="button" onClick={() => navigate(1)} disabled={scale === "mission" || viewEnd >= duration}
            aria-label="Next day" className="flex min-h-8 min-w-8 items-center justify-center border-l border-[#50585c] text-[#d2d9dc] hover:bg-[#424a4e] disabled:opacity-40"><ArrowRight size={15} /></button>
        </div>
      </div>
    </div>
    <div className="grid grid-cols-[46px_minmax(0,1fr)] gap-x-2 gap-y-2 sm:grid-cols-[58px_minmax(0,1fr)] sm:gap-x-3">
      <div />
      <div className="relative h-6 text-[10px] font-mono text-[#aeb8bd]">
        {Array.from({ length: 5 }, (_, index) => <span key={index} className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${index * 25}%`, transform: index === 0 ? "none" : index === 4 ? "translateX(-100%)" : undefined }}>
          {scale === "mission" ? `+${Math.round(viewStart + viewHours * index / 4)}h`
            : `${Math.round(viewHours * index / 4)}h`}
        </span>)}
      </div>
      {rows.map(row => <div key={row.label} className="contents">
        <div className="flex items-center text-xs font-medium text-[#dce2e4]">{row.label}</div>
        <div role="slider" tabIndex={0} aria-label={`Mission time on ${row.label} visibility row`}
          aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(elapsedHours * 100) / 100}
          aria-valuetext={formatUtc(selectedTime)}
          onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault(); onTimeChange(clamp(elapsedHours + (event.key === "ArrowRight" ? 1 : -1) *
              (scale === "day" ? 0.25 : 1), 0, duration));
          } }}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); seek(event); }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event); }}
          className="relative h-9 min-w-0 cursor-crosshair rounded bg-[#3b3f42] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          style={{ touchAction: "none" }}>
          {[0, 25, 50, 75, 100].map(tick => <span key={tick} aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l border-dashed border-white/15" style={{ left: `${tick}%` }} />)}
          {row.windows.map((window, index) => {
            const windowStart = (Date.parse(window.start_utc) - start) / 3600_000;
            const windowEnd = (Date.parse(window.end_utc) - start) / 3600_000;
            const left = clamp(windowStart, viewStart, viewEnd);
            const right = clamp(windowEnd, viewStart, viewEnd);
            if (right <= left) return null;
            return <span key={`${window.start_utc}-${index}`} className="absolute inset-y-0 rounded-sm"
              style={{ left: `${(left - viewStart) / viewHours * 100}%`, width: `${(right - left) / viewHours * 100}%`, backgroundColor: row.color }}
              onPointerEnter={() => setHovered({ label: row.label, start: Date.parse(window.start_utc), end: Date.parse(window.end_utc) })}
              onPointerLeave={() => setHovered(null)} />;
          })}
          {elapsedHours >= viewStart && elapsedHours <= viewEnd && <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -top-2 z-10 w-0.5 bg-white shadow-[0_0_4px_#000]"
            style={{ left: `${(elapsedHours - viewStart) / viewHours * 100}%` }} />}
        </div>
      </div>)}
    </div>
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[10px] text-[#aeb8bd]">
      <span>{formatUtc(start + viewStart * 3600_000)}</span>
      <span className="font-mono text-white">Cursor {formatUtc(selectedTime)}</span>
      <span>{formatUtc(start + viewEnd * 3600_000)}</span>
    </div>
    {hovered ? <p role="status" className="text-[11px] text-[#dce2e4]">{hovered.label}: {formatUtc(hovered.start)} → {formatUtc(hovered.end)} · {formatHours((hovered.end - hovered.start) / 3600_000)}</p>
      : <p className="text-[11px] text-[#aeb8bd]">Click or drag to set mission time. Dark sections have no visibility. Sun visibility does not establish usable power; Earth visibility does not establish a communications link.</p>}
    {!sun.length && !earth.length && <p className="text-[#aeb8bd]">No Sun or Earth visibility windows in this mission.</p>}
  </section>;
}
