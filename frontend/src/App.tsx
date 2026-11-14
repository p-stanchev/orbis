import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MapPin,
  Menu,
  MoreHorizontal,
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

type Site = { id: string; name: string; latitude: number; longitude: number };
type Project = { id: string; name: string; arrival_utc: string; duration_hours: number; sites: Site[] };
type Target = { projectId: string; siteId?: string };
type Dialog = { action: "project" | "site" | "rename"; target?: Target } | null;

type Props = { children: ReactNode; onClick: () => void; title: string };
const VISIBILITY_KEY = "orbis-hidden-projects-v1";

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
}: {
  label: string;
  value: number;
  save: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    setDraft(String(value));
    setError(false);
  }, [value]);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number)) {
      setDraft(String(value));
      return;
    }
    const limit = label === "Latitude" ? 90 : 180;
    const normalized = Math.min(limit, Math.max(-limit, number));
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
      <input
        key={label}
        value={draft}
        type="text"
        inputMode="decimal"
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelled.current = true;
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
        className={`mt-1 w-full border bg-[#292929] p-2 text-white outline-none focus:border-accent ${error ? "border-danger" : "border-[#555]"}`}
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
  save,
}: {
  project: Project;
  save: (changes: { arrival_utc?: string; duration_hours?: number }) => Promise<void>;
}) {
  const [arrival, setArrival] = useState(project.arrival_utc.slice(0, 16));
  const [duration, setDuration] = useState(String(project.duration_hours));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setArrival(project.arrival_utc.slice(0, 16));
    setDuration(String(project.duration_hours));
  }, [project.arrival_utc, project.duration_hours]);

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

  async function saveDuration() {
    if (saving || duration === String(project.duration_hours)) return;
    const hours = Number(duration);
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

  return (
    <div className="space-y-4 p-3 text-xs">
      <p className="break-words font-medium text-white">{project.name}</p>
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
        <input
          type="number"
          min={1}
          max={8760}
          step={1}
          aria-label="Mission duration in hours"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
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
      {error && <p role="alert" className="text-[#ef9292]">{error}</p>}
      {saving && <p className="text-[#aaa]">Saving...</p>}
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [hiddenProjects, setHiddenProjects] =
    useState<string[]>(loadHiddenProjects);
  const [connected, setConnected] = useState(false);
  const [clients, setClients] = useState(0);
  const [selected, setSelected] = useState<Target | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [utc, setUtc] = useState("");
  const [drawer, setDrawer] = useState<"browse" | "inspector" | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);

  useEffect(() => {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(hiddenProjects));
  }, [hiddenProjects]);

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
  const targetName = (target: Target) => {
    const project = projects.find((item) => item.id === target.projectId);
    return target.siteId
      ? (project?.sites.find((site) => site.id === target.siteId)?.name ?? "")
      : (project?.name ?? "");
  };
  const urlFor = (target: Target) =>
    `/api/projects/${target.projectId}${target.siteId ? `/sites/${target.siteId}` : ""}`;
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
        const site = await request<Site>(
          `${urlFor(dialog.target)}/sites`,
          "POST",
          { name: name.trim() },
        );
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
    if (!selected?.siteId) return;
    await request(urlFor(selected), "PATCH", { [field]: value });
    await reload();
  }

  async function moveLandingSite(
    target: Target,
    latitude: number,
    longitude: number,
  ) {
    if (!target.siteId) return;
    await request(urlFor(target), "PATCH", { latitude, longitude });
    await reload();
  }

  async function saveMissionSettings(
    projectId: string,
    changes: { arrival_utc?: string; duration_hours?: number },
  ) {
    await request(`/api/projects/${projectId}`, "PATCH", changes);
    await reload();
  }

  const browse = (
    <>
      <div className="flex h-8 items-center justify-between border-b border-[#484848] px-3 text-xs text-[#b8b8b8]">
        Browse{" "}
        <button
          className="lg:hidden"
          aria-label="Close Browse"
          onClick={() => setDrawer(null)}
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.map((project) => {
          const expandedNow = expanded.includes(project.id) || !!search;
          const isHidden = hiddenProjects.includes(project.id);
          return (
            <div key={project.id} className={isHidden ? "text-[#888]" : ""}>
              <div
                className={`flex h-9 items-center hover:bg-[#484848] ${selected?.projectId === project.id && !selected.siteId ? "bg-[#505050]" : ""}`}
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
                  onClick={() => {
                    setSelected({ projectId: project.id });
                    setDrawer(null);
                  }}
                >
                  <Folder size={14} className="shrink-0" />
                  <span className="truncate">{project.name}</span>
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
                      className={`flex h-8 items-center pl-7 hover:bg-[#484848] ${selected?.siteId === site.id ? "bg-[#505050]" : ""}`}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
                        onClick={() => {
                          setSelected({
                            projectId: project.id,
                            siteId: site.id,
                          });
                          setDrawer(null);
                        }}
                      >
                        <MapPin size={13} className="shrink-0" />
                        <span className="truncate">{site.name}</span>
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
          <button
            className="lg:hidden"
            aria-label="Close Inspector"
            onClick={() => setDrawer(null)}
          >
            <X size={16} />
          </button>
        </span>
      </div>
      {currentSite ? (
        <div className="space-y-3 p-3">
          <p className="break-words text-xs font-medium">{currentSite.name}</p>
          <Coordinate
            key={`${currentSite.id}-lat`}
            label="Latitude"
            value={currentSite.latitude}
            save={(value) => saveCoordinate("latitude", value)}
          />
          <Coordinate
            key={`${currentSite.id}-lon`}
            label="Longitude"
            value={currentSite.longitude}
            save={(value) => saveCoordinate("longitude", value)}
          />
          <p className="text-[11px] text-[#999]">
            Click the map to move this landing site, or drag its marker.
          </p>
        </div>
      ) : currentProject ? (
        <MissionSettings
          key={currentProject.id}
          project={currentProject}
          save={(changes) => saveMissionSettings(currentProject.id, changes)}
        />
      ) : null}
    </>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#3d3d3d] text-[#eee]">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[#505050] bg-[#242424] px-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            className="lg:hidden"
            title="Browse"
            aria-label="Open Browse"
            onClick={() => setDrawer("browse")}
          >
            <Menu size={20} />
          </button>
          <button
            className="flex h-7 items-center gap-1 bg-accent px-2 text-xs font-medium text-white"
            onClick={() => openDialog("project")}
          >
            <Plus size={14} /> CREATE
          </button>
          <div className="flex h-7 min-w-0 items-center border border-[#444] bg-[#353535] px-2">
            <Search size={14} className="shrink-0 text-[#888]" />
            <input
              className="w-20 min-w-0 bg-transparent px-2 text-xs outline-none sm:w-40"
              placeholder="Search"
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
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px] text-[#ccc]">
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
            className="flex items-center gap-1"
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

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        <aside className="hidden min-h-0 flex-col border-r border-[#505050] bg-[#3b3b3b] lg:flex">
          {browse}
        </aside>
        <main
          className="min-h-0 min-w-0 overflow-hidden bg-[#191919]"
          aria-label="Lunar south pole map"
        >
          <LunarMap
            projects={projects}
            hiddenProjectIds={hiddenProjects}
            selected={selected}
            onSelectSite={(target) => {
              setSelected(target);
              setDrawer(null);
            }}
            onMoveSite={moveLandingSite}
          />
        </main>
        <aside className="hidden min-h-0 flex-col border-l border-[#505050] bg-[#3b3b3b] lg:flex">
          {inspector}
        </aside>
      </div>

      {drawer && (
        <div
          className="fixed inset-0 z-40 flex bg-black/60"
          onClick={() => setDrawer(null)}
        >
          <aside
            className={`flex h-full w-[min(85vw,320px)] flex-col bg-[#3b3b3b] ${drawer === "inspector" ? "ml-auto border-l border-[#555]" : "border-r border-[#555]"}`}
            onClick={(event) => event.stopPropagation()}
          >
            {drawer === "browse" ? browse : inspector}
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
                Delete <strong>{targetName(deleting)}</strong>?
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
