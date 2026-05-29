/**
 * Moodboard collage. Each tile is an absolutely-positioned image with a tilt.
 * Replace src URLs with curated photography or Higgsfield/Midjourney outputs.
 * Coords are tuned for desktop; on mobile most tiles are hidden via `hide` flag.
 */

type Tile = {
  src: string;
  alt: string;
  // Position from edges (use any 2 of top/right/bottom/left)
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  w: number;
  h: number;
  rotate: number; // degrees
  mobile?: boolean; // show on mobile too
};

// TODO: replace with curated moodboard images per docs/WAITLIST_DESIGN.md
// Current set uses Unsplash CDN URLs that match the brief:
// gold, currencies, EM scenes, prism/refraction, market, ledger.
const TILES: Tile[] = [
  {
    src: "https://images.unsplash.com/photo-1610375461246-83df859d849d?auto=format&w=400&q=70",
    alt: "Gold leaf macro",
    top: "8%",
    left: "6%",
    w: 200,
    h: 260,
    rotate: -4,
    mobile: true,
  },
  {
    src: "https://images.unsplash.com/photo-1611288875785-f4a9970f4a0e?auto=format&w=400&q=70",
    alt: "Buenos Aires rooftop",
    top: "14%",
    right: "5%",
    w: 240,
    h: 200,
    rotate: 3,
    mobile: true,
  },
  {
    src: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&w=400&q=70",
    alt: "Currency notes macro",
    top: "44%",
    left: "3%",
    w: 180,
    h: 220,
    rotate: 5,
  },
  {
    src: "https://images.unsplash.com/photo-1604357209793-fca5dca89f97?auto=format&w=400&q=70",
    alt: "Gold coin macro",
    top: "48%",
    right: "8%",
    w: 200,
    h: 200,
    rotate: -3,
  },
  {
    src: "https://images.unsplash.com/photo-1601158935942-52255782d322?auto=format&w=400&q=70",
    alt: "Prism refraction",
    bottom: "10%",
    left: "12%",
    w: 220,
    h: 180,
    rotate: 2,
  },
  {
    src: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&w=400&q=70",
    alt: "Circuit detail",
    bottom: "14%",
    right: "16%",
    w: 180,
    h: 220,
    rotate: -5,
  },
  {
    src: "https://images.unsplash.com/photo-1577415124269-fc1140a69e91?auto=format&w=400&q=70",
    alt: "Open ledger book",
    top: "26%",
    left: "22%",
    w: 160,
    h: 180,
    rotate: -8,
  },
  {
    src: "https://images.unsplash.com/photo-1556742400-b5b7c5121f6c?auto=format&w=400&q=70",
    alt: "Market vendor hands",
    top: "30%",
    right: "22%",
    w: 160,
    h: 200,
    rotate: 6,
  },
];

function tileStyle(t: Tile): React.CSSProperties {
  return {
    position: "absolute",
    top: t.top,
    right: t.right,
    bottom: t.bottom,
    left: t.left,
    width: t.w,
    height: t.h,
    transform: `rotate(${t.rotate}deg)`,
    overflow: "hidden",
    borderRadius: 10,
  };
}

export function MoodboardCollage() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      {TILES.map((t, i) => (
        <div
          key={i}
          className={`tile pointer-events-auto ${t.mobile ? "" : "hidden md:block"}`}
          style={tileStyle(t)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={t.src}
            alt={t.alt}
            loading="lazy"
            width={t.w}
            height={t.h}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ))}
    </div>
  );
}
