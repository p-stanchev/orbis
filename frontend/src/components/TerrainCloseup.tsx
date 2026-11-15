import { useEffect, useState } from "react";

type Props = { latitude: number; longitude: number; uncertaintyM: number };

export default function TerrainCloseup({ latitude, longitude, uncertaintyM }: Props) {
  const [failed, setFailed] = useState(false);
  const span = Math.max(2000, Math.min(30000, uncertaintyM * 4));
  const [view, setView] = useState({ latitude, longitude, span });
  useEffect(() => {
    const timer = window.setTimeout(() => setView({ latitude, longitude, span }), 180);
    return () => window.clearTimeout(timer);
  }, [latitude, longitude, span]);
  const source = `/api/terrain/closeup?latitude=${view.latitude.toFixed(6)}&longitude=${view.longitude.toFixed(6)}&span_m=${view.span}`;
  const radius = uncertaintyM / view.span * 100;
  useEffect(() => setFailed(false), [source]);

  return <div className="relative aspect-[2/1] w-full overflow-hidden border border-[#454b50] bg-[#191919]">
    {!failed && <img key={source} src={source} alt="LOLA hillshade near the search center"
      className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />}
    {failed && <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[#aeb8bd]">Terrain closeup unavailable here</div>}
    <div className="pointer-events-none absolute left-2 top-2 bg-[#242424]/90 px-2 py-1 text-[10px] text-white">LOLA terrain closeup</div>
    {uncertaintyM > 0 && <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-accent bg-accent/10"
      style={{ width: `${radius * 2}%` }} />}
    <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2">
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white" />
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white" />
      <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-[#242424]" />
    </div>
    <div className="pointer-events-none absolute bottom-2 right-2 bg-[#242424]/90 px-2 py-1 font-mono text-[10px] text-white">{(view.span / 1000).toFixed(1)} km across</div>
  </div>;
}
