import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, X } from "lucide-react";

export type Landmark = {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  diameter_km?: number;
  tour_order: number;
  highlight: string;
  description: string;
  image: {
    url: string | null;
    suggested_filename: string;
    alt: string;
    credit: string;
    subject_note: string;
  };
  sources: { coordinates: string; description: string };
};

type Props = {
  landmark: Landmark;
  open: boolean;
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
};

export default function LandmarkCard({ landmark, open, index, total, onPrevious, onNext, onClose, onHoverEnter, onHoverLeave }: Props) {
  const content = useRef<HTMLDivElement>(null);
  const [failedImagePath, setFailedImagePath] = useState<string | null>(null);
  const imagePath = landmark.image.url || `/landmarks/${landmark.image.suggested_filename}`;
  const imageFailed = failedImagePath === imagePath;

  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [landmark.id]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  return <section aria-label={`${landmark.name} landmark information`} aria-hidden={!open} inert={!open}
    onPointerEnter={onHoverEnter} onPointerLeave={onHoverLeave}
    className={`orbis-landmark-card absolute inset-x-2 bottom-2 z-30 flex max-h-[65%] flex-col overflow-hidden border border-[#586269] bg-[#292d30] shadow-[0_8px_26px_#0009] sm:bottom-12 sm:left-3 sm:right-auto sm:max-h-[calc(100%-96px)] sm:w-[min(360px,calc(100%-24px))] ${open ? "orbis-landmark-card-open" : "orbis-landmark-card-closed"}`}>
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#495158] px-3 py-2">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-[#f0a5c7]">Lunar landmark · {index + 1} / {total}</div>
        <h2 className="truncate text-sm font-medium text-white">{landmark.name}</h2>
      </div>
      <button type="button" aria-label="Close landmark" title="Close landmark" onClick={onClose}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-[#b8c1c6] hover:bg-[#40484d] hover:text-white"><X size={17} /></button>
    </div>
    <div ref={content} className="orbis-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-[11px] leading-relaxed">
      <div className="flex h-32 items-center justify-center overflow-hidden bg-[#20272b] text-[#81929b]">
        {imageFailed ? <div className="flex flex-col items-center gap-1 text-center"><ImageOff size={22} /><span>Image unavailable</span></div>
          : <img src={imagePath} alt={landmark.image.alt} onError={() => setFailedImagePath(imagePath)}
            className="h-full w-full object-contain" />}
      </div>
      {!imageFailed && <p className="text-[10px] text-[#9faab0]">{landmark.image.subject_note} · {landmark.image.credit}</p>}
      <p className="font-medium text-[#f0a5c7]">{landmark.highlight}</p>
      <p className="text-[#d4dadd]">{landmark.description}</p>
      <p className="font-mono text-[#aeb8bd]">{Math.abs(landmark.latitude).toFixed(2)}°S · {Math.abs(landmark.longitude).toFixed(2)}°{landmark.longitude < 0 ? "W" : "E"}{landmark.diameter_km ? ` · ${landmark.diameter_km} km across` : ""}</p>
      <p className="text-[10px] text-[#9faab0]">Pink outline shows approximate catalog diameter, not a mapped boundary.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#454d52] pt-2">
        <a href={landmark.sources.coordinates} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[#f0a5c7] hover:underline">USGS feature record <ExternalLink size={12} /></a>
        <a href={landmark.sources.description} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[#f0a5c7] hover:underline">Image and background <ExternalLink size={12} /></a>
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-1 border-t border-[#495158] px-2 py-2">
      <button type="button" onClick={onPrevious} aria-label="Previous landmark" title="Previous landmark"
        className="flex h-9 w-9 items-center justify-center border border-[#576169] text-[#dce4e8] hover:bg-[#40484d]"><ChevronLeft size={17} /></button>
      <button type="button" onClick={onNext} aria-label="Next landmark" title="Next landmark"
        className="flex h-9 w-9 items-center justify-center border border-[#576169] text-[#dce4e8] hover:bg-[#40484d]"><ChevronRight size={17} /></button>
    </div>
  </section>;
}
