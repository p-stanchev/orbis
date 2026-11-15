import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Lock,
  LockOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  MapPin,
  Menu,
  MoreHorizontal,
  MousePointer2,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import LunarMap from "./components/LunarMap";
import MissionAnalysis from "./components/MissionAnalysis";
import SplitWorkspace from "./components/SplitWorkspace";
import VisibilityStatistics, { type SearchRegion, type SearchGridCell } from "./components/VisibilityStatistics";
import ExploreSearch from "./components/ExploreSearch";
import ResilienceExplorer from "./components/ResilienceExplorer";
import OptimalLandingWindow from "./components/OptimalLandingWindow";
import NumericInput from "./components/NumericInput";

type Site = { id: string; name: string; latitude: number; longitude: number };
type Project = {
  id: string; name: string; arrival_utc: string; duration_hours: number;
  color: string; center_latitude: number; center_longitude: number;
  radius_m: number; sites: Site[];
};
type MissionChanges = {
  arrival_utc?: string; duration_hours?: number;
  center_latitude?: number; center_longitude?: number; radius_m?: number;
};
type Target = { projectId: string; siteId?: string };
type Dialog = { action: "project" | "site" | "rename"; target?: Target } | null;

type Props = { children: ReactNode; onClick: () => void; title: string };
const VISIBILITY_KEY = "orbis-hidden-projects-v1";
const BROWSE_WIDTH_KEY = "orbis-browse-width-v1";
const INSPECTOR_WIDTH_KEY = "orbis-inspector-width-v1";
const UNLOCKED_MARKERS_KEY = "orbis-unlocked-map-markers-v1";

function savedWidth(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= 180 && value <= 420 ? value : fallback;
}

function loadHiddenProjects(): string[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(VISIBILITY_KEY) ?? "[]",
    );
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function loadUnlockedSites(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(UNLOCKED_MARKERS_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((key): key is string => typeof key === "string" && key.startsWith("site:")).map(key => key.slice(5))
      : [];
  } catch {
    return [];
  }
}

async function request<T>(
  url: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : `Request failed (${response.status})`,
    );
  }
  return response.json();
}

function IconButton({ children, onClick, title }: Props) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center text-[#aaa] hover:bg-[#484848] hover:text-white"
    >
      {children}
    </button>
  );
}

function Coordinate({
  label,
  value,
  save,
  disabled = false,
  min,
  max,
}: {
  label: string;
  value: number;
  save: (value: number) => Promise<void>;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    setDraft(String(value));
    setError(false);
  }, [value]);

  async function commit(nextDraft = draft) {
    if (disabled) { setDraft(String(value)); return; }
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const number = Number(nextDraft);
    if (!nextDraft.trim() || !Number.isFinite(number)) {
      setDraft(String(value));
      return;
    }
    const limit = label.toLowerCase().includes("latitude") ? 90 : 180;
    const normalized = Math.min(max ?? limit, Math.max(min ?? -limit, number));
    setDraft(String(normalized));
    if (normalized === value) return;
    try {
      await save(normalized);
      setError(false);
    } catch {
      setDraft(String(value));
      setError(true);
    }
  }

  return (
    <label className="block text-xs text-[#aaa]">
      {label}
      <NumericInput
        key={label}
        value={draft}
        type="text"
        inputMode="decimal"
        min={min ?? (label.toLowerCase().includes("latitude") ? -90 : -180)}
        max={max ?? (label.toLowerCase().includes("latitude") ? 90 : 180)}
        increment={0.0001}
        aria-label={label}
        disabled={disabled}
        onValueChange={setDraft}
        onStep={next => void commit(next)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelled.current = true;
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
        className={`mt-1 w-full border bg-[#292929] p-2 text-white outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60 ${error ? "border-danger" : "border-[#555]"}`}
      />
      {error && (
        <span className="mt-1 block text-[11px] text-[#ef9292]">
          Could not save coordinate.
        </span>
      )}
    </label>
  );
}

function MissionSettings({
  project,
  regionLocked,
  save,
}: {
  project: Project;
  regionLocked: boolean;
  save: (changes: MissionChanges) => Promise<void>;
}) {
  const [arrival, setArrival] = useState(project.arrival_utc.slice(0, 16));
  const [duration, setDuration] = useState(String(project.duration_hours));
  const [radius, setRadius] = useState(String(project.radius_m));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setArrival(project.arrival_utc.slice(0, 16));
    setDuration(String(project.duration_hours));
    setRadius(String(project.radius_m));
  }, [project.arrival_utc, project.duration_hours, project.radius_m]);

  async function saveArrival() {
    if (saving || arrival === project.arrival_utc.slice(0, 16)) return;
    const date = new Date(`${arrival}:00Z`);
    if (!arrival || !Number.isFinite(date.getTime())) {
      setError("Enter a valid UTC date and time.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await save({ arrival_utc: date.toISOString() });
    } catch (reason) {
      setArrival(project.arrival_utc.slice(0, 16));
      setError(reason instanceof Error ? reason.message : "Could not save arrival time.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDuration(nextDuration = duration) {
    if (saving || nextDuration === String(project.duration_hours)) return;
    const hours = Number(nextDuration);
    if (!Number.isInteger(hours) || hours < 1 || hours > 8760) {
      setError("Duration must be 1–8760 hours.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await save({ duration_hours: hours });
    } catch (reason) {
      setDuration(String(project.duration_hours));
      setError(reason instanceof Error ? reason.message : "Could not save duration.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRadius(nextRadius = radius) {
    if (regionLocked) return;
    const next = Number(nextRadius);
    if (saving || next === project.radius_m) return;
    if (!Number.isFinite(next) || next < 50 || next > 20000) {
      setError("Search radius must be 50–20,000 metres.");
      setRadius(String(project.radius_m));
      return;
    }
    setSaving(true);
    setError("");
    try { await save({ radius_m: next }); }
    catch (reason) {
      setRadius(String(project.radius_m));
      setError(reason instanceof Error ? reason.message : "Could not save radius.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 p-3 text-xs">
      <p className="[overflow-wrap:anywhere] font-medium text-white" style={{ borderLeft: `3px solid ${project.color}`, paddingLeft: 8 }}>{project.name}</p>
      <label className="block text-[#aaa]">
        Arrival (UTC)
        <input
          type="datetime-local"
          aria-label="Mission arrival in UTC"
          value={arrival}
          onChange={(event) => setArrival(event.target.value)}
          onBlur={() => void saveArrival()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          style={{ colorScheme: "dark" }}
          className="mt-1 w-full min-w-0 border border-[#555] bg-[#292929] p-2 text-white outline-none focus:border-accent"
        />
      </label>
      <label className="block text-[#aaa]">
        Mission duration (hours)
        <NumericInput
          min={1}
          max={8760}
          step={1}
          aria-label="Mission duration in hours"
          value={duration}
          onValueChange={setDuration}
          onStep={next => void saveDuration(next)}
          onBlur={() => void saveDuration()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          style={{ colorScheme: "dark" }}
          className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white outline-none focus:border-accent"
        />
        <span className="mt-1 block text-[10px] text-[#888]">
          {Number(duration) > 0 ? `${(Number(duration) / 24).toFixed(1)} Earth days` : ""}
        </span>
      </label>
      <div className="space-y-2 border-t border-[#555] pt-3">
        <p className="text-[#ddd]">Search region</p>
        <Coordinate key={`${project.id}-center-lat`} label="Center latitude" value={project.center_latitude}
          min={-90} max={-80} disabled={regionLocked} save={value => save({ center_latitude: value })} />
        <Coordinate key={`${project.id}-center-lon`} label="Center longitude" value={project.center_longitude}
          disabled={regionLocked} save={value => save({ center_longitude: value })} />
        <label className="block text-[#aaa]">
          Search radius (m)
          <NumericInput min={50} max={20000} step={50} value={radius}
            disabled={regionLocked}
            onValueChange={setRadius}
            onStep={next => void saveRadius(next)}
            onBlur={() => void saveRadius()}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
            className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white outline-none focus:border-accent [color-scheme:dark]" />
        </label>
        <p className="text-[11px] text-[#999]">{regionLocked
          ? "Unlock all landing sites in Browse to edit the search region."
          : "The coloured ring marks the search area, not a verified safe landing zone. Select the project and drag its circle or edge handle to edit it."}</p>
      </div>
      {error && <p role="alert" className="text-[#ef9292]">{error}</p>}
      {saving && <p className="text-[#aaa]">Saving...</p>}
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState<"map" | "explore" | "analysis" | "statistics">("map");
  const [selectedMissionHours, setSelectedMissionHours] = useState(0);
  const [exploreMode, setExploreMode] = useState<"candidates" | "resilience" | "windows">("candidates");
  const [landingUncertainty, setLandingUncertainty] = useState(500);
  const [analysisPreview, setAnalysisPreview] = useState<{ projectId: string; siteId: string; arrival: string; duration: number } | null>(null);
  const [browseOpen, setBrowseOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [hiddenProjects, setHiddenProjects] =
    useState<string[]>(loadHiddenProjects);
  const [unlockedSites, setUnlockedSites] = useState<string[]>(loadUnlockedSites);
  const [connected, setConnected] = useState(false);
  const [clients, setClients] = useState(0);
  const [selected, setSelected] = useState<Target | null>(null);
  const [regions, setRegions] = useState<{ projectId: string | null; areas: SearchRegion[]; grid: SearchGridCell[]; spacing: number } | null>(null);
  const [exploreArea, setExploreArea] = useState({ latitude: -85, longitude: 0, radius_m: 10000 });
  const [candidatePrefill, setCandidatePrefill] = useState<{ revision: number; arrival: string; duration: number; darkness: number; earthOutage: number } | null>(null);
  const [browseWidth, setBrowseWidth] = useState(() => savedWidth(BROWSE_WIDTH_KEY, 240));
  const [inspectorWidth, setInspectorWidth] = useState(() => savedWidth(INSPECTOR_WIDTH_KEY, 280));
  const resizing = useRef<"browse" | "inspector" | null>(null);
  const [probePoint, setProbePoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [probeCandidateName, setProbeCandidateName] = useState("");
  const [probeSaveError, setProbeSaveError] = useState("");
  const [probeSaving, setProbeSaving] = useState(false);
  const [mapFocus, setMapFocus] = useState<{ latitude: number; longitude: number; revision: number } | null>(null);
  const [probeMode, setProbeMode] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [utc, setUtc] = useState("");
  const [drawer, setDrawer] = useState<"browse" | "inspector" | null>(null);
  const [displayedDrawer, setDisplayedDrawer] = useState<"browse" | "inspector" | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);

  useEffect(() => {
    if (drawer) {
      setDisplayedDrawer(drawer);
      return;
    }
    if (!displayedDrawer) return;
    const timeout = window.setTimeout(() => setDisplayedDrawer(null), 300);
    return () => window.clearTimeout(timeout);
  }, [drawer, displayedDrawer]);

  useEffect(() => {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(hiddenProjects));
  }, [hiddenProjects]);

  useEffect(() => {
    localStorage.setItem(UNLOCKED_MARKERS_KEY, JSON.stringify(unlockedSites.map(id => `site:${id}`)));
  }, [unlockedSites]);

  useEffect(() => {
    localStorage.setItem(BROWSE_WIDTH_KEY, String(browseWidth));
    localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
  }, [browseWidth, inspectorWidth]);

  function resizePanel(event: PointerEvent<HTMLDivElement>, side: "browse" | "inspector") {
    if (resizing.current !== side) return;
    const limit = Math.max(180, Math.min(420, window.innerWidth - 560 -
      (side === "browse" && inspectorOpen ? inspectorWidth : side === "inspector" && browseOpen ? browseWidth : 0)));
    const width = side === "browse" ? event.clientX : window.innerWidth - event.clientX;
    (side === "browse" ? setBrowseWidth : setInspectorWidth)(Math.max(180, Math.min(limit, width)));
  }

  function resizeHandle(side: "browse" | "inspector") {
    const width = side === "browse" ? browseWidth : inspectorWidth;
    return <div role="separator" tabIndex={0} aria-label={`Resize ${side === "browse" ? "Browse" : "Inspector"}`}
      aria-orientation="vertical" aria-valuemin={180} aria-valuemax={420} aria-valuenow={width}
      title="Drag to resize · Double-click to reset"
      className={`group absolute inset-y-0 z-30 w-2 cursor-col-resize touch-none ${side === "browse" ? "-right-1" : "-left-1"}`}
      onPointerDown={event => { resizing.current = side; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={event => resizePanel(event, side)}
      onPointerUp={event => { resizing.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { resizing.current = null; }}
      onDoubleClick={() => (side === "browse" ? setBrowseWidth : setInspectorWidth)(side === "browse" ? 240 : 280)}
      onKeyDown={event => {
        const amount = event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0;
        if (!amount) return;
        event.preventDefault();
        (side === "browse" ? setBrowseWidth : setInspectorWidth)(old => Math.max(180, Math.min(420, old + (side === "browse" ? amount : -amount))));
      }}><span className="absolute inset-y-0 left-1/2 w-px bg-[#50565b] transition-colors group-hover:bg-accent group-focus-visible:bg-accent" /></div>;
  }

  function toggleProjectVisibility(projectId: string) {
    setHiddenProjects((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  }

  const reload = useCallback(async () => {
    setProjects(await request<Project[]>("/api/projects"));
  }, []);

  useEffect(() => {
    const clock = () =>
      setUtc(new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC");
    clock();
    const timer = window.setInterval(clock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    void reload().catch(() => {});

    function connect() {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${location.host}/ws`);
      socket.onopen = () => {
        setConnected(true);
        void reload().catch(() => {});
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "projects_changed")
            void reload().catch(() => {});
          if (message.type === "users_changed")
            setClients(Number(message.data?.count ?? message.count ?? 0));
        } catch {
          /* Ignore malformed events. */
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setConnected(false);
        setClients(0);
        retry = window.setTimeout(connect, 2000);
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);

      if (socket) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.addEventListener("open", () => socket?.close(), {
            once: true,
          });
        }
      }
    };
  }, [reload]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialog && !deleting && !drawer) {
        setSelected(null);
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, deleting, drawer]);

  const currentProject = projects.find(
    (project) => project.id === selected?.projectId,
  );
  const currentSite = currentProject?.sites.find(
    (site) => site.id === selected?.siteId,
  );
  useEffect(() => {
    if (probePoint && currentProject) {
      setProbeCandidateName(`Candidate Site ${currentProject.sites.length + 1}`);
      setProbeSaveError("");
    }
  }, [probePoint?.latitude, probePoint?.longitude, currentProject?.id]);
  const canAnalyze = !!currentProject && (!!currentSite || !!probePoint);
  useEffect(() => { setSelectedMissionHours(0); }, [currentProject?.id, currentProject?.arrival_utc, currentProject?.duration_hours,
    selected?.siteId, probePoint?.latitude, probePoint?.longitude]);
  useEffect(() => {
    if (workspace === "analysis" && !canAnalyze) setWorkspace("map");
  }, [workspace, canAnalyze]);
  useEffect(() => {
    if (workspace !== "analysis") setAnalysisPreview(null);
  }, [workspace]);
  const targetName = (target: Target) => {
    const project = projects.find((item) => item.id === target.projectId);
    return target.siteId
      ? (project?.sites.find((site) => site.id === target.siteId)?.name ?? "")
      : (project?.name ?? "");
  };
  const urlFor = (target: Target) =>
    `/api/projects/${target.projectId}${target.siteId ? `/sites/${target.siteId}` : ""}`;

  function focusMap(point: { latitude: number; longitude: number }) {
    setMapFocus(current => ({ ...point, revision: (current?.revision ?? 0) + 1 }));
    setWorkspace("map");
    setProbeMode(false);
    setDrawer(null);
  }

  function unlockNewSite(siteId: string) {
    setUnlockedSites(current => current.includes(siteId) ? current : [...current, siteId]);
  }

  async function saveInspectedPoint(candidateName: string, point: { latitude: number; longitude: number }) {
    if (!currentProject) throw new Error("Select a project before saving this point.");
    if (!candidateName.trim()) throw new Error("Enter a candidate site name.");
    const site = await request<Site>(`/api/projects/${currentProject.id}/sites`, "POST",
      { name: candidateName.trim(), latitude: point.latitude, longitude: point.longitude });
    unlockNewSite(site.id);
    await reload();
    setSelected({ projectId: currentProject.id, siteId: site.id });
    setProbePoint(null);
    setHiddenProjects(current => current.filter(id => id !== currentProject.id));
    focusMap(point);
  }
  const filtered = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(search.toLowerCase()) ||
      project.sites.some((site) =>
        site.name.toLowerCase().includes(search.toLowerCase()),
      ),
  );

  function openDialog(action: NonNullable<Dialog>["action"], target?: Target) {
    setDialog({ action, target });
    setName(
      action === "rename" && target
        ? targetName(target)
        : action === "site" && target
          ? `Landing Site ${(projects.find((p) => p.id === target.projectId)?.sites.length ?? 0) + 1}`
          : "",
    );
    setError("");
    setMenu(null);
  }

  async function submit() {
    if (!dialog || !name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (dialog.action === "project") {
        const project = await request<Project>("/api/projects", "POST", {
          name: name.trim(),
        });
        setSelected({ projectId: project.id });
        setExpanded((old) => [...new Set([...old, project.id])]);
      } else if (dialog.action === "site" && dialog.target) {
        const project = projects.find(item => item.id === dialog.target!.projectId);
        if (!project) throw new Error("Project is no longer available.");
        const site = await request<Site>(
          `${urlFor(dialog.target)}/sites`,
          "POST",
          { name: name.trim(), latitude: project.center_latitude, longitude: project.center_longitude },
        );
        unlockNewSite(site.id);
        setSelected({ projectId: dialog.target.projectId, siteId: site.id });
        setExpanded((old) => [...new Set([...old, dialog.target!.projectId])]);
      } else if (dialog.action === "rename" && dialog.target) {
        await request(urlFor(dialog.target), "PATCH", { name: name.trim() });
      }
      await reload();
      setDialog(null);
      setDrawer(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(urlFor(deleting), "DELETE");
      await reload();
      if (
        selected?.projectId === deleting.projectId &&
        (!deleting.siteId || selected.siteId === deleting.siteId)
      )
        setSelected(deleting.siteId ? { projectId: deleting.projectId } : null);
      setDeleting(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCoordinate(
    field: "latitude" | "longitude",
    value: number,
  ) {
    if (!selected?.siteId || !unlockedSites.includes(selected.siteId)) return;
    await request(urlFor(selected), "PATCH", { [field]: value });
    await reload();
  }

  async function moveLandingSite(
    target: Target,
    latitude: number,
    longitude: number,
  ) {
    if (!target.siteId || !unlockedSites.includes(target.siteId)) return;
    await request(urlFor(target), "PATCH", { latitude, longitude });
    await reload();
  }

  async function saveMissionSettings(
    projectId: string,
    changes: MissionChanges,
  ) {
    if ((changes.center_latitude !== undefined || changes.center_longitude !== undefined || changes.radius_m !== undefined) &&
      projects.find(project => project.id === projectId)?.sites.some(site => !unlockedSites.includes(site.id))) {
      throw new Error("Unlock all landing sites to edit this search region.");
    }
    await request(`/api/projects/${projectId}`, "PATCH", changes);
    await reload();
  }

  function inspectArrival(projectId: string, siteId: string, arrival: string, duration: number) {
    setSelected({ projectId, siteId });
    setProbePoint(null);
    setAnalysisPreview({ projectId, siteId, arrival, duration });
    setSelectedMissionHours(0);
    setWorkspace("analysis");
  }

  async function applyArrival(projectId: string, siteId: string, arrival: string, duration: number) {
    await saveMissionSettings(projectId, { arrival_utc: arrival, duration_hours: duration });
    setAnalysisPreview(null);
    setSelected({ projectId, siteId });
    setProbePoint(null);
    setSelectedMissionHours(0);
    setWorkspace("analysis");
  }

  async function createFromExplore(name: string, latitude: number, longitude: number,
    radius_m: number, arrival_utc: string, duration_hours: number,
    siteLatitude: number, siteLongitude: number) {
    const project = await request<Project>("/api/projects", "POST", { name });
    let site: Site;
    try {
      await request(`/api/projects/${project.id}`, "PATCH", {
        center_latitude: latitude, center_longitude: longitude, radius_m, arrival_utc, duration_hours,
      });
      site = await request<Site>(`/api/projects/${project.id}/sites`, "POST", {
        name: "Candidate Site 1",
      });
      await request(`/api/projects/${project.id}/sites/${site.id}`, "PATCH", {
        latitude: siteLatitude, longitude: siteLongitude,
      });
    } catch (reason) {
      await request(`/api/projects/${project.id}`, "DELETE").catch(() => {});
      throw reason;
    }
    unlockNewSite(site.id);
    await reload();
    setSelected({ projectId: project.id, siteId: site.id });
    setProbePoint(null);
    setExpanded(old => [...new Set([...old, project.id])]);
    setRegions(null);
    setWorkspace("map");
  }

  const browse = (
    <>
      <div className="flex h-8 items-center justify-between border-b border-[#484848] px-3 text-xs text-[#b8b8b8]">
        Browse
        <button aria-label="Close Browse" title="Close Browse"
          onClick={() => { setDrawer(null); setBrowseOpen(false); }}><PanelLeftClose size={16} /></button>
      </div>
      <div className="orbis-scroll min-h-0 flex-1 overflow-auto" onClick={event => {
        if (event.target === event.currentTarget) { setSelected(null); setProbePoint(null); setMenu(null); }
      }}>
        {filtered.length === 0 && <div className="flex flex-col items-center px-4 pt-12 text-center text-xs leading-relaxed text-[#b9c3c8]">
          <Folder size={24} className="text-accent" />
          <p className="mt-3 font-medium text-white">{projects.length ? "No matching projects" : "No projects yet"}</p>
          <p className="mt-1 min-h-[3.75rem]">{projects.length ? "Try another search term." : "Create a project to start planning landing sites."}</p>
          <button type="button" onClick={() => projects.length ? setSearch("") : openDialog("project")}
            className="mt-4 min-h-9 bg-accent px-3 font-medium text-white transition-[filter] hover:brightness-90">
            {projects.length ? "Clear search" : "Create project"}
          </button>
        </div>}
        {filtered.map((project) => {
          const expandedNow = expanded.includes(project.id) || !!search;
          const isHidden = hiddenProjects.includes(project.id);
          return (
            <div key={project.id} className={isHidden ? "text-[#888]" : ""}>
              <div
                className={`flex h-10 items-center border-l-[3px] transition-colors hover:bg-[#41474a] ${selected?.projectId === project.id ? "bg-[#3b4448]" : ""}`}
                style={{ borderLeftColor: project.color }}
              >
                <IconButton
                  title={expandedNow ? "Collapse" : "Expand"}
                  onClick={() =>
                    setExpanded((old) =>
                      expandedNow
                        ? old.filter((id) => id !== project.id)
                        : [...old, project.id],
                    )
                  }
                >
                  {expandedNow ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </IconButton>
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
                  onDoubleClick={() => openDialog("rename", { projectId: project.id })}
                  onClick={() => {
                    setSelected({ projectId: project.id });
                    setProbePoint(null);
                    setDrawer(null);
                  }}
                >
                  <Folder size={14} className="shrink-0" style={{ color: project.color }} />
                  <span className="truncate">{project.name}</span>
                  <span className="shrink-0 rounded bg-[#252b2e] px-1.5 py-0.5 font-mono text-[10px] text-[#b9c5ca]" title={`${project.sites.length} landing sites`}>{project.sites.length}</span>
                </button>
                <button
                  type="button"
                  title={
                    isHidden ? "Show project markers" : "Hide project markers"
                  }
                  aria-label={
                    isHidden ? `Show ${project.name}` : `Hide ${project.name}`
                  }
                  aria-pressed={!isHidden}
                  onClick={() => toggleProjectVisibility(project.id)}
                  className={`flex h-8 w-7 shrink-0 items-center justify-center hover:bg-[#484848] ${isHidden ? "text-[#777]" : "text-[#bbb]"}`}
                >
                  {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <IconButton
                  title="Add site"
                  onClick={() => openDialog("site", { projectId: project.id })}
                >
                  <Plus size={14} />
                </IconButton>
                <IconButton
                  title="Project options"
                  onClick={() =>
                    setMenu(
                      menu?.projectId === project.id && !menu.siteId
                        ? null
                        : { projectId: project.id },
                    )
                  }
                >
                  <MoreHorizontal size={15} />
                </IconButton>
              </div>
              {expandedNow &&
                project.sites
                  .filter(
                    (site) =>
                      !search ||
                      project.name
                        .toLowerCase()
                        .includes(search.toLowerCase()) ||
                      site.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((site) => (
                    <div
                      key={site.id}
                       className={`flex h-9 items-center border-l-[3px] border-transparent pl-6 transition-colors hover:bg-[#41474a] ${selected?.siteId === site.id ? "bg-[#50585c]" : ""}`}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
                        onDoubleClick={() => openDialog("rename", { projectId: project.id, siteId: site.id })}
                        onClick={() => {
                          setSelected({
                            projectId: project.id,
                            siteId: site.id,
                          });
                          setProbePoint(null);
                          setDrawer(null);
                        }}
                      >
                        <MapPin size={13} className="shrink-0" style={{ color: project.color }} />
                        <span className="truncate">{site.name}</span>
                      </button>
                      <button type="button"
                        aria-label={`${unlockedSites.includes(site.id) ? "Lock" : "Unlock"} ${site.name} for map editing`}
                        aria-pressed={!unlockedSites.includes(site.id)}
                        title={unlockedSites.includes(site.id) ? "Lock site position" : "Unlock site position"}
                        onClick={() => setUnlockedSites(current => current.includes(site.id)
                          ? current.filter(id => id !== site.id) : [...current, site.id])}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center hover:bg-[#484848] ${unlockedSites.includes(site.id) ? "text-accent" : "text-[#aaa]"}`}>
                        {unlockedSites.includes(site.id) ? <LockOpen size={15} /> : <Lock size={15} />}
                      </button>
                      <IconButton
                        title="Site options"
                        onClick={() =>
                          setMenu(
                            menu?.siteId === site.id
                              ? null
                              : { projectId: project.id, siteId: site.id },
                          )
                        }
                      >
                        <MoreHorizontal size={15} />
                      </IconButton>
                    </div>
                  ))}
              {menu?.projectId === project.id && (
                <div className="mx-2 border border-[#555] bg-[#292929] text-xs">
                  <button
                    className="flex w-full items-center gap-2 p-2 hover:bg-[#444]"
                    onClick={() => openDialog("rename", menu)}
                  >
                    <Pencil size={13} /> Rename
                  </button>
                  <button
                    className="flex w-full items-center gap-2 p-2 text-[#ef9292] hover:bg-[#444]"
                    onClick={() => {
                      setDeleting(menu);
                      setMenu(null);
                      setError("");
                    }}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  const inspector = (
    <>
      <div className="flex h-8 items-center justify-between border-b border-[#484848] px-3 text-xs text-[#b8b8b8]">
        <span>Inspector</span>
        <span className="flex items-center gap-3">
          {selected && (
            <button
              type="button"
              title="Clear selection"
              aria-label="Clear selection"
              onClick={() => setSelected(null)}
            >
              <X size={15} />
            </button>
          )}
          <button aria-label="Close Inspector" title="Close Inspector"
            onClick={() => { setDrawer(null); setInspectorOpen(false); }}>
            <PanelRightClose size={16} />
          </button>
        </span>
      </div>
      {probePoint && currentProject && workspace === "map" ? (
        <div className="space-y-3 p-3 text-xs">
          <div className="font-medium text-white">Inspected point</div>
          <div className="font-mono text-[#b9c3c8]">{probePoint.latitude.toFixed(6)}°, {probePoint.longitude.toFixed(6)}°</div>
          <label className="block text-[#aaa]">Candidate site name
            <input type="text" maxLength={100} value={probeCandidateName}
              onChange={event => setProbeCandidateName(event.target.value)}
              className="mt-1 w-full border border-[#555] bg-[#292929] p-2 text-white outline-none focus:border-accent" />
          </label>
          <button type="button" disabled={probeSaving} onClick={() => {
            setProbeSaving(true);
            setProbeSaveError("");
            void saveInspectedPoint(probeCandidateName, probePoint)
              .catch(reason => setProbeSaveError(reason instanceof Error ? reason.message : "Could not save this point."))
              .finally(() => setProbeSaving(false));
          }} className="w-full bg-accent px-3 py-2 text-left font-medium text-white transition-[filter] hover:brightness-90 disabled:opacity-50">
            {probeSaving ? "Saving…" : "Save as candidate site"}
          </button>
          {probeSaveError && <p role="alert" className="text-[#ef9292]">{probeSaveError}</p>}
          <button type="button" onClick={() => setProbePoint(null)} className="text-[#aeb8bd] hover:text-white">Clear inspected point</button>
        </div>
      ) : currentSite && currentProject ? (
        <div className="space-y-3 p-3">
          <p className="break-words text-xs font-medium">{currentSite.name}</p>
          {!unlockedSites.includes(currentSite.id) && <p className="text-[11px] text-[#aaa]">Site position locked. Unlock it in Browse to move or edit coordinates.</p>}
          <Coordinate key={`${currentSite.id}-lat`} label="Latitude" value={currentSite.latitude}
            disabled={!unlockedSites.includes(currentSite.id)} save={value => saveCoordinate("latitude", value)} />
          <Coordinate key={`${currentSite.id}-lon`} label="Longitude" value={currentSite.longitude}
            disabled={!unlockedSites.includes(currentSite.id)} save={value => saveCoordinate("longitude", value)} />
          <button type="button" onClick={() => { setWorkspace("analysis"); setDrawer(null); }}
            className="w-full bg-accent px-3 py-2 text-left text-xs font-medium text-white transition-[filter] hover:brightness-90">
            Open Mission Analysis
          </button>
          <p className="text-[11px] text-[#999]">Click the map to move this landing site, or drag its marker.</p>
        </div>
      ) : currentProject ? (
        <MissionSettings
          key={currentProject.id}
          project={currentProject}
          regionLocked={currentProject.sites.some(site => !unlockedSites.includes(site.id))}
          save={(changes) => saveMissionSettings(currentProject.id, changes)}
        />
      ) : <div className="flex min-h-0 flex-1 flex-col items-center px-4 pt-12 text-center text-xs leading-relaxed text-[#b9c3c8]">
        <MousePointer2 size={24} className="shrink-0 text-accent" />
        <p className="mt-3 font-medium text-[#edf1f2]">Nothing selected</p>
        <p className="mt-1 min-h-[3.75rem]">Select a project or landing site in Browse to inspect its coordinates and mission settings.</p>
        <button type="button" onClick={() => { setWorkspace("explore"); setProbePoint(null); setDrawer(null); }}
          className="mt-4 min-h-9 bg-accent px-3 font-medium text-white transition-[filter] hover:brightness-90">Explore candidate areas</button>
      </div>}
    </>
  );

  const mapView = <LunarMap
    landmarksEnabled={workspace === "map"}
    projects={projects}
    hiddenProjectIds={hiddenProjects}
    unlockedSiteIds={unlockedSites}
    selected={selected}
    regions={workspace === "explore" ? regions?.projectId === null ? regions : null : regions?.projectId ? regions : null}
    exploreArea={workspace === "explore" ? exploreArea : null}
    probePoint={workspace === "explore" ? null : probePoint}
    onOpenProbe={() => {
      if (window.matchMedia("(min-width: 1024px)").matches) setInspectorOpen(true);
      else setDrawer("inspector");
    }}
    focusRequest={mapFocus}
    probeMode={probeMode}
    onProbePoint={point => {
      if (workspace === "explore") {
        setExploreArea(current => ({ ...current, ...point }));
        setRegions(null);
      } else setProbePoint(point);
      setProbeMode(false);
    }}
    onMoveProjectCenter={async (projectId, lat, lon) => {
      await saveMissionSettings(projectId, { center_latitude: lat, center_longitude: lon });
    }}
    onResizeProject={async (projectId, radius) => {
      await saveMissionSettings(projectId, { radius_m: radius });
    }}
    onMoveExploreArea={(latitude, longitude) => {
      setExploreArea(current => ({ ...current, latitude, longitude }));
      setRegions(null);
      setProbeMode(false);
    }}
    onSelectSite={target => {
      setSelected(target);
      setProbePoint(null);
      setDrawer(null);
    }}
    onMoveSite={moveLandingSite}
  />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#3d3d3d] text-[#eee]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#505050] bg-[#242424] px-2 sm:gap-3 sm:px-3">
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            className="flex h-9 w-8 items-center justify-center text-[#c8d0d4] hover:text-white lg:hidden"
            title="Browse"
            aria-label="Open Browse"
            onClick={() => setDrawer("browse")}
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 border-r border-[#505050] pr-2.5 sm:pr-4" aria-label="ORBIS">
            <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 object-contain sm:h-8 sm:w-8" />
            <span className="text-sm font-semibold tracking-[0.08em] text-white sm:text-base">ORBIS</span>
          </div>
        </div>
        <div className="flex h-9 min-w-0 flex-1 items-center border border-[#444] bg-[#303030] px-2 focus-within:border-accent">
            <Search size={15} className="shrink-0 text-[#aaa]" />
            <input
              className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none"
              placeholder="Search projects..."
              aria-label="Search projects and sites"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button title="Clear search" onClick={() => setSearch("")}>
                <X size={13} />
              </button>
            )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-[#ccc] sm:gap-3">
          <button type="button" className="flex h-9 w-9 items-center justify-center text-accent transition-colors hover:bg-[#353535] hover:text-white"
            title="Create project" aria-label="Create project" onClick={() => openDialog("project")}><Plus size={20} /></button>
          <span
            className="flex items-center gap-1.5"
            title={connected ? "API connected" : "API disconnected"}
          >
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-danger"}`}
            />{" "}
            <span className="hidden sm:inline">API</span>
          </span>
          <span
            className="hidden items-center gap-1 sm:flex"
            title="Connected browser sessions"
          >
            <Users size={14} />
            {clients}
          </span>
          <span className="hidden font-mono text-[10px] md:inline">{utc}</span>
          <button
            className="lg:hidden"
            title="Inspector"
            aria-label="Open Inspector"
            onClick={() => setDrawer("inspector")}
          >
            <SlidersHorizontal size={19} />
          </button>
        </div>
      </header>

      <div className="orbis-shell min-h-0 flex-1"
        style={{ "--shell-columns": `${browseOpen ? `${browseWidth}px ` : ""}minmax(0,1fr)${inspectorOpen ? ` ${inspectorWidth}px` : ""}` } as CSSProperties}>
        <aside className={`relative min-h-0 flex-col border-r border-[#505050] bg-[#303336] ${browseOpen ? "hidden lg:flex" : "hidden"}`}>
          {browse}
          {browseOpen && resizeHandle("browse")}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#191919]" aria-label="Lunar mission workspace">
          <div className="flex h-12 min-w-0 shrink-0 items-center border-b border-[#505050] bg-[#242424] text-sm">
            {!browseOpen && <button type="button" className="hidden h-full w-10 shrink-0 items-center justify-center border-r border-[#444] text-[#aaa] hover:bg-[#333] hover:text-white lg:flex"
              aria-label="Open Browse" title="Open Browse" onClick={() => setBrowseOpen(true)}><PanelLeftOpen size={18} /></button>}
            <div className="orbis-scroll flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto px-2 sm:gap-3 sm:px-4">
            <button type="button" onClick={() => { setWorkspace("map"); setProbeMode(false); }}
              className={`h-full shrink-0 border-b-[3px] px-2 transition-colors sm:px-3 ${workspace === "map" ? "border-accent font-medium text-white" : "border-transparent text-[#c0c3c6] hover:bg-[#333] hover:text-white"}`}>
              Map
            </button>
            <button type="button" onClick={() => { setWorkspace("explore"); setProbePoint(null); setProbeMode(false); }}
              className={`h-full shrink-0 border-b-[3px] px-2 transition-colors sm:px-3 ${workspace === "explore" ? "border-accent font-medium text-white" : "border-transparent text-[#c0c3c6] hover:bg-[#333] hover:text-white"}`}>
              Explore
            </button>
            <button type="button" onClick={() => { setWorkspace("analysis"); setProbeMode(false); }}
              disabled={!canAnalyze}
              title={!canAnalyze ? "Select a landing site or inspect a point first" : "Analyze selected point"}
              className={`h-full shrink-0 border-b-[3px] px-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 ${workspace === "analysis" ? "border-accent font-medium text-white" : "border-transparent text-[#c0c3c6] hover:bg-[#333] hover:text-white"}`}>
              Mission Analysis
            </button>
            <button type="button" onClick={() => { setWorkspace("statistics"); setProbeMode(false); }}
              disabled={!currentProject}
              className={`h-full shrink-0 border-b-[3px] px-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 ${workspace === "statistics" ? "border-accent font-medium text-white" : "border-transparent text-[#c0c3c6] hover:bg-[#333] hover:text-white"}`}>
              Statistics
            </button>
            </div>
            {!inspectorOpen && <button type="button" className="hidden h-full w-10 shrink-0 items-center justify-center border-l border-[#444] text-[#aaa] hover:bg-[#333] hover:text-white lg:flex"
              aria-label="Open Inspector" title="Open Inspector" onClick={() => setInspectorOpen(true)}><PanelRightOpen size={18} /></button>}
          </div>
          <SplitWorkspace
            key={workspace === "statistics" ? "statistics" : "explore"}
            splitId={workspace === "statistics" ? "statistics" : "explore"}
            active={workspace === "explore" || workspace === "statistics"}
            primary={workspace === "analysis" && canAnalyze && currentProject ? (
              <MissionAnalysis key={`${currentProject.id}-${currentSite?.id ?? "center"}-${analysisPreview?.arrival ?? "saved"}`}
                latitude={probePoint?.latitude ?? currentSite!.latitude}
                longitude={probePoint?.longitude ?? currentSite!.longitude}
                arrivalUtc={analysisPreview?.projectId === currentProject.id && analysisPreview.siteId === currentSite?.id ? analysisPreview.arrival : currentProject.arrival_utc}
                durationHours={analysisPreview?.projectId === currentProject.id && analysisPreview.siteId === currentSite?.id ? analysisPreview.duration : currentProject.duration_hours}
                siteName={probePoint ? "Inspected point" : `${currentSite!.name}${analysisPreview?.projectId === currentProject.id && analysisPreview.siteId === currentSite?.id ? " · date preview (unsaved)" : ""}`} map={mapView}
                elapsedHours={selectedMissionHours} onElapsedChange={setSelectedMissionHours} />
            ) : mapView}
            secondary={workspace === "statistics" && currentProject ? (
              <div className="orbis-scroll h-full overflow-y-auto overscroll-contain bg-[#252525] p-2.5 sm:p-3">
                <VisibilityStatistics key={currentProject.id}
                  latitude={currentSite?.latitude ?? currentProject.center_latitude}
                  longitude={currentSite?.longitude ?? currentProject.center_longitude}
                  arrivalUtc={currentProject.arrival_utc} durationHours={currentProject.duration_hours}
                  siteName={currentSite?.name ?? "Search center"} project={currentProject} probePoint={probePoint}
                  elapsedHours={selectedMissionHours} onElapsedChange={setSelectedMissionHours}
                  onSelectSite={siteId => {
                    const site = currentProject.sites.find(item => item.id === siteId);
                    setSelected({ projectId: currentProject.id, siteId });
                    setProbePoint(null);
                    setHiddenProjects(current => current.filter(id => id !== currentProject.id));
                    if (site) focusMap(site);
                  }}
                  onSaveCandidate={saveInspectedPoint}
                  onProbePoint={point => {
                    setProbePoint(point);
                    setProbeMode(false);
                    if (point) focusMap(point);
                  }}
                  onProbeMode={enabled => { setWorkspace("map"); setProbeMode(enabled); }}
                  onSaveMission={changes => saveMissionSettings(currentProject.id, changes)}
                  onRegions={(projectId, areas, grid, spacing) => setRegions({ projectId, areas, grid, spacing })} />
              </div>
            ) :
              <div className="orbis-scroll h-full overflow-y-auto overscroll-contain bg-[#252525] p-2.5 sm:p-3">
                <div className="mx-auto max-w-[1200px] border border-[#454b50] bg-[#242424] p-3">
                <div className="mb-3 border-b border-[#444]">
                  <h2 className="pb-3 text-base font-semibold text-white">Explore</h2>
                  <div role="tablist" aria-label="Explore tools" className="grid w-full grid-cols-3 bg-[#292929]">
                    <button type="button" id="explore-candidates-tab" role="tab" aria-controls="explore-candidates-panel" aria-selected={exploreMode === "candidates"}
                      onClick={() => setExploreMode("candidates")}
                      onKeyDown={event => { if (event.key === "ArrowRight") { setExploreMode("resilience"); document.getElementById("explore-resilience-tab")?.focus(); } }}
                      className={`min-w-0 min-h-11 border-b-2 border-r border-r-[#444] px-2 text-[11px] sm:px-3 sm:text-xs ${exploreMode === "candidates" ? "border-b-accent bg-[#303b40] text-white" : "border-b-transparent text-[#bbb] hover:bg-[#383838]"}`}>Candidate search</button>
                    <button type="button" id="explore-resilience-tab" role="tab" aria-controls="explore-resilience-panel" aria-selected={exploreMode === "resilience"}
                      onClick={() => setExploreMode("resilience")}
                      onKeyDown={event => { if (event.key === "ArrowLeft") { setExploreMode("candidates"); document.getElementById("explore-candidates-tab")?.focus(); } else if (event.key === "ArrowRight") { setExploreMode("windows"); document.getElementById("explore-windows-tab")?.focus(); } }}
                      className={`min-w-0 min-h-11 border-b-2 border-r border-r-[#444] px-2 text-[11px] sm:px-3 sm:text-xs ${exploreMode === "resilience" ? "border-b-accent bg-[#303b40] text-white" : "border-b-transparent text-[#bbb] hover:bg-[#383838]"}`}>Resilience explorer</button>
                    <button type="button" id="explore-windows-tab" role="tab" aria-controls="explore-windows-panel" aria-selected={exploreMode === "windows"}
                      onClick={() => setExploreMode("windows")}
                      onKeyDown={event => { if (event.key === "ArrowLeft") { setExploreMode("resilience"); document.getElementById("explore-resilience-tab")?.focus(); } }}
                      className={`min-w-0 min-h-11 border-b-2 px-2 text-[11px] sm:px-3 sm:text-xs ${exploreMode === "windows" ? "border-b-accent bg-[#303b40] text-white" : "border-b-transparent text-[#bbb] hover:bg-[#383838]"}`}>Landing windows</button>
                  </div>
                </div>
                <div id="explore-candidates-panel" role="tabpanel" aria-labelledby="explore-candidates-tab" hidden={exploreMode !== "candidates"}>
                  <ExploreSearch area={exploreArea} uncertainty={landingUncertainty} onUncertaintyChange={setLandingUncertainty} prefill={candidatePrefill}
                    onAreaChange={area => { setExploreArea(area); setRegions(null); }}
                    onRegions={(areas, grid, spacing) => setRegions({ projectId: null, areas, grid, spacing })}
                    onCreateProject={createFromExplore} />
                </div>
                <div id="explore-resilience-panel" role="tabpanel" aria-labelledby="explore-resilience-tab" hidden={exploreMode !== "resilience"}>
                  <ResilienceExplorer projects={projects} initialProjectId={currentProject?.id} />
                </div>
                <div id="explore-windows-panel" role="tabpanel" aria-labelledby="explore-windows-tab" hidden={exploreMode !== "windows"}>
                  <OptimalLandingWindow projects={projects} initialProjectId={currentProject?.id} initialSiteId={currentSite?.id}
                    uncertaintyM={landingUncertainty} onInspect={inspectArrival} onApply={applyArrival}
                    onSearchArea={(latitude, longitude, arrival, duration, darkness, earthOutage) => {
                      setExploreArea({ latitude, longitude, radius_m: Math.max(2000, Math.min(20000, landingUncertainty * 2)) });
                      setRegions(null);
                      setCandidatePrefill(current => ({ revision: (current?.revision ?? 0) + 1, arrival, duration, darkness, earthOutage }));
                      setExploreMode("candidates");
                    }} />
                </div>
                </div>
              </div>
            }
          />
        </main>
        <aside className={`relative min-h-0 flex-col border-l border-[#505050] bg-[#303336] ${inspectorOpen ? "hidden lg:flex" : "hidden"}`}>
          {inspector}
          {inspectorOpen && resizeHandle("inspector")}
        </aside>
      </div>

      {(drawer || displayedDrawer) && (
        <div
          className={`orbis-drawer-backdrop fixed inset-0 z-40 flex bg-black/60 ${drawer ? "" : "orbis-drawer-backdrop-out pointer-events-none"}`}
          onClick={() => setDrawer(null)}
        >
          <aside
            className={`flex h-full w-[min(85vw,320px)] flex-col bg-[#3b3b3b] ${(drawer ?? displayedDrawer) === "inspector" ? "orbis-drawer-right ml-auto border-l border-[#555]" : "orbis-drawer-left border-r border-[#555]"} ${drawer ? "" : "orbis-drawer-out"}`}
            onClick={(event) => event.stopPropagation()}
          >
            {(drawer ?? displayedDrawer) === "browse" ? browse : inspector}
          </aside>
        </div>
      )}

      {(dialog || deleting) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDialog(null);
              setDeleting(null);
            }
          }}
        >
          <form
            className="w-full max-w-sm border border-[#555] bg-[#353535] text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void (deleting ? remove() : submit());
            }}
          >
            <div className="flex items-center justify-between border-b border-[#555] px-4 py-3">
              <span>
                {deleting
                  ? "Delete item"
                  : dialog?.action === "project"
                    ? "Create Project"
                    : dialog?.action === "site"
                      ? "Add Landing Site"
                      : "Rename"}
              </span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setDialog(null);
                  setDeleting(null);
                }}
              >
                <X size={16} />
              </button>
            </div>
            {deleting ? (
              <p className="p-4">
                Delete <strong className="[overflow-wrap:anywhere]">{targetName(deleting)}</strong>?
                {!deleting.siteId && (
                  <span className="mt-2 block text-xs text-[#aaa]">
                    All its landing sites will also be deleted.
                  </span>
                )}
              </p>
            ) : (
              <div className="p-4">
                <label className="block text-xs text-[#aaa]">
                  Name
                  <input
                    autoFocus
                    required
                    maxLength={100}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-2 w-full border border-[#555] bg-[#292929] p-2 text-white outline-none focus:border-accent"
                  />
                </label>
              </div>
            )}
            {error && (
              <p role="alert" className="px-4 pb-2 text-xs text-[#ef9292]">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-[#555] p-3">
              <button
                type="button"
                onClick={() => {
                  setDialog(null);
                  setDeleting(null);
                }}
                className="px-3 py-1.5 text-[#bbb]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className={`px-3 py-1.5 text-white disabled:opacity-50 ${deleting ? "bg-[#b94f4f]" : "bg-accent"}`}
              >
                {deleting
                  ? "Delete"
                  : dialog?.action === "rename"
                    ? "Save"
                    : dialog?.action === "site"
                      ? "Add"
                      : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
