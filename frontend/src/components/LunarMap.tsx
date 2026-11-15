import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Check, Layers, LocateFixed, MapPin, Minus, Moon, Plus, X, ChartNoAxesCombined, Mountain } from "lucide-react";
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
type FocusRequest = { latitude: number; longitude: number; revision: number } | null;
type Props = {
  landmarksEnabled: boolean;
  projects: Project[];
  hiddenProjectIds: string[];
  unlockedSiteIds: string[];
  selected: Target | null;
  regions: { projectId: string | null; areas: SearchRegion[]; grid: SearchGridCell[]; spacing: number } | null;
  exploreArea: { latitude: number; longitude: number; radius_m: number } | null;
  probePoint: { latitude: number; longitude: number } | null;
  onOpenProbe: () => void;
  focusRequest: FocusRequest;
  probeMode: boolean;
  onProbePoint: (point: { latitude: number; longitude: number }) => void;
  onSelectSite: (target: Target | null) => void;
  onMoveSite: (target: Target, latitude: number, longitude: number) => Promise<void>;
  onMoveProjectCenter: (projectId: string, latitude: number, longitude: number) => Promise<void>;
  onResizeProject: (projectId: string, radius: number) => Promise<void>;
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
  markerOffset: Pointer;
  radiusProjectId: string | null;
  radiusStartDistance: number;
  explore: boolean;
  exploreOffset: Pointer;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const MAP_HINT_KEY = "orbis-map-hint-dismissed-v1";

export default function LunarMap({ landmarksEnabled, projects, hiddenProjectIds, unlockedSiteIds, selected, regions, exploreArea, probePoint, onOpenProbe, focusRequest, probeMode, onProbePoint, onSelectSite, onMoveSite, onMoveProjectCenter, onResizeProject, onMoveExploreArea }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const map = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef<Gesture | null>(null);
  const landmarkHoverTimer = useRef<number | null>(null);
  const hoverSampleAt = useRef(0);
  const hoverRequestId = useRef(0);

  const [info, setInfo] = useState<Info | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [regionMarkers, setRegionMarkers] = useState<Marker[]>([]);
  const [probeMarker, setProbeMarker] = useState<Marker | null>(null);
  const [exploreMarker, setExploreMarker] = useState<Marker | null>(null);
  const [preview, setPreview] = useState<{ id: string; u: number; v: number } | null>(null);
  const [radiusPreview, setRadiusPreview] = useState<{ id: string; radius: number } | null>(null);
  const [explorePreview, setExplorePreview] = useState<{ u: number; v: number } | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [shadows, setShadows] = useState(false);
  const [contours, setContours] = useState(false);
  const [slope, setSlope] = useState(false);
  const [landmarksVisible, setLandmarksVisible] = useState(false);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [landmarkMarkers, setLandmarkMarkers] = useState<Marker[]>([]);
  const [activeLandmarkId, setActiveLandmarkId] = useState<string | null>(null);
  const [hoveredLandmarkId, setHoveredLandmarkId] = useState<string | null>(null);
  const [landmarkCardOpen, setLandmarkCardOpen] = useState(false);
  const [landmarkPinned, setLandmarkPinned] = useState(false);
  const [landmarkError, setLandmarkError] = useState("");
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [hoverCoordinates, setHoverCoordinates] = useState<string | null>(null);
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
  const projectLocked = (projectId: string) =>
    !!projects.find(project => project.id === projectId)?.sites.some(site => !unlockedSiteIds.includes(site.id));
  const selectedLocked = !!selected && (selected.siteId
    ? !unlockedSiteIds.includes(selected.siteId) : projectLocked(selected.projectId));
  const side = Math.min(dimensions.width, dimensions.height) * 0.9;
  const regionPositions = new Map(regionMarkers.map(marker => [marker.id, marker]));
  const candidateAreasVisible = !!regions?.grid.length && (regions.projectId === null || !hiddenProjectIds.includes(regions.projectId));
  const landmarkPositions = new Map(landmarkMarkers.map(marker => [marker.id, marker]));
  const activeLandmarkIndex = landmarks.findIndex(landmark => landmark.id === activeLandmarkId);
  const activeLandmark = activeLandmarkIndex >= 0 ? landmarks[activeLandmarkIndex] : null;
  const focusTarget = (probePoint && probeMarker)
    || (landmarksEnabled && landmarkCardOpen && activeLandmark && landmarkPositions.get(activeLandmark.id))
    || (exploreArea && exploreMarker)
    || (selected && !hiddenProjectIds.includes(selected.projectId)
      && markers.find(marker => marker.id === (selected.siteId ?? `center:${selected.projectId}`)))
    || null;

  useEffect(() => {
    if (!landmarksEnabled) {
      if (landmarkHoverTimer.current !== null) window.clearTimeout(landmarkHoverTimer.current);
      setLandmarkCardOpen(false);
      setActiveLandmarkId(null);
      setHoveredLandmarkId(null);
      setLandmarkPinned(false);
    }
  }, [landmarksEnabled]);

  useEffect(() => () => {
    if (landmarkHoverTimer.current !== null) window.clearTimeout(landmarkHoverTimer.current);
  }, []);

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
    if (!focusRequest || !info || !dimensions.width || !dimensions.height) return;
    const controller = new AbortController();
    fetch("/api/terrain/project", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify([{ id: "focus", latitude: focusRequest.latitude, longitude: focusRequest.longitude }]),
    }).then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Marker[]>; })
      .then(result => {
        if (controller.signal.aborted || !result[0]) return;
        focusMarker(result[0], Math.max(zoom, 3));
      })
      .catch(() => { if (!controller.signal.aborted) setError("Could not center this location."); });
    return () => controller.abort();
  }, [focusRequest?.revision, info, dimensions.width, dimensions.height]);

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

  function focusMarker(marker: Marker, nextZoom: number) {
    setSmoothFocus(true);
    setZoom(nextZoom);
    setOffset(limitedOffset({ x: (0.5 - marker.u) * side * nextZoom,
      y: (0.5 - marker.v) * side * nextZoom }, nextZoom));
  }

  function zoomToSelection() {
    if (!focusTarget) return;
    focusMarker(focusTarget, clamp(Math.max(zoom * 1.5, 3), 1, 10));
  }

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

  function withinProjectSites(position: ReturnType<typeof constrainedPoint>, target: Target | null) {
    if (!position || !target || target.siteId || !info) return position;
    const project = projects.find(item => item.id === target.projectId);
    if (!project || projectLocked(project.id)) return null;
    const width = info.bounds.right - info.bounds.left;
    const height = info.bounds.top - info.bounds.bottom;
    let { u, v } = position;
    for (let pass = 0; pass < 8; pass++) {
      for (const site of project.sites) {
        const marker = markers.find(item => item.id === site.id);
        if (!marker) continue;
        const dx = (u - marker.u) * width;
        const dy = (v - marker.v) * height;
        const distance = Math.hypot(dx, dy);
        if (distance > project.radius_m * 0.97) {
          const ratio = project.radius_m * 0.97 / distance;
          u = marker.u + dx * ratio / width;
          v = marker.v + dy * ratio / height;
        }
      }
    }
    return { x: info.bounds.left + u * width, y: info.bounds.top - v * height, u, v };
  }

  function minimumProjectRadius(project: Project) {
    if (!info) return 50;
    const center = markers.find(item => item.id === `center:${project.id}`);
    if (!center) return 50;
    const width = info.bounds.right - info.bounds.left;
    const height = info.bounds.top - info.bounds.bottom;
    return Math.max(50, ...project.sites.map(site => {
      const marker = markers.find(item => item.id === site.id);
      return marker ? Math.ceil(Math.hypot((marker.u - center.u) * width,
        (marker.v - center.v) * height) * 1.03) : 50;
    }));
  }

  function distanceFromProjectCenter(clientX: number, clientY: number, projectId: string) {
    const center = markers.find(item => item.id === `center:${projectId}`);
    const rect = map.current?.getBoundingClientRect();
    if (!center || !rect || !info) return 0;
    const x = rect.left + center.u * rect.width;
    const y = rect.top + center.v * rect.height;
    return Math.hypot((clientX - x) / rect.width * (info.bounds.right - info.bounds.left),
      (clientY - y) / rect.height * (info.bounds.top - info.bounds.bottom));
  }

  async function coordinateAt(x: number, y: number) {
    const response = await fetch(`/api/terrain/coordinates?x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}`);
    if (!response.ok) throw new Error("Invalid lunar location");
    return response.json() as Promise<{ latitude: number; longitude: number }>;
  }

  function updateHoverCoordinates(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || pointers.current.has(event.pointerId)) return;
    const position = normalizedPoint(event.clientX, event.clientY);
    if (!position) {
      hoverRequestId.current++;
      setHoverCoordinates(null);
      return;
    }
    const now = performance.now();
    if (now - hoverSampleAt.current < 150) return;
    hoverSampleAt.current = now;
    const requestId = ++hoverRequestId.current;
    void coordinateAt(position.x, position.y).then(({ latitude, longitude }) => {
      if (requestId === hoverRequestId.current) {
        setHoverCoordinates(`${Math.abs(latitude).toFixed(4)}°${latitude < 0 ? "S" : "N"} · ${Math.abs(longitude).toFixed(4)}°${longitude < 0 ? "W" : "E"}`);
      }
    }).catch(() => { if (requestId === hoverRequestId.current) setHoverCoordinates(null); });
  }

  async function place(target: Target | null, position: ReturnType<typeof normalizedPoint>) {
    if (!position || (target?.siteId ? !unlockedSiteIds.includes(target.siteId)
      : target ? projectLocked(target.projectId) : false)) return;
    setSaving(true);
    setError("");
    try {
      const coords = await coordinateAt(position.x, position.y);
      setPoint({ ...coords, u: position.u, v: position.v });
      if (target?.siteId) await onMoveSite(target, coords.latitude, coords.longitude);
      else if (target) await onMoveProjectCenter(target.projectId, coords.latitude, coords.longitude);
    } catch {
      setError(target?.siteId ? "Could not save landing-site location." : "Could not move the search region.");
    } finally {
      setSaving(false);
      setPreview(null);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    hoverRequestId.current++;
    setHoverCoordinates(null);
    setLayerPanelOpen(false);
    setSmoothFocus(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, pointer);

    if (pointers.current.size === 1) {
      const element = event.target as HTMLElement;
      const markerId = element.closest<HTMLElement>("[data-site-id]")?.dataset.siteId;
      const centerId = element.closest<HTMLElement>("[data-project-center]")?.dataset.projectCenter;
      const circleId = element.closest<HTMLElement>("[data-project-drag]")?.dataset.projectDrag;
      const radiusProjectId = element.closest<HTMLElement>("[data-project-radius]")?.dataset.projectRadius ?? null;
      const markerTarget = markerId
        ? projectSites.find(item => item.site.id === markerId)?.target ?? null
        : centerId ? { projectId: centerId } : circleId ? { projectId: circleId } : null;
      const explore = !!exploreArea && !!element.closest("[data-explore-drag]");
      const rect = map.current?.getBoundingClientRect();
      const center = explorePreview ?? exploreMarker;
      const projectCenter = circleId ? markers.find(item => item.id === `center:${circleId}`) : null;
      gesture.current = {
        start: pointer, last: pointer, moved: false, pinch: false, distance: 0, marker: markerTarget,
        markerOffset: circleId && rect && projectCenter
          ? { x: pointer.x - (rect.left + projectCenter.u * rect.width), y: pointer.y - (rect.top + projectCenter.v * rect.height) }
          : { x: 0, y: 0 },
        radiusProjectId,
        radiusStartDistance: radiusProjectId ? distanceFromProjectCenter(pointer.x, pointer.y, radiusProjectId) : 0,
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
      setRadiusPreview(null);
      setExplorePreview(null);
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    updateHoverCoordinates(event);
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

    if (gesture.current.radiusProjectId) {
      const project = projects.find(item => item.id === gesture.current?.radiusProjectId);
      if (project && !projectLocked(project.id)) {
        const distance = distanceFromProjectCenter(now.x, now.y, project.id);
        setRadiusPreview({ id: project.id, radius: Math.round(clamp(
          project.radius_m + distance - gesture.current.radiusStartDistance,
          minimumProjectRadius(project), 20000)) });
      }
    } else if (gesture.current.explore) {
      const location = constrainedPoint(now.x - gesture.current.exploreOffset.x,
        now.y - gesture.current.exploreOffset.y);
      if (location) setExplorePreview({ u: location.u, v: location.v });
    } else if (gesture.current.marker && (gesture.current.marker.siteId
      ? unlockedSiteIds.includes(gesture.current.marker.siteId)
      : !projectLocked(gesture.current.marker.projectId))) {
      const target = gesture.current.marker;
      const point = constrainedPoint(now.x - gesture.current.markerOffset.x,
        now.y - gesture.current.markerOffset.y);
      const location = target.siteId ? withinSearchRadius(point, target) : withinProjectSites(point, target);
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

    if (current.radiusProjectId) {
      const project = projects.find(item => item.id === current.radiusProjectId);
      const radius = project ? Math.round(clamp(project.radius_m +
        distanceFromProjectCenter(event.clientX, event.clientY, project.id) - current.radiusStartDistance,
        minimumProjectRadius(project), 20000)) : null;
      if (current.moved && project && !projectLocked(project.id) && radius !== null && radius !== project.radius_m) {
        setSaving(true);
        setError("");
        void onResizeProject(project.id, radius)
          .catch(() => setError("Could not resize the search region."))
          .finally(() => { setSaving(false); setRadiusPreview(null); });
      } else setRadiusPreview(null);
      return;
    }

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

    if (current.marker && current.moved && (current.marker.siteId
      ? unlockedSiteIds.includes(current.marker.siteId) : !projectLocked(current.marker.projectId))) {
      const point = constrainedPoint(event.clientX - current.markerOffset.x,
        event.clientY - current.markerOffset.y);
      const location = current.marker.siteId ? withinSearchRadius(point, current.marker)
        : withinProjectSites(point, current.marker);
      onSelectSite(current.marker);
      if (location) void place(current.marker, location);
    } else if (current.marker && !current.moved) {
      const active = current.marker.projectId === selected?.projectId && current.marker.siteId === selected?.siteId;
      if (!current.markerOffset.x && !current.markerOffset.y) onSelectSite(active ? null : current.marker);
    } else if (!current.moved && !current.marker && !probePoint && selected && !selectedLocked) {
      const point = normalizedPoint(event.clientX, event.clientY);
      void place(selected, selected.siteId ? withinSearchRadius(point, selected)
        : withinProjectSites(point, selected));
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
    clearLandmarkHoverTimer();
    setLandmarkPinned(true);
    setActiveLandmarkId(next.id);
    setLandmarkCardOpen(true);
    focusLandmark(next.id);
  }

  function clearLandmarkHoverTimer() {
    if (landmarkHoverTimer.current !== null) window.clearTimeout(landmarkHoverTimer.current);
    landmarkHoverTimer.current = null;
  }

  function previewLandmark(id: string) {
    if (landmarkPinned) return;
    clearLandmarkHoverTimer();
    setActiveLandmarkId(id);
    setLandmarkCardOpen(true);
  }

  function scheduleLandmarkHoverClose() {
    if (landmarkPinned) return;
    clearLandmarkHoverTimer();
    landmarkHoverTimer.current = window.setTimeout(() => closeLandmarkCard(), 450);
  }

  function closeLandmarkCard() {
    clearLandmarkHoverTimer();
    if (document.activeElement?.closest(".orbis-landmark-card")) {
      const marker = [...(map.current?.querySelectorAll<HTMLButtonElement>("[data-landmark-id]") ?? [])]
        .find(button => button.dataset.landmarkId === activeLandmarkId);
      const toggle = viewport.current?.parentElement?.querySelector<HTMLButtonElement>('[aria-label="Toggle lunar landmarks"]');
      (marker ?? toggle)?.focus({ preventScroll: true });
    }
    setLandmarkPinned(false);
    setLandmarkCardOpen(false);
  }

  const ring = info ? {
    cx: (info.pole.x - info.bounds.left) / (info.bounds.right - info.bounds.left) * 100,
    cy: (info.bounds.top - info.pole.y) / (info.bounds.top - info.bounds.bottom) * 100,
    rx: info.radius / (info.bounds.right - info.bounds.left) * 100,
    ry: info.radius / (info.bounds.top - info.bounds.bottom) * 100,
  } : null;
  const latitudeRingRatio = (degreesFromPole: number) =>
    Math.tan(degreesFromPole * Math.PI / 360) / Math.tan(10 * Math.PI / 360);

  return (
    <div className="@container relative h-full w-full overflow-hidden bg-[#191919] text-[#ddd]">
      <div
        ref={viewport}
        className="absolute inset-0 overflow-hidden"
        style={{ touchAction: "none" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => { hoverRequestId.current++; setHoverCoordinates(null); }}
        onPointerUp={handlePointerUp}
        onPointerCancel={event => {
          pointers.current.delete(event.pointerId);
          gesture.current = null;
          setPreview(null);
          setRadiusPreview(null);
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
            {slope && <img src="/api/terrain/preview/slope?v=2" draggable={false} alt="Slope across the south pole from LOLA elevation and slope rasters"
              className="pointer-events-none absolute inset-0 h-full w-full" onError={() => setError("Could not display slope layer.")} />}
            {contours && <img src="/api/terrain/preview/contours?v=1" draggable={false} alt="LOLA elevation contours"
              className="pointer-events-none absolute inset-0 h-full w-full" onError={() => setError("Could not display contour layer.")} />}
            {shadows && (
              <img src="/api/terrain/preview/shadows?v=4" draggable={false} alt="Permanently shadowed areas"
                className="pointer-events-none absolute inset-0 h-full w-full" />
            )}
            {ring && (
              <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry}
                  fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="0.12" />
                {([85, 87] as const).map(latitude => {
                  const ratio = latitudeRingRatio(90 - latitude);
                  return <g key={latitude}>
                    <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx * ratio} ry={ring.ry * ratio}
                      fill="none" stroke="white" strokeOpacity="0.28" strokeDasharray="0.65 0.65" strokeWidth="0.1" />
                    <text x={ring.cx + ring.rx * ratio - 0.8} y={ring.cy - 0.9}
                      fill="white" fillOpacity="0.65" fontSize="1.4" textAnchor="end">{latitude}°S</text>
                  </g>;
                })}
                <circle cx={ring.cx} cy={ring.cy} r="0.42" fill="white" />
                <text x={ring.cx + 1.2} y={ring.cy - 1.2} fill="white" fillOpacity="0.8" fontSize="1.5">90°S</text>
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
              const radius = radiusPreview?.id === project.id ? radiusPreview.radius : project.radius_m;
              const active = selected?.projectId === project.id;
              const locked = projectLocked(project.id);
              const visualRadius = Math.max(radius / (info.bounds.right - info.bounds.left) * side,
                (active ? 24 : 8) / zoom);
              return (
                <div key={id}>
                  <button type="button" data-project-drag={active && !locked ? project.id : undefined}
                    tabIndex={active && !locked ? 0 : -1}
                    aria-label={`${project.name} search region, ${Math.round(radius)} metres; ${locked ? "unlock its sites to edit" : active ? "drag to move" : "select the center to edit"}`}
                    onClick={event => { event.stopPropagation(); onSelectSite({ projectId: project.id }); }}
                    className={`absolute z-[7] rounded-full border border-dashed ${active && !locked ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
                    title={`${project.name} search radius: ${Math.round(radius)} m${locked ? "; unlock its landing sites to edit" : active ? "; drag circle to move; use handle to resize" : ""}`}
                    style={{
                      left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                      width: visualRadius * 2, height: visualRadius * 2,
                      transform: "translate(-50%, -50%)", borderColor: project.color,
                      backgroundColor: `${project.color}${active ? "26" : "14"}`,
                    }} />
                  <button key={project.id} type="button" data-project-center={project.id}
                    aria-label={`${locked ? "Select" : "Move or select"} ${project.name} search center`}
                    title={`${project.name}: search center; ${locked ? "unlock landing sites to move" : "drag to move"}; radius ${project.radius_m} m`}
                    className={`absolute z-10 flex h-7 w-7 items-center justify-center ${locked ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
                    style={{ left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                      transform: `translate(-50%, -50%) scale(${1 / zoom})` }}>
                    <Plus size={active ? 15 : 13} strokeWidth={2.5} className="pointer-events-none drop-shadow-[0_1px_2px_#000]"
                      style={{ color: project.color }} />
                  </button>
                  {active && <button type="button" data-project-radius={locked ? undefined : project.id}
                    disabled={locked}
                    aria-label={`Resize ${project.name} search radius, currently ${Math.round(radius)} metres`}
                    title={locked ? "Unlock all landing sites to resize this search region" : `Drag to resize search radius · ${Math.round(radius)} m`}
                    className="absolute z-[11] flex h-8 w-8 items-center justify-center disabled:cursor-not-allowed enabled:cursor-ew-resize"
                    style={{ left: `calc(${position.u * 100}% + ${visualRadius}px)`, top: `${position.v * 100}%`,
                      transform: `translate(-50%, -50%) scale(${1 / zoom})` }}>
                    <span className={`pointer-events-none h-3 w-3 rounded-full border-2 border-[#242424] shadow-[0_0_0_1px_#fff] ${locked ? "bg-[#aeb8bd]" : "bg-white"}`} />
                  </button>}
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
              const highlighted = hoveredLandmarkId === landmark.id || active && landmarkCardOpen;
              return <div key={landmark.id}>
                {info && landmark.diameter_km && <div aria-hidden="true"
                  className={`pointer-events-none absolute z-[7] rounded-full border transition-[background-color,border-color,border-width] duration-300 ease-in-out ${highlighted ? "border-2 border-[#ffd1e2] bg-[#e78bb6]/[0.24]" : "border-[#e78bb6]/85 bg-[#e78bb6]/[0.15]"}`}
                  style={{ left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                    width: `${landmark.diameter_km * 1000 / (info.bounds.right - info.bounds.left) * 100}%`,
                    height: `${landmark.diameter_km * 1000 / (info.bounds.top - info.bounds.bottom) * 100}%`,
                    transform: "translate(-50%, -50%)" }} />}
                <button type="button" data-landmark-id={landmark.id} aria-label={`Open ${landmark.name} landmark`}
                  aria-pressed={active && landmarkCardOpen} title={landmark.name}
                  onPointerDown={event => event.stopPropagation()}
                  onPointerUp={event => event.stopPropagation()}
                  onPointerEnter={event => { if (event.pointerType !== "touch") { setHoveredLandmarkId(landmark.id); previewLandmark(landmark.id); } }}
                  onPointerLeave={() => { setHoveredLandmarkId(null); scheduleLandmarkHoverClose(); }}
                  onClick={event => { event.stopPropagation(); clearLandmarkHoverTimer(); setLandmarkPinned(true); setActiveLandmarkId(landmark.id); setLandmarkCardOpen(true); focusLandmark(landmark.id); }}
                  className="absolute z-[8] flex h-7 w-7 items-center justify-center"
                  style={{ left: `${position.u * 100}%`, top: `${position.v * 100}%`,
                    transform: `translate(-50%, -50%) scale(${1 / zoom})` }}>
                  <span className={`pointer-events-none h-2.5 w-2.5 rounded-full border-2 border-[#e78bb6] bg-[#301b29] ${active && landmarkCardOpen ? "outline outline-2 outline-offset-2 outline-white" : ""}`} />
                </button>
              </div>;
            })}
            {probeMarker && <span className="pointer-events-none absolute z-[12] h-4 w-4 rounded-full border-2 border-white bg-accent shadow-[0_0_0_3px_#03ace477]"
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
      {probePoint && landmarksEnabled && !exploreArea && <button type="button" onClick={onOpenProbe}
        className="absolute left-2 top-2 z-20 flex min-h-9 items-center gap-2 bg-[#242424]/95 px-3 text-xs font-medium text-accent hover:bg-[#34454b] hover:text-white sm:left-3 @min-[640px]:top-14">
        <MapPin size={15} /> Save inspected point
      </button>}
      <div className="absolute right-2 top-2 z-20 flex max-w-[calc(100%-16px)] flex-col items-end gap-1.5 sm:right-3 sm:top-3 sm:max-w-[calc(100%-24px)]">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Map layers" aria-expanded={layerPanelOpen} aria-controls="orbis-map-layers"
            onClick={() => setLayerPanelOpen(current => !current)}
            className={`flex h-9 items-center gap-1.5 bg-[#242424]/95 px-2.5 text-xs hover:bg-[#383838] ${layerPanelOpen ? "text-white" : "text-[#d1d5d7]"}`}>
            <Layers size={16} /> Layers
          </button>
          <div role="group" aria-label="Map navigation" className="flex h-9 items-center bg-[#242424]/95 px-0.5">
            <button type="button" title="Zoom in" aria-label="Zoom in" className="flex h-8 w-8 items-center justify-center hover:bg-[#444]" onClick={() => changeZoom(1.5)}><Plus size={16} /></button>
            <button type="button" title="Zoom out" aria-label="Zoom out" className="flex h-8 w-8 items-center justify-center hover:bg-[#444]" onClick={() => changeZoom(1 / 1.5)}><Minus size={16} /></button>
            <button type="button" title={focusTarget ? "Zoom to selected point" : "Select a point to zoom to"}
              aria-label="Zoom to selected point" disabled={!focusTarget}
              className="flex h-8 w-8 items-center justify-center hover:bg-[#444] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={zoomToSelection}><LocateFixed size={16} /></button>
          </div>
        </div>
        {layerPanelOpen && <div id="orbis-map-layers" className="orbis-overlay-enter w-[min(260px,calc(100vw-24px))] border border-[#4b555a] bg-[#292d30]/98 p-2.5 text-xs shadow-[0_8px_24px_#0008]">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#b8c5cb]">Map layers</div>
          <button type="button" aria-label="Toggle permanent shadows" aria-pressed={shadows}
            onClick={() => setShadows(current => !current)} className="flex min-h-9 w-full items-center gap-2 px-1.5 text-left text-[#e0e4e6] hover:bg-[#3a4145]">
            <Moon size={15} className="text-[#a9b2b7]" /><span className="min-w-0 flex-1">Permanently shadowed</span>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${shadows ? "border-accent text-accent" : "border-[#778187]"}`}>{shadows && <Check size={11} />}</span>
          </button>
          {landmarksEnabled && <button type="button" aria-label="Toggle lunar landmarks" aria-pressed={landmarksVisible}
            onClick={() => { clearLandmarkHoverTimer(); setLandmarksVisible(current => !current); setActiveLandmarkId(null); setHoveredLandmarkId(null); setLandmarkCardOpen(false); setLandmarkPinned(false); }}
            className="flex min-h-9 w-full items-center gap-2 px-1.5 text-left text-[#e0e4e6] hover:bg-[#3a4145]">
            <MapPin size={15} className="text-[#e78bb6]" /><span className="min-w-0 flex-1">Landmarks</span>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${landmarksVisible ? "border-[#e78bb6] text-[#e78bb6]" : "border-[#778187]"}`}>{landmarksVisible && <Check size={11} />}</span>
          </button>}
          <div className="my-1.5 border-t border-[#4b555a]" />
          <button type="button" aria-label="Toggle elevation contours" aria-pressed={contours}
            onClick={() => setContours(current => !current)} className="flex min-h-9 w-full items-center gap-2 px-1.5 text-left text-[#e0e4e6] hover:bg-[#3a4145]">
            <ChartNoAxesCombined size={15} className="text-[#bedce5]" /><span className="min-w-0 flex-1">Contours</span>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${contours ? "border-accent text-accent" : "border-[#778187]"}`}>{contours && <Check size={11} />}</span>
          </button>
          <button type="button" aria-label="Toggle slope shading" aria-pressed={slope}
            onClick={() => setSlope(current => !current)} className="flex min-h-9 w-full items-center gap-2 px-1.5 text-left text-[#e0e4e6] hover:bg-[#3a4145]">
            <Mountain size={15} className="text-[#f08b42]" /><span className="min-w-0 flex-1">Slope shading</span>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${slope ? "border-accent text-accent" : "border-[#778187]"}`}>{slope && <Check size={11} />}</span>
          </button>
        </div>}
        {(shadows || contours || slope || landmarksEnabled && landmarksVisible || candidateAreasVisible) && <div className="pointer-events-none flex max-w-[min(340px,100%)] flex-wrap justify-end gap-x-3 gap-y-1 bg-[#242424]/95 px-2 py-1.5 text-[10px] text-[#c5ced2]">
          {shadows && <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-accent" />PSR</span>}
          {landmarksEnabled && landmarksVisible && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-[#e78bb6]" />Landmarks</span>}
          {candidateAreasVisible && <span className="flex items-center gap-1.5"><span className="flex gap-0.5"><span className="inline-block h-2 w-2 bg-success" /><span className="inline-block h-2 w-2 bg-warning" /><span className="inline-block h-2 w-2 bg-danger" /></span>Candidates</span>}
          {contours && <span className="w-full text-right">Contours 500 m · major 2,000 m</span>}
          {slope && <span className="flex w-full flex-wrap justify-end gap-x-2 gap-y-1"><span>Slope:</span><span className="text-[#6bc4d7]">&lt;5°</span><span className="text-[#eac755]">5–15°</span><span className="text-[#f08b42]">15–30°</span><span className="text-[#dc4d62]">≥30°</span><span className="text-[#aeb8bc]">5 m raster where available · 80 m DEM elsewhere; map-scale view</span></span>}
        </div>}
        {landmarksEnabled && landmarksVisible && landmarkError && <div role="alert" className="bg-[#292929] px-2 py-1 text-xs text-[#ef9292]">{landmarkError}</div>}
      </div>
      {landmarksEnabled && landmarksVisible && activeLandmark && <LandmarkCard landmark={activeLandmark}
        open={landmarkCardOpen}
        index={activeLandmarkIndex} total={landmarks.length}
        onPrevious={() => tourLandmark(-1)} onNext={() => tourLandmark(1)}
        onClose={closeLandmarkCard} onHoverEnter={clearLandmarkHoverTimer} onHoverLeave={scheduleLandmarkHoverClose} />}
      {!hintDismissed && <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-20 flex max-w-full items-center gap-2 bg-[#242424]/95 p-2 font-mono text-[10px] sm:bottom-3 sm:left-3 sm:right-auto sm:text-[11px]">
        <div className="min-w-0 flex-1 truncate">
          {probeMode ? <span>Tap terrain to inspect a point</span> : exploreArea ? <span>Tap terrain or drag the white circle to move the search area</span> : point ? <><div>LAT {point.latitude.toFixed(5)}°</div><div>LON {point.longitude.toFixed(5)}°</div></> :
            <span className="text-[#aaa]">{selectedLocked
              ? selected?.siteId ? "Unlock site in Browse to move it" : "Unlock all project sites in Browse to edit the search region"
              : selected?.siteId ? "Click terrain to move selected site" : selected ? "Drag the circle or click terrain to move the search region" : "Select a site or project center"}</span>}
        </div>
        <button type="button" onClick={dismissHint} aria-label="Dismiss map hint permanently" title="Hide map hint in this browser"
          className="pointer-events-auto shrink-0 p-1 text-[#aaa] hover:text-white"><X size={14} /></button>
      </div>}
      {hoverCoordinates ? <div className="pointer-events-none absolute bottom-12 right-2 z-20 bg-[#242424]/95 px-2 py-1 font-mono text-[10px] text-[#e3eaed] sm:bottom-3 sm:right-3">
        {hoverCoordinates}
      </div> : <div className="pointer-events-none absolute bottom-3 right-3 z-20 hidden bg-[#242424]/95 px-2 py-1 text-[10px] text-[#aaa] sm:block">
        {probeMode ? exploreArea ? "Click terrain to set search center" : "Click terrain to inspect a point" : saving ? "Saving..." : `${Math.round(zoom * 100)}% · LOLA`}
      </div>}
      {error && info && <div className="pointer-events-none absolute bottom-14 left-3 z-20 bg-[#292929] px-3 py-2 text-xs text-[#ef9292]">{error}</div>}
    </div>
  );
}
