/**
 * Placeholder "photos": deterministic SVG facades generated from a seed, tinted with the agency
 * palette. No stock images, so nothing to license.
 */
/** Stable number from a string (FNV-1a), so a building always gets the same drawing. */
export function seedOf(key: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 100_000;
}

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

const FACADES = ["#e9dfd0", "#d9e2dc", "#e6d6cf", "#dcdde4", "#efe6cf", "#d4dbe3"];
const TRIMS = ["#3b3a36", "#2f4a45", "#5a3a2e", "#2d3550"];

export function BuildingArt({
  seed,
  brand,
  accent,
  className,
  label,
  variant,
}: {
  seed: number;
  brand: string;
  accent: string;
  className?: string;
  label: string;
  variant?: "wide" | "tall";
}) {
  const r = rng(seed + 7);
  const kind = seed % 3;
  const facade = FACADES[Math.floor(r() * FACADES.length)];
  const trim = TRIMS[Math.floor(r() * TRIMS.length)];
  const W = 400;
  const H = variant === "tall" ? 480 : 300;
  const ground = H - 36;
  const bw = 170 + Math.floor(r() * 80);
  const bx = 60 + Math.floor(r() * (W - bw - 120));
  const floors = kind === 1 ? 3 : 3 + Math.floor(r() * 3);
  const floorH = Math.min(52, (ground - 70) / floors);
  const top = ground - floors * floorH;
  const cols = kind === 1 ? 3 : 4 + Math.floor(r() * 2);
  const winW = (bw - 24) / cols - 10;
  const sun = { x: 40 + r() * 320, y: 40 + r() * 30 };

  const windows: React.ReactNode[] = [];
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const x = bx + 12 + c * ((bw - 24) / cols) + 5;
      const y = top + f * floorH + 10;
      const lit = r() > 0.72;
      if (f === floors - 1 && c === Math.floor(cols / 2)) continue; // door column
      windows.push(
        <g key={`${f}-${c}`}>
          <rect x={x} y={y} width={winW} height={floorH - 20} rx={kind === 2 ? 1 : 2} fill={lit ? accent : "#9fb2bf"} opacity={lit ? 0.85 : 0.55} />
          {kind !== 2 && <line x1={x + winW / 2} x2={x + winW / 2} y1={y} y2={y + floorH - 20} stroke={facade} strokeWidth={2} />}
          {kind === 2 && f < floors - 1 && <rect x={x - 3} y={y + floorH - 22} width={winW + 6} height={4} fill={trim} />}
        </g>,
      );
    }
  }
  const doorX = bx + 12 + Math.floor(cols / 2) * ((bw - 24) / cols) + 5;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={label} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`sky-${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={brand} stopOpacity={0.22} />
          <stop offset="1" stopColor="#fbf8f2" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#sky-${seed})`} />
      <circle cx={sun.x} cy={sun.y} r={22} fill={accent} opacity={0.25} />
      {/* distant hills */}
      <path d={`M0 ${ground - 40} Q ${W * 0.3} ${ground - 90} ${W * 0.55} ${ground - 50} T ${W} ${ground - 60} V ${ground} H 0 Z`} fill={brand} opacity={0.12} />
      {/* building */}
      <rect x={bx} y={top} width={bw} height={ground - top} fill={facade} />
      {kind === 1 ? (
        <path d={`M${bx - 8} ${top} L${bx + bw / 2} ${top - 46} L${bx + bw + 8} ${top} Z`} fill={trim} />
      ) : (
        <rect x={bx - 6} y={top - 8} width={bw + 12} height={10} fill={trim} />
      )}
      {windows}
      <rect x={doorX} y={ground - floorH + 8} width={winW} height={floorH - 8} fill={trim} rx={kind === 1 ? winW / 2 : 1} />
      <rect x={doorX - 6} y={ground - 4} width={winW + 12} height={4} fill={trim} opacity={0.6} />
      {/* trees */}
      {[0, 1].map((i) => {
        const tx = i === 0 ? bx - 30 - r() * 20 : bx + bw + 30 + r() * 20;
        const th = 40 + r() * 30;
        return (
          <g key={i}>
            <rect x={tx - 2} y={ground - th * 0.5} width={4} height={th * 0.5} fill="#4a4034" />
            <circle cx={tx} cy={ground - th * 0.6} r={th * 0.35} fill="#5f7d5a" opacity={0.9} />
            <circle cx={tx + 10} cy={ground - th * 0.5} r={th * 0.25} fill="#6f8f68" opacity={0.9} />
          </g>
        );
      })}
      <rect y={ground} width={W} height={H - ground} fill="#d8d2c4" />
      <rect y={ground} width={W} height={3} fill="#bfb7a6" />
    </svg>
  );
}
