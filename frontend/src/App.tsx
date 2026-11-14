import { useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, Folder, MapPin, MoreHorizontal,
  Pencil, Plus, Search, Trash2, X,
} from "lucide-react";

type Site = { id: string; name: string; latitude: number; longitude: number };
type Project = { id: string; name: string; sites: Site[] };
type Selection = { projectId: string; siteId?: string };
type Target = { projectId: string; siteId?: string };
type Dialog = { mode: "create-project" | "create-site" | "rename"; target?: Target } | null;

const STORAGE_KEY = "orbis-projects-v1";

function readProjects(): Project[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

type CoordinateField = "latitude" | "longitude";

function CoordinateInput({
  field,
  value,
  onCommit,
}: {
  field: CoordinateField;
  value: number;
  onCommit: (field: CoordinateField, value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const limit = field === "latitude" ? 90 : 180;
    const normalized = Math.min(limit, Math.max(-limit, parsed));
    setDraft(String(normalized));
    onCommit(field, normalized);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={field === "latitude" ? "Latitude" : "Longitude"}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
      className="mt-1 w-full border border-[#555] bg-[#292929] p-1.5 text-white outline-none focus:border-accent"
    />
  );
}

function App() {
  const [projects, setProjects] = useState<Project[]>(readProjects);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [utc, setUtc] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<Target | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Target | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    const update = () => setUtc(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        setDialog(null);
        setDeleteTarget(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const chosenProject = projects.find((p) => p.id === selected?.projectId);
  const chosenSite = chosenProject?.sites.find((s) => s.id === selected?.siteId);
  const menuProject = projects.find((p) => p.id === menu?.projectId);
  const menuSite = menuProject?.sites.find((s) => s.id === menu?.siteId);
  const deletingProject = projects.find((p) => p.id === deleteTarget?.projectId);
  const deletingSite = deletingProject?.sites.find((s) => s.id === deleteTarget?.siteId);

  function openDialog(next: NonNullable<Dialog>, initialName = "") {
    setDialog(next);
    setName(initialName);
    setError("");
    setMenu(null);
  }

  function saveDialog() {
    const title = name.trim();
    if (!dialog || !title) {
      setError("Enter a name.");
      return;
    }

    if (dialog.mode === "create-project") {
      if (projects.some((p) => p.name.toLowerCase() === title.toLowerCase())) {
        setError("A project with that name already exists.");
        return;
      }
      const project: Project = { id: crypto.randomUUID(), name: title, sites: [] };
      setProjects((list) => [...list, project]);
      setSelected({ projectId: project.id });
      setExpanded((list) => [...new Set([...list, project.id])]);
    } else if (dialog.mode === "create-site" && dialog.target) {
      const project = projects.find((p) => p.id === dialog.target?.projectId);
      if (!project) return;
      if (project.sites.some((s) => s.name.toLowerCase() === title.toLowerCase())) {
        setError("A site with that name already exists in this project.");
        return;
      }
      const site: Site = { id: crypto.randomUUID(), name: title, latitude: -89.5, longitude: 0 };
      setProjects((list) => list.map((p) => p.id === project.id ? { ...p, sites: [...p.sites, site] } : p));
      setSelected({ projectId: project.id, siteId: site.id });
      setExpanded((list) => [...new Set([...list, project.id])]);
    } else if (dialog.mode === "rename" && dialog.target) {
      const { projectId, siteId } = dialog.target;
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      if (siteId) {
        if (project.sites.some((s) => s.id !== siteId && s.name.toLowerCase() === title.toLowerCase())) {
          setError("A site with that name already exists in this project.");
          return;
        }
        setProjects((list) => list.map((p) => p.id !== projectId ? p : {
          ...p, sites: p.sites.map((s) => s.id === siteId ? { ...s, name: title } : s),
        }));
      } else {
        if (projects.some((p) => p.id !== projectId && p.name.toLowerCase() === title.toLowerCase())) {
          setError("A project with that name already exists.");
          return;
        }
        setProjects((list) => list.map((p) => p.id === projectId ? { ...p, name: title } : p));
      }
    }
    setDialog(null);
    setName("");
    setError("");
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const { projectId, siteId } = deleteTarget;
    if (siteId) {
      setProjects((list) => list.map((p) => p.id !== projectId ? p : {
        ...p, sites: p.sites.filter((s) => s.id !== siteId),
      }));
      if (selected?.projectId === projectId && selected.siteId === siteId) {
        setSelected({ projectId });
      }
    } else {
      setProjects((list) => list.filter((p) => p.id !== projectId));
      setExpanded((list) => list.filter((id) => id !== projectId));
      if (selected?.projectId === projectId) setSelected(null);
    }
    setDeleteTarget(null);
    setMenu(null);
  }

  function updateSite(field: "latitude" | "longitude", value: number) {
    if (!chosenSite || !chosenProject || !Number.isFinite(value)) return;
    const clamped = field === "latitude" ? Math.min(90, Math.max(-90, value)) : Math.min(180, Math.max(-180, value));
    setProjects((list) => list.map((p) => p.id !== chosenProject.id ? p : {
      ...p,
      sites: p.sites.map((s) => s.id === chosenSite.id ? { ...s, [field]: clamped } : s),
    }));
  }

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sites.some((s) => s.name.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#3d3d3d] font-sans text-[#eeeeee]" onClick={() => menu && setMenu(null)}>
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-[#505050] bg-[#242424] px-1">
        <div className="flex h-full min-w-0 items-center gap-1.5">
          <button type="button" onClick={() => openDialog({ mode: "create-project" })} className="flex h-7 items-center gap-1 bg-accent px-2.5 text-xs font-medium text-white hover:brightness-110">
            <Plus size={14} /> CREATE
          </button>
          <div className="flex h-7 w-40 items-center border border-[#444] bg-[#353535] sm:w-56">
            <Search size={13} className="ml-2 shrink-0 text-[#777]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search projects and sites" className="h-full min-w-0 flex-1 bg-transparent px-2 text-xs outline-none" />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="px-1 text-[#999]"><X size={13} /></button>}
          </div>
        </div>
        <span className="hidden px-2 font-mono text-[10px] text-[#bcbcbc] sm:inline">{utc}</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[155px_minmax(0,1fr)_175px] md:grid-cols-[180px_minmax(0,1fr)_210px] lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        <aside className="min-h-0 overflow-auto border-r border-[#505050] bg-[#3b3b3b]">
          <div className="flex h-7 items-center border-b border-[#484848] px-2 text-[11px] text-[#b8b8b8]">Browse</div>
          {filteredProjects.map((project) => {
            const isExpanded = expanded.includes(project.id) || (search.length > 0 && project.sites.some((s) => s.name.toLowerCase().includes(search.toLowerCase())));
            return (
              <div key={project.id}>
                <div className={`flex h-8 items-center hover:bg-[#484848] ${selected?.projectId === project.id && !selected.siteId ? "bg-[#505050]" : ""}`}>
                  <button type="button" onClick={() => setExpanded((list) => isExpanded ? list.filter((id) => id !== project.id) : [...list, project.id])} aria-label={isExpanded ? "Collapse project" : "Expand project"} className="flex h-full w-6 shrink-0 items-center justify-center text-[#aaa]">
                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <button type="button" onClick={() => setSelected({ projectId: project.id })} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-xs"><Folder size={14} className="shrink-0" /> <span className="truncate">{project.name}</span></button>
                  <button type="button" onClick={() => openDialog({ mode: "create-site", target: { projectId: project.id } }, `Landing Site ${project.sites.length + 1}`)} aria-label={`Add landing site to ${project.name}`} title="Add landing site" className="p-1 text-[#aaa] hover:text-white"><Plus size={14} /></button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setMenu((current) => current?.projectId === project.id && !current.siteId ? null : { projectId: project.id }); }} aria-label={`Project options for ${project.name}`} title="Options" className="p-1 text-[#aaa] hover:text-white"><MoreHorizontal size={15} /></button>
                </div>
                {isExpanded && project.sites.filter((site) => !search || project.name.toLowerCase().includes(search.toLowerCase()) || site.name.toLowerCase().includes(search.toLowerCase())).map((site) => (
                  <div key={site.id} className={`flex h-7 items-center hover:bg-[#484848] ${selected?.projectId === project.id && selected.siteId === site.id ? "bg-[#505050]" : ""}`}>
                    <button type="button" onClick={() => setSelected({ projectId: project.id, siteId: site.id })} className="flex min-w-0 flex-1 items-center gap-1.5 pl-7 text-left text-[11px]"><MapPin size={13} className="shrink-0 text-[#aaa]" /><span className="truncate">{site.name}</span></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setMenu((current) => current?.siteId === site.id ? null : { projectId: project.id, siteId: site.id }); }} aria-label={`Options for ${site.name}`} title="Options" className="p-1 text-[#aaa] hover:text-white"><MoreHorizontal size={15} /></button>
                  </div>
                ))}
                {menu?.projectId === project.id && (
                  <div className="relative z-10 mx-2 mb-1 border border-[#555] bg-[#292929] py-1 text-xs shadow-lg" onClick={(e) => e.stopPropagation()}>
                    {!menu.siteId && <button type="button" onClick={() => openDialog({ mode: "create-site", target: { projectId: project.id } }, `Landing Site ${project.sites.length + 1}`)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#444]"><Plus size={13} /> Add landing site</button>}
                    <button type="button" onClick={() => openDialog({ mode: "rename", target: menu }, menuSite?.name ?? project.name)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#444]"><Pencil size={13} /> Rename</button>
                    <button type="button" onClick={() => { setDeleteTarget(menu); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[#ef9292] hover:bg-[#444]"><Trash2 size={13} /> Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <main className="min-w-0 bg-[#414141]" aria-label="3D lunar workspace" />

        <aside className="min-h-0 overflow-auto border-l border-[#505050] bg-[#3b3b3b]">
          <div className="flex h-7 items-center border-b border-[#484848] px-2 text-[11px] text-[#b8b8b8]">Inspector</div>
          {chosenSite ? (
            <div className="space-y-3 p-3 text-xs">
              <div className="break-words font-medium">{chosenSite.name}</div>
              <label className="block text-[#aaa]">Latitude
                <CoordinateInput key={`${chosenSite.id}-latitude`} field="latitude" value={chosenSite.latitude} onCommit={updateSite} />
              </label>
              <label className="block text-[#aaa]">Longitude
                <CoordinateInput key={`${chosenSite.id}-longitude`} field="longitude" value={chosenSite.longitude} onCommit={updateSite} />
              </label>
              <p className="text-[11px] text-[#999]">3D terrain and analysis will appear here once connected.</p>
            </div>
          ) : chosenProject ? <div className="p-3 text-xs text-[#aaa]">{chosenProject.name}<p className="mt-2 text-[11px]">Select or add a landing site.</p></div> : null}
        </aside>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setDialog(null); }}>
          <form onSubmit={(e) => { e.preventDefault(); saveDialog(); }} className="w-full max-w-sm border border-[#555] bg-[#353535] text-sm">
            <div className="flex items-center justify-between border-b border-[#555] px-4 py-3">
              <span>{dialog.mode === "create-project" ? "Create Project" : dialog.mode === "create-site" ? "Add Landing Site" : "Rename"}</span>
              <button type="button" onClick={() => setDialog(null)} aria-label="Close dialog" className="text-[#aaa] hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4"><label htmlFor="entity-name" className="block text-xs text-[#aaa]">Name</label><input id="entity-name" autoFocus required value={name} onChange={(e) => { setName(e.target.value); setError(""); }} className="mt-2 w-full border border-[#555] bg-[#292929] p-2 outline-none focus:border-accent" />{error && <p role="alert" className="mt-2 text-xs text-[#ef9292]">{error}</p>}</div>
            <div className="flex justify-end gap-2 border-t border-[#555] p-3"><button type="button" onClick={() => setDialog(null)} className="px-3 py-1.5 text-[#bbb] hover:bg-[#444]">Cancel</button><button type="submit" className="bg-accent px-3 py-1.5 text-white hover:brightness-110">{dialog.mode === "rename" ? "Save" : dialog.mode === "create-site" ? "Add" : "Create"}</button></div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div role="dialog" aria-modal="true" aria-label="Confirm deletion" className="w-full max-w-sm border border-[#555] bg-[#353535] text-sm">
            <div className="border-b border-[#555] px-4 py-3">Delete {deleteTarget.siteId ? "Landing Site" : "Project"}</div>
            <p className="p-4">Delete <strong>{deletingSite?.name ?? deletingProject?.name}</strong>?{!deleteTarget.siteId && <span className="mt-2 block text-xs text-[#aaa]">All of this project's landing sites will also be deleted.</span>}</p>
            <div className="flex justify-end gap-2 border-t border-[#555] p-3"><button type="button" onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 text-[#bbb] hover:bg-[#444]">Cancel</button><button type="button" onClick={confirmDelete} className="bg-[#b94f4f] px-3 py-1.5 text-white hover:brightness-110">Delete</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;