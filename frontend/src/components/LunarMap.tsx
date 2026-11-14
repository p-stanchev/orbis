import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Layers, LocateFixed, Minus, Plus } from "lucide-react";

type Site = { id: string; name: string; latitude: number; longitude: number };
type Project = { id: string; name: string; sites: Site[] };
type Target = { projectId: string; siteId?: string };
type Bounds = { left: number; right: number; top: number; bottom: number };
type Info = { bounds: Bounds; pole: { x: number; y: number }; radius: number };
type Marker = { id: string; u: number; v: number };
type Point = { latitude: number; longitude: number; u: number; v: number };
type Props = {
  projects: Project[];
  selected: Target | null;
  onSelectSite: (target: Target | null) => void;
  onMoveSite: (target: Target, latitude: number, longitude: number) => Promise<void>;
};
type Pointer = { x: number; y: number };
type Gesture = {
  start: Pointer;
  last: Pointer;
  moved: boolean;
  pinch: boolean;
  distance: number;
  marker: Target | null;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function LunarMap({ projects, selected, onSelectSite, onMoveSite }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const map = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef<Gesture | null>(null);

  const [info, setInfo] = useState<Info | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [preview, setPreview] = useState<{ id: string; u: number; v: number } | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [shadows, setShadows] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const side = Math.min(dimensions.width, dimensions.height);

  const siteList = projects.flatMap(project => project.sites.map(site => ({
    id: site.id, latitude: site.latitude, longitude: site.longitude,
  })));
  const siteKey = JSON.stringify(siteList);
  const projectSites = projects.flatMap(project => project.sites.map(site => ({
    target: { projectId: project.id, siteId: site.id }, site,
  })));

  useEffect(() => {
    let active = true;
    fetch("/api/terrain/info")
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Info>; })
      .then(result => { if (active) { setInfo(result); setError(""); } })
      .catch(() => { if (active) setError("Could not load lunar terrain."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (!siteList.length) { setMarkers([]); return () => controller.abort(); }
    fetch("/api/terrain/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: siteKey,
      signal: controller.signal,
    })
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Marker[]>; })
      .then(setMarkers)
      .catch(() => { if (!controller.signal.aborted) setError("Could not position landing sites."); });
    return () => controller.abort();
  }, [siteKey]);

  function limitedOffset(value: Pointer, scale: number) {
    const scaled = side * scale;
    return {
      x: clamp(value.x, -Math.max(0, (scaled - dimensions.width) / 2), Math.max(0, (scaled - dimensions.width) / 2)),
      y: clamp(value.y, -Math.max(0, (scaled - dimensions.height) / 2), Math.max(0, (scaled - dimensions.height) / 2)),
    };
  }

  function changeZoom(factor: number) {
    const next = clamp(zoom * factor, 1, 8);
    setZoom(next);
    setOffset(current => limitedOffset(current, next));
  }

  function reset() { setZoom(1); setOffset({ x: 0, y: 0 }); }

  function normalizedPoint(clientX: number, clientY: number) {
    if (!map.current || !info) return null;
    const rect = map.current.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top) / rect.height;
    const { bounds, pole, radius } = info;
    let x = bounds.left + u * (bounds.right - bounds.left);
    let y = bounds.top - v * (bounds.top - bounds.bottom);
    const distance = Math.hypot(x - pole.x, y - pole.y);
    if (distance > radius) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, u, v };
  }

  function constrainedPoint(clientX: number, clientY: number) {
    if (!map.current || !info) return null;
    const rect = map.current.getBoundingClientRect();
    const { bounds, pole, radius } = info;
    let x = bounds.left + ((clientX - rect.left) / rect.width) * (bounds.right - bounds.left);
    let y = bounds.top - ((clientY - rect.top) / rect.height) * (bounds.top - bounds.bottom);
    const distance = Math.hypot(x - pole.x, y - pole.y);
    if (distance >= radius) {
      const ratio = (radius * 0.999) / distance;
      x = pole.x + (x - pole.x) * ratio;
      y = pole.y + (y - pole.y) * ratio;
    }
    return {
      x, y,
      u: (x - bounds.left) / (bounds.right - bounds.left),
      v: (bounds.top - y) / (bounds.top - bounds.bottom),
    };
  }

  async function coordinateAt(x: number, y: number) {
    const response = await fetch(`/api/terrain/coordinates?x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}`);
    if (!response.ok) throw new Error("Invalid lunar location");
    return response.json() as Promise<{ latitude: number; longitude: number }>;
  }

  async function place(target: Target | null, position: ReturnType<typeof normalizedPoint>) {
    if (!position) return;
    setSaving(true);
    setError("");
    try {
      const coords = await coordinateAt(position.x, position.y);
      setPoint({ ...coords, u: position.u, v: position.v });
      if (target?.siteId) await onMoveSite(target, coords.latitude, coords.longitude);
    } catch {
      setError("Could not save landing-site location.");
    } finally {
      setSaving(false);
      setPreview(null);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, pointer);

    if (pointers.current.size === 1) {
      const markerId = (event.target as HTMLElement).closest<HTMLElement>("[data-site-id]")?.dataset.siteId;
      const markerTarget = projectSites.find(item => item.site.id === markerId)?.target ?? null;
      gesture.current = {
        start: pointer, last: pointer, moved: false, pinch: false, distance: 0, marker: markerTarget,
      };
    } else if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = true;
      gesture.current.distance = Math.hypot(a.x - b.x, a.y - b.y);
      setPreview(null);
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous || !gesture.current) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, now);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.distance > 0) changeZoom(distance / gesture.current.distance);
      gesture.current.distance = distance;
      gesture.current.pinch = true;
      gesture.current.moved = true;
      return;
    }

    const movement = Math.hypot(now.x - gesture.current.start.x, now.y - gesture.current.start.y);
    if (movement > 5) gesture.current.moved = true;
    if (!gesture.current.moved || gesture.current.pinch) return;

    if (gesture.current.marker?.siteId) {
      const location = constrainedPoint(now.x, now.y);
      if (location) setPreview({ id: gesture.current.marker.siteId, u: location.u, v: location.v });
    } else {
      setOffset(current => limitedOffset({
        x: current.x + now.x - previous.x,
        y: current.y + now.y - previous.y,
      }, zoom));
    }
    gesture.current.last = now;
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const lastPointer = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (!lastPointer || !current) return;
    gesture.current = null;
    if (current.pinch) return;

    if (current.marker?.siteId && current.moved) {
      const location = constrainedPoint(event.clientX, event.clientY);
      onSelectSite(current.marker);
      void place(current.marker, location);
    } else if (current.marker && !current.moved) {
      const active = current.marker.projectId === selected?.projectId && current.marker.siteId === selected?.siteId;
      onSelectSite(active ? null : current.marker);
    } else if (!current.moved && !current.marker && selected?.siteId) {
      void place(selected, normalizedPoint(event.clientX, event.clientY));
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    changeZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  const ring = info ? {
    cx: (info.pole.x - info.bounds.left) / (info.bounds.right - info.bounds.left) * 100,
    cy: (info.bounds.top - info.pole.y) / (info.bounds.top - info.bounds.bottom) * 100,
    rx: info.radius / (info.bounds.right - info.bounds.left) * 100,
    ry: info.radius / (info.bounds.top - info.bounds.bottom) * 100,
  } : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#191919] text-[#ddd]">
      <div
        ref={viewport}
        className="absolute inset-0 overflow-hidden"
        style={{ touchAction: "none" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={event => {
          pointers.current.delete(event.pointerId);
          gesture.current = null;
          setPreview(null);
        }}
      >
        {info && side > 0 ? (
          <div
            ref={map}
            className="absolute left-1/2 top-1/2 select-none"
            style={{
              width: side, height: side,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            }}
          >
            <img src="/api/terrain/preview/hillshade?v=3" draggable={false} alt="NASA south-pole hillshade"
              className="pointer-events-none absolute inset-0 h-full w-full"
              onError={() => setError("Could not display terrain image.")} />
            {shadows && (
              <img src="/api/terrain/preview/shadows?v=3" draggable={false} alt="Permanently shadowed areas"
                className="pointer-events-none absolute inset-0 h-full w-full" />
            )}
            {ring && (
              <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry}
                  fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="0.12" />
                <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx / 2} ry={ring.ry / 2}
                  fill="none" stroke="white" strokeOpacity="0.28" strokeDasharray="0.65 0.65" strokeWidth="0.1" />
                <path d={`M${ring.cx - ring.rx} ${ring.cy} H${ring.cx + ring.rx} M${ring.cx} ${ring.cy - ring.ry} V${ring.cy + ring.ry}`}
                  stroke="white" strokeOpacity="0.2" strokeWidth="0.1" />
                <circle cx={ring.cx} cy={ring.cy} r="0.32" fill="white" />
              </svg>
            )}
            {projectSites.map(({ target, site }) => {
              const marker = markers.find(item => item.id === site.id);
              const position = preview?.id === site.id ? preview : marker;
              if (!position) return null;
              const active = target.projectId === selected?.projectId && site.id === selected.siteId;
              return (
                <button
                  key={site.id}
                  type="button"
                  data-site-id={site.id}
                  aria-label={`Move or select ${site.name}`}
                  title={`${site.name}: drag to move`}
                  className="absolute z-10 flex h-7 w-7 cursor-grab items-center justify-center active:cursor-grabbing"
                  style={{
                    left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                    transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  }}
                >
                  <span className={`pointer-events-none h-3.5 w-3.5 rounded-full border-2 border-white ${
                    active ? "bg-accent ring-4 ring-accent/30" : "bg-warning"
                  }`} />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[#aaa]">
            {error || "Loading lunar terrain..."}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-20 bg-[#242424]/95 px-3 py-2 text-[11px]">
        LUNAR SOUTH POLE <span className="ml-1 text-[#aaa]">80°S–90°S</span>
      </div>
      <div className="absolute right-3 top-12 z-20 flex gap-1 bg-[#242424]/95 p-1 sm:top-3">
        <button className={`flex h-8 items-center gap-1 px-2 text-xs ${shadows ? "bg-[#444] text-accent" : "text-[#aaa]"}`}
          type="button" aria-label="Toggle permanent shadows" aria-pressed={shadows}
          onClick={() => setShadows(!shadows)}><Layers size={15} /> PSR</button>
        <button type="button" title="Zoom in" aria-label="Zoom in" className="p-2 hover:bg-[#444]" onClick={() => changeZoom(1.5)}><Plus size={15} /></button>
        <button type="button" title="Zoom out" aria-label="Zoom out" className="p-2 hover:bg-[#444]" onClick={() => changeZoom(1 / 1.5)}><Minus size={15} /></button>
        <button type="button" title="Reset view" aria-label="Reset view" className="p-2 hover:bg-[#444]" onClick={reset}><LocateFixed size={15} /></button>
      </div>
      {shadows && (
        <div className="pointer-events-none absolute left-3 top-14 z-20 bg-[#242424]/95 px-3 py-2 text-[11px]">
          <span className="mr-2 inline-block h-2 w-2 bg-accent" />Permanently shadowed regions
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 bg-[#242424]/95 p-2 font-mono text-[11px]">
        {point ? <><div>LAT {point.latitude.toFixed(5)}°</div><div>LON {point.longitude.toFixed(5)}°</div></> :
          <span className="text-[#aaa]">{selected?.siteId ? "Click terrain to move selected site" : "Select a site to place it"}</span>}
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 z-20 bg-[#242424]/95 px-2 py-1 text-[10px] text-[#aaa]">
        {saving ? "Saving..." : `${Math.round(zoom * 100)}% · LOLA`}
      </div>
      {error && info && <div className="pointer-events-none absolute bottom-14 left-3 z-20 bg-[#292929] px-3 py-2 text-xs text-[#ef9292]">{error}</div>}
    </div>
  );
}
