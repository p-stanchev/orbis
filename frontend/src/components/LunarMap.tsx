import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Layers, LocateFixed, MapPin, Minus, Plus, X } from "lucide-react";
import type { SearchRegion, SearchGridCell } from "./VisibilityStatistics";
import LandmarkCard, { type Landmark } from "./LandmarkCard";

type Site = { id: string; name: string; latitude: number; longitude: number };
type Project = {
  id: string; name: string; color: string; sites: Site[];
  center_latitude: number; center_longitude: number; radius_m: number;
};
type Target = { projectId: string; siteId?: string };
type Bounds = { left: number; right: number; top: number; bottom: number };
type Info = { bounds: Bounds; pole: { x: number; y: number }; radius: number };
type Marker = { id: string; u: number; v: number };
type Point = { latitude: number; longitude: number; u: number; v: number };
type Props = {
  landmarksEnabled: boolean;
  projects: Project[];
  hiddenProjectIds: string[];
  unlockedSiteIds: string[];
  selected: Target | null;
  regions: { projectId: string | null; areas: SearchRegion[]; grid: SearchGridCell[]; spacing: number } | null;
  exploreArea: { latitude: number; longitude: number; radius_m: number } | null;
  probePoint: { latitude: number; longitude: number } | null;
  probeMode: boolean;
  onProbePoint: (point: { latitude: number; longitude: number }) => void;
  onSelectSite: (target: Target | null) => void;
  onMoveSite: (target: Target, latitude: number, longitude: number) => Promise<void>;
  onMoveProjectCenter: (projectId: string, latitude: number, longitude: number) => Promise<void>;
  onMoveExploreArea: (latitude: number, longitude: number) => void;
};
type Pointer = { x: number; y: number };
type Gesture = {
  start: Pointer;
  last: Pointer;
  moved: boolean;
  pinch: boolean;
  distance: number;
  marker: Target | null;
  explore: boolean;
  exploreOffset: Pointer;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const MAP_HINT_KEY = "orbis-map-hint-dismissed-v1";

export default function LunarMap({ landmarksEnabled, projects, hiddenProjectIds, unlockedSiteIds, selected, regions, exploreArea, probePoint, probeMode, onProbePoint, onSelectSite, onMoveSite, onMoveProjectCenter, onMoveExploreArea }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const map = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef<Gesture | null>(null);

  const [info, setInfo] = useState<Info | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [regionMarkers, setRegionMarkers] = useState<Marker[]>([]);
  const [probeMarker, setProbeMarker] = useState<Marker | null>(null);
  const [exploreMarker, setExploreMarker] = useState<Marker | null>(null);
  const [preview, setPreview] = useState<{ id: string; u: number; v: number } | null>(null);
  const [explorePreview, setExplorePreview] = useState<{ u: number; v: number } | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [shadows, setShadows] = useState(false);
  const [landmarksVisible, setLandmarksVisible] = useState(false);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [landmarkMarkers, setLandmarkMarkers] = useState<Marker[]>([]);
  const [activeLandmarkId, setActiveLandmarkId] = useState<string | null>(null);
  const [landmarkCardOpen, setLandmarkCardOpen] = useState(false);
  const [landmarkError, setLandmarkError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [smoothFocus, setSmoothFocus] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [hintDismissed, setHintDismissed] = useState(() => {
    try {
      return localStorage.getItem(MAP_HINT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const selectedLocked = !!selected?.siteId && !unlockedSiteIds.includes(selected.siteId);
  const side = Math.min(dimensions.width, dimensions.height);
  const regionPositions = new Map(regionMarkers.map(marker => [marker.id, marker]));
  const landmarkPositions = new Map(landmarkMarkers.map(marker => [marker.id, marker]));
  const activeLandmarkIndex = landmarks.findIndex(landmark => landmark.id === activeLandmarkId);
  const activeLandmark = activeLandmarkIndex >= 0 ? landmarks[activeLandmarkIndex] : null;

  useEffect(() => {
    if (!landmarksEnabled) {
      setLandmarkCardOpen(false);
      setActiveLandmarkId(null);
    }
  }, [landmarksEnabled]);

  const siteList = projects.flatMap(project => [
    { id: `center:${project.id}`, latitude: project.center_latitude, longitude: project.center_longitude },
    ...project.sites.map(site => ({ id: site.id, latitude: site.latitude, longitude: site.longitude })),
  ]);
  const siteKey = JSON.stringify(siteList);
  const visibleProjects = projects.filter(project => !hiddenProjectIds.includes(project.id));
  const projectSites = visibleProjects.flatMap(project => project.sites.map(site => ({
    target: { projectId: project.id, siteId: site.id }, site, color: project.color,
  })));

  function dismissHint() {
    setHintDismissed(true);
    try {
      localStorage.setItem(MAP_HINT_KEY, "1");
    } catch {
      return;
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/terrain/info")
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Info>; })
      .then(result => { if (active) { setInfo(result); setError(""); } })
      .catch(() => { if (active) setError("Could not load lunar terrain."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/landmarks.json", { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ landmarks: Landmark[] }>; })
      .then(catalog => {
        if (!Array.isArray(catalog.landmarks)) throw new Error();
        setLandmarks(catalog.landmarks.filter(landmark => landmark.id && Number.isFinite(landmark.latitude) &&
          Number.isFinite(landmark.longitude)).sort((a, b) => a.tour_order - b.tour_order));
      })
      .catch(() => { if (!controller.signal.aborted) setLandmarkError("Could not load lunar landmarks."); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!landmarks.length) return;
    const controller = new AbortController();
    fetch("/api/terrain/project", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify(landmarks.map(({ id, latitude, longitude }) => ({ id, latitude, longitude }))),
    }).then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Marker[]>; })
      .then(setLandmarkMarkers)
      .catch(() => { if (!controller.signal.aborted) setLandmarkError("Could not position lunar landmarks."); });
    return () => controller.abort();
  }, [landmarks]);

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

  const regionKey = JSON.stringify(regions);
  useEffect(() => {
    const controller = new AbortController();
    if (!regions?.grid.length) { setRegionMarkers([]); return () => controller.abort(); }
    const cells = regions.grid.map((cell, index) => ({
      id: `grid:${index}`, latitude: cell.latitude, longitude: cell.longitude,
    }));
    fetch("/api/terrain/project", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify(cells),
    }).then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Marker[]>; })
      .then(setRegionMarkers)
      .catch(() => { if (!controller.signal.aborted) setRegionMarkers([]); });
    return () => controller.abort();
  }, [regionKey]);

  useEffect(() => {
    const controller = new AbortController();
    if (!probePoint) { setProbeMarker(null); return () => controller.abort(); }
    fetch("/api/terrain/project", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify([{ id: "probe", ...probePoint }]),
    }).then(response => response.json() as Promise<Marker[]>)
      .then(result => setProbeMarker(result[0] ?? null))
      .catch(() => { if (!controller.signal.aborted) setProbeMarker(null); });
    return () => controller.abort();
  }, [probePoint?.latitude, probePoint?.longitude]);

  useEffect(() => {
    const controller = new AbortController();
    if (!exploreArea) { setExploreMarker(null); return () => controller.abort(); }
    fetch("/api/terrain/project", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify([{ id: "explore", latitude: exploreArea.latitude, longitude: exploreArea.longitude }]),
    }).then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Marker[]>; })
      .then(result => setExploreMarker(result[0] ?? null))
      .catch(() => { if (!controller.signal.aborted) setExploreMarker(null); });
    return () => controller.abort();
  }, [exploreArea?.latitude, exploreArea?.longitude]);

  function limitedOffset(value: Pointer, scale: number) {
    const scaled = side * scale;
    return {
      x: clamp(value.x, -Math.max(0, (scaled - dimensions.width) / 2), Math.max(0, (scaled - dimensions.width) / 2)),
      y: clamp(value.y, -Math.max(0, (scaled - dimensions.height) / 2), Math.max(0, (scaled - dimensions.height) / 2)),
    };
  }

  function changeZoom(factor: number) {
    setSmoothFocus(false);
    const next = clamp(zoom * factor, 1, 10);
    setZoom(next);
    setOffset(current => limitedOffset(current, next));
  }

  function reset() { setSmoothFocus(false); setZoom(1); setOffset({ x: 0, y: 0 }); }

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

  function withinSearchRadius(position: ReturnType<typeof constrainedPoint>, target: Target | null) {
    if (!position || !target?.siteId || !info) return position;
    const project = projects.find(item => item.id === target.projectId);
    const center = markers.find(item => item.id === `center:${target.projectId}`);
    if (!project || !center) return null;
    const width = info.bounds.right - info.bounds.left;
    const height = info.bounds.top - info.bounds.bottom;
    const dx = (position.u - center.u) * width;
    const dy = (position.v - center.v) * height;
    const distance = Math.hypot(dx, dy);
    if (distance <= project.radius_m * 0.98) return position;
    const ratio = Math.max(0, project.radius_m * 0.98) / distance;
    const u = center.u + dx * ratio / width;
    const v = center.v + dy * ratio / height;
    return { x: info.bounds.left + u * width, y: info.bounds.top - v * height, u, v };
  }

  async function coordinateAt(x: number, y: number) {
    const response = await fetch(`/api/terrain/coordinates?x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}`);
    if (!response.ok) throw new Error("Invalid lunar location");
    return response.json() as Promise<{ latitude: number; longitude: number }>;
  }

  async function place(target: Target | null, position: ReturnType<typeof normalizedPoint>) {
    if (!position || (target?.siteId && !unlockedSiteIds.includes(target.siteId))) return;
    setSaving(true);
    setError("");
    try {
      const coords = await coordinateAt(position.x, position.y);
      setPoint({ ...coords, u: position.u, v: position.v });
      if (target?.siteId) await onMoveSite(target, coords.latitude, coords.longitude);
      else if (target) await onMoveProjectCenter(target.projectId, coords.latitude, coords.longitude);
    } catch {
      setError("Could not save landing-site location.");
    } finally {
      setSaving(false);
      setPreview(null);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    setSmoothFocus(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, pointer);

    if (pointers.current.size === 1) {
      const element = event.target as HTMLElement;
      const markerId = element.closest<HTMLElement>("[data-site-id]")?.dataset.siteId;
      const centerId = element.closest<HTMLElement>("[data-project-center]")?.dataset.projectCenter;
      const markerTarget = markerId
        ? projectSites.find(item => item.site.id === markerId)?.target ?? null
        : centerId ? { projectId: centerId } : null;
      const explore = !!exploreArea && !!element.closest("[data-explore-drag]");
      const rect = map.current?.getBoundingClientRect();
      const center = explorePreview ?? exploreMarker;
      gesture.current = {
        start: pointer, last: pointer, moved: false, pinch: false, distance: 0, marker: markerTarget,
        explore,
        exploreOffset: explore && rect && center
          ? { x: pointer.x - (rect.left + center.u * rect.width), y: pointer.y - (rect.top + center.v * rect.height) }
          : { x: 0, y: 0 },
      };
    } else if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = true;
      gesture.current.distance = Math.hypot(a.x - b.x, a.y - b.y);
      setPreview(null);
      setExplorePreview(null);
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

    if (gesture.current.explore) {
      const location = constrainedPoint(now.x - gesture.current.exploreOffset.x,
        now.y - gesture.current.exploreOffset.y);
      if (location) setExplorePreview({ u: location.u, v: location.v });
    } else if (gesture.current.marker && (!gesture.current.marker.siteId || unlockedSiteIds.includes(gesture.current.marker.siteId))) {
      const location = withinSearchRadius(constrainedPoint(now.x, now.y), gesture.current.marker);
      const id = gesture.current.marker.siteId ?? `center:${gesture.current.marker.projectId}`;
      if (location) setPreview({ id, u: location.u, v: location.v });
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

    if (current.explore && current.moved) {
      const location = constrainedPoint(event.clientX - current.exploreOffset.x,
        event.clientY - current.exploreOffset.y);
      if (location) void coordinateAt(location.x, location.y)
        .then(coords => onMoveExploreArea(coords.latitude, coords.longitude))
        .catch(() => setError("Could not move the search area."))
        .finally(() => setExplorePreview(null));
      else setExplorePreview(null);
      return;
    }

    if (probeMode && !current.moved) {
      const location = normalizedPoint(event.clientX, event.clientY);
      if (location) void coordinateAt(location.x, location.y)
        .then(onProbePoint).catch(() => setError("Could not inspect this point."));
      return;
    }
    if (probeMode) return;
    if (exploreArea) {
      if (!current.moved && !current.explore) {
        const location = normalizedPoint(event.clientX, event.clientY);
        if (location) void coordinateAt(location.x, location.y)
          .then(coords => onMoveExploreArea(coords.latitude, coords.longitude))
          .catch(() => setError("Could not move the search area."));
      }
      return;
    }

    if (current.marker && current.moved && (!current.marker.siteId || unlockedSiteIds.includes(current.marker.siteId))) {
      const location = withinSearchRadius(constrainedPoint(event.clientX, event.clientY), current.marker);
      onSelectSite(current.marker);
      void place(current.marker, location);
    } else if (current.marker && !current.moved) {
      const active = current.marker.projectId === selected?.projectId && current.marker.siteId === selected?.siteId;
      onSelectSite(active ? null : current.marker);
    } else if (!current.moved && !current.marker && selected && !selectedLocked) {
      void place(selected, withinSearchRadius(normalizedPoint(event.clientX, event.clientY), selected));
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    changeZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function focusLandmark(id: string) {
    if (!side) return;
    const marker = landmarkPositions.get(id);
    if (!marker) return;
    const targetX = dimensions.width >= 640 ? dimensions.width * 0.7 : dimensions.width / 2;
    const targetY = dimensions.width < 640 ? dimensions.height * 0.25 : dimensions.height / 2;
    const neededX = Math.max(targetX / (side * marker.u), (dimensions.width - targetX) / (side * (1 - marker.u)));
    const neededY = Math.max(targetY / (side * marker.v), (dimensions.height - targetY) / (side * (1 - marker.v)));
    const nextZoom = clamp(Math.max(zoom, 2.5, neededX, neededY), 1, 10);
    setSmoothFocus(true);
    setZoom(nextZoom);
    setOffset(limitedOffset({ x: targetX - dimensions.width / 2 + (0.5 - marker.u) * side * nextZoom,
      y: targetY - dimensions.height / 2 + (0.5 - marker.v) * side * nextZoom }, nextZoom));
  }

  function tourLandmark(delta: number) {
    if (activeLandmarkIndex < 0 || !landmarks.length) return;
    const next = landmarks[(activeLandmarkIndex + delta + landmarks.length) % landmarks.length];
    setActiveLandmarkId(next.id);
    setLandmarkCardOpen(true);
    focusLandmark(next.id);
  }

  function closeLandmarkCard() {
    if (document.activeElement?.closest(".orbis-landmark-card")) {
      const marker = [...(map.current?.querySelectorAll<HTMLButtonElement>("[data-landmark-id]") ?? [])]
        .find(button => button.dataset.landmarkId === activeLandmarkId);
      const toggle = viewport.current?.parentElement?.querySelector<HTMLButtonElement>('[aria-label="Toggle lunar landmarks"]');
      (marker ?? toggle)?.focus({ preventScroll: true });
    }
    setLandmarkCardOpen(false);
  }

  const ring = info ? {
    cx: (info.pole.x - info.bounds.left) / (info.bounds.right - info.bounds.left) * 100,
    cy: (info.bounds.top - info.pole.y) / (info.bounds.top - info.bounds.bottom) * 100,
    rx: info.radius / (info.bounds.right - info.bounds.left) * 100,
    ry: info.radius / (info.bounds.top - info.bounds.bottom) * 100,
  } : null;

  return (
    <div className="@container relative h-full w-full overflow-hidden bg-[#191919] text-[#ddd]">
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
          setExplorePreview(null);
        }}
      >
        {info && side > 0 ? (
          <div
            ref={map}
            className="absolute left-1/2 top-1/2 select-none"
            onTransitionEnd={event => {
              if (event.target === event.currentTarget && event.propertyName === "transform") setSmoothFocus(false);
            }}
            style={{
              width: side, height: side,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transition: smoothFocus ? "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
            }}
          >
            <img src="/api/terrain/preview/hillshade?v=4" draggable={false} alt="NASA south-pole hillshade"
              className="pointer-events-none absolute inset-0 h-full w-full"
              onError={() => setError("Could not display terrain image.")} />
            {shadows && (
              <img src="/api/terrain/preview/shadows?v=4" draggable={false} alt="Permanently shadowed areas"
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
            {exploreArea && exploreMarker && info && <div className="pointer-events-none absolute z-[6] rounded-full border-2 border-dashed border-white/90 bg-white/[0.08] shadow-[0_0_0_1px_#111,0_0_18px_#fff5]"
              style={{ left: `${(explorePreview?.u ?? exploreMarker.u) * 100}%`, top: `${(explorePreview?.v ?? exploreMarker.v) * 100}%`,
                width: `${exploreArea.radius_m / (info.bounds.right - info.bounds.left) * 200}%`,
                height: `${exploreArea.radius_m / (info.bounds.top - info.bounds.bottom) * 200}%`,
                transform: "translate(-50%, -50%)" }}>
                <div data-explore-drag className="pointer-events-auto absolute inset-0 cursor-grab rounded-full border-[12px] border-transparent [clip-path:circle(50%)] active:cursor-grabbing"
                  title="Drag the ring to move the Explore area" aria-label="Drag the search area" />
              </div>}
            {exploreArea && exploreMarker && <button type="button" data-explore-drag
              className="absolute z-[12] flex h-9 w-9 cursor-grab items-center justify-center active:cursor-grabbing"
              style={{ left: `${(explorePreview?.u ?? exploreMarker.u) * 100}%`, top: `${(explorePreview?.v ?? exploreMarker.v) * 100}%`,
                transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
              aria-label="Drag Explore search center" title="Drag to move Explore area">
              <span className="pointer-events-none h-4 w-4 rounded-full border-2 border-[#17191b] bg-white shadow-[0_0_0_2px_#fff,0_2px_8px_#000]" />
            </button>}
            {info && visibleProjects.map(project => {
              const id = `center:${project.id}`;
              const marker = markers.find(item => item.id === id);
              const position = preview?.id === id ? preview : marker;
              if (!position) return null;
              const radiusX = (project.radius_m / (info.bounds.right - info.bounds.left)) * 100;
              const radiusY = (project.radius_m / (info.bounds.top - info.bounds.bottom)) * 100;
              const active = selected?.projectId === project.id && !selected.siteId;
              return (
                <div key={id}>
                  <div className="pointer-events-none absolute rounded-full border border-dashed"
                    title={`${project.name} search radius: ${project.radius_m} m`}
                    style={{
                      left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                      width: `${radiusX * 2}%`, height: `${radiusY * 2}%`,
                      transform: "translate(-50%, -50%)", borderColor: project.color,
                      backgroundColor: `${project.color}20`,
                    }} />
                  <button key={project.id} type="button" data-project-center={project.id}
                    aria-label={`Move or select ${project.name} search center`}
                    title={`${project.name}: search center; drag to move; radius ${project.radius_m} m`}
                    className="absolute z-10 flex h-7 w-7 cursor-grab items-center justify-center active:cursor-grabbing"
                    style={{ left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                      transform: `translate(-50%, -50%) scale(${1 / zoom})` }}>
                    <span className="pointer-events-none flex h-4 w-4 items-center justify-center rounded-full border-2 border-white"
                      style={{ backgroundColor: project.color,
                        boxShadow: active ? `0 0 0 4px ${project.color}55` : "none" }}>
                      <span className="h-1 w-1 rounded-full bg-white" />
                    </span>
                  </button>
                </div>
              );
            })}
            {regions && info && (regions.projectId === null || !hiddenProjectIds.includes(regions.projectId)) && regions.grid.map((cell, index) => {
                const id = `grid:${index}`;
                const position = regionPositions.get(id);
                if (!position) return null;
                const color = cell.band === "green" ? "96,186,123" : cell.band === "yellow" ? "255,153,0" : "218,0,4";
                const opacity = cell.status === "recommended" ? 0.55 : cell.status === "evaluated" ? 0.32 : 0.27;
                return <div key={id} className="pointer-events-none absolute z-[5]"
                  style={{ left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                    width: `${regions.spacing / (info.bounds.right - info.bounds.left) * 100}%`,
                    height: `${regions.spacing / (info.bounds.top - info.bounds.bottom) * 100}%`,
                    transform: "translate(-50%, -50%)",
                    backgroundColor: cell.status === "no_data" || cell.status === "slope_unchecked" ? "rgba(135,145,153,0.3)" : `rgba(${color},${opacity})`,
                    outline: cell.status === "recommended" ? `1px solid rgba(${color},0.8)` : "none" }} />;
              })}
            {landmarksEnabled && landmarksVisible && landmarks.map(landmark => {
              const position = landmarkPositions.get(landmark.id);
              if (!position) return null;
              const active = activeLandmarkId === landmark.id;
              return <div key={landmark.id}>
                {info && landmark.diameter_km && <div aria-hidden="true"
                  className={`pointer-events-none absolute z-[7] rounded-full border bg-[#e78bb6]/[0.08] ${active ? "border-2 border-[#ffd1e2]" : "border-[#e78bb6]/80"}`}
                  style={{ left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                    width: `${landmark.diameter_km * 1000 / (info.bounds.right - info.bounds.left) * 100}%`,
                    height: `${landmark.diameter_km * 1000 / (info.bounds.top - info.bounds.bottom) * 100}%`,
                    transform: "translate(-50%, -50%)" }} />}
                <button type="button" data-landmark-id={landmark.id} aria-label={`Open ${landmark.name} landmark`}
                  aria-pressed={active} title={landmark.name}
                  onPointerDown={event => event.stopPropagation()}
                  onPointerUp={event => event.stopPropagation()}
                  onClick={event => { event.stopPropagation(); setActiveLandmarkId(landmark.id); setLandmarkCardOpen(true); focusLandmark(landmark.id); }}
                  className="absolute z-[8] flex h-7 w-7 items-center justify-center"
                  style={{ left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                    transform: `translate(-50%, -50%) scale(${1 / zoom})` }}>
                  <span className={`pointer-events-none h-2.5 w-2.5 rounded-full border-2 border-[#e78bb6] bg-[#301b29] ${active ? "outline outline-2 outline-offset-2 outline-white" : ""}`} />
                </button>
              </div>;
            })}
            {probeMarker && <span className="pointer-events-none absolute z-[12] h-4 w-4 rounded-full border-2 border-white bg-[#03ace4] shadow-[0_0_0_3px_#03ace477]"
              style={{ left: `${probeMarker.u * 100}%`, top: `${probeMarker.v * 100}%`,
                transform: `translate(-50%, -50%) scale(${1 / zoom})` }} />}
            {projectSites.map(({ target, site, color }) => {
              const marker = markers.find(item => item.id === site.id);
              const position = preview?.id === site.id ? preview : marker;
              if (!position) return null;
              const active = target.projectId === selected?.projectId && site.id === selected.siteId;
              return (
                <button
                  key={site.id}
                  type="button"
                  data-site-id={site.id}
                  aria-label={`${unlockedSiteIds.includes(site.id) ? "Move or select" : "Select"} ${site.name}`}
                  title={`${site.name}: ${unlockedSiteIds.includes(site.id) ? "drag to move" : "locked; unlock in Browse to move"}`}
                  className={`absolute z-10 flex h-7 w-7 items-center justify-center ${unlockedSiteIds.includes(site.id) ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                  style={{
                    left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                    transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  }}
                >
                  <span className="pointer-events-none h-3.5 w-3.5 rounded-full border-2 border-white"
                    style={{ backgroundColor: color,
                      boxShadow: active ? `0 0 0 4px ${color}66` : "none" }} />
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

      <div className="pointer-events-none absolute left-3 top-3 z-20 hidden bg-[#242424]/95 px-3 py-2 text-[11px] @min-[640px]:block">
        LUNAR SOUTH POLE <span className="ml-1 text-[#aaa]">80°S–90°S</span>
      </div>
      <div className="absolute right-2 top-2 z-20 flex max-w-[calc(100%-16px)] flex-col items-start gap-1 sm:right-3 sm:top-3 sm:max-w-[calc(100%-24px)]">
        <div className="flex max-w-full items-center gap-0.5 bg-[#242424]/95 p-1 sm:gap-1">
          <button className={`flex h-8 shrink-0 items-center gap-1 px-2 text-xs ${shadows ? "bg-[#444] text-accent" : "text-[#aaa]"}`}
            type="button" aria-label="Toggle permanent shadows" aria-pressed={shadows}
            onClick={() => setShadows(!shadows)}><Layers size={15} /> PSR</button>
          {landmarksEnabled && <button className={`flex h-8 shrink-0 items-center gap-1 px-2 text-xs ${landmarksVisible ? "bg-[#444] text-[#f0a5c7]" : "text-[#aaa]"}`}
            type="button" aria-label="Toggle lunar landmarks" aria-pressed={landmarksVisible}
            onClick={() => { setLandmarksVisible(current => !current); setActiveLandmarkId(null); setLandmarkCardOpen(false); }}><MapPin size={15} /> Landmarks</button>}
          <button type="button" title="Zoom in" aria-label="Zoom in" className="shrink-0 p-2 hover:bg-[#444]" onClick={() => changeZoom(1.5)}><Plus size={15} /></button>
          <button type="button" title="Zoom out" aria-label="Zoom out" className="shrink-0 p-2 hover:bg-[#444]" onClick={() => changeZoom(1 / 1.5)}><Minus size={15} /></button>
          <button type="button" title="Reset view" aria-label="Reset view" className="shrink-0 p-2 hover:bg-[#444]" onClick={reset}><LocateFixed size={15} /></button>
        </div>
        {shadows && <div className="orbis-overlay-enter self-end bg-[#242424]/95 px-2 py-1 text-[10px] sm:text-[11px]">
          <span className="mr-2 inline-block h-2 w-2 bg-accent" />Permanently shadowed regions
        </div>}
        {landmarksEnabled && landmarksVisible && landmarkError && <div role="alert" className="bg-[#292929] px-2 py-1 text-xs text-[#ef9292]">{landmarkError}</div>}
      </div>
      {landmarksEnabled && landmarksVisible && activeLandmark && <LandmarkCard landmark={activeLandmark}
        open={landmarkCardOpen}
        index={activeLandmarkIndex} total={landmarks.length}
        onPrevious={() => tourLandmark(-1)} onNext={() => tourLandmark(1)}
        onClose={closeLandmarkCard} />}
      {!hintDismissed && <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-20 flex max-w-full items-center gap-2 bg-[#242424]/95 p-2 font-mono text-[10px] sm:bottom-3 sm:left-3 sm:right-auto sm:text-[11px]">
        <div className="min-w-0 flex-1 truncate">
          {probeMode ? <span>Tap terrain to inspect a point</span> : exploreArea ? <span>Tap terrain or drag the white circle to move the search area</span> : point ? <><div>LAT {point.latitude.toFixed(5)}°</div><div>LON {point.longitude.toFixed(5)}°</div></> :
            <span className="text-[#aaa]">{selectedLocked ? "Unlock site in Browse to move it" : selected?.siteId ? "Click terrain to move selected site" : selected ? "Click terrain to move search center" : "Select a site or project center"}</span>}
        </div>
        <button type="button" onClick={dismissHint} aria-label="Dismiss map hint permanently" title="Hide map hint in this browser"
          className="pointer-events-auto shrink-0 p-1 text-[#aaa] hover:text-white"><X size={14} /></button>
      </div>}
      <div className="pointer-events-none absolute bottom-3 right-3 z-20 hidden bg-[#242424]/95 px-2 py-1 text-[10px] text-[#aaa] sm:block">
        {probeMode ? exploreArea ? "Click terrain to set search center" : "Click terrain to inspect a point" : saving ? "Saving..." : `${Math.round(zoom * 100)}% · LOLA`}
      </div>
      {error && info && <div className="pointer-events-none absolute bottom-14 left-3 z-20 bg-[#292929] px-3 py-2 text-xs text-[#ef9292]">{error}</div>}
    </div>
  );
}
