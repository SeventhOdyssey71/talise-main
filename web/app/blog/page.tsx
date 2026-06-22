import Link from "next/link";

export const dynamic = "force-dynamic";

type Post = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  tag: string;
  cover: string;
};

// Single source of truth for the index. Add new posts here.
const POSTS: Post[] = [
  {
    slug: "introducing-talise",
    title: "Introducing Talise",
    excerpt:
      "A dollar wallet that feels like a messaging app. Hold real dollars, send them to a name, and cash out at home. No gas, no seed phrase, no bank.",
    date: "June 22, 2026",
    readTime: "5 min read",
    tag: "Announcement",
    cover: "/blog/move-freely.png",
  },
];

export default function BlogIndex() {
  const [featured, ...rest] = POSTS;
  return (
    <main className="mx-auto max-w-[1500px] px-6 pb-12 pt-16 md:px-12 md:pt-20">
      {/* page heading */}
      <div className="max-w-[640px]">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#15300c]/15 bg-white/60 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#3d7a29] backdrop-blur-sm">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#3d7a29]" /> The Talise blog
        </div>
        <h1
          className="text-[clamp(34px,6vw,64px)] font-[800] uppercase leading-[0.95] tracking-[-0.02em]"
          style={{ fontFamily: "var(--font-display-v2)" }}
        >
          Notes from the build
        </h1>
        <p
          className="mt-4 max-w-[480px] text-[14px] leading-[1.7] text-[#3a5230]"
          style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
        >
          Product, design, and the story of making money move like a message.
        </p>
      </div>

      {/* featured post */}
      {featured && (
        <Link
          href={`/blog/${featured.slug}`}
          className="group mt-12 block overflow-hidden rounded-[28px] border border-[#15300c]/10 bg-white/55 backdrop-blur-sm transition-transform hover:-translate-y-1 md:grid md:grid-cols-[1.1fr_1fr]"
        >
          <div className="relative aspect-[16/10] overflow-hidden md:aspect-auto md:h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={featured.cover}
              alt={featured.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          </div>
          <div className="flex flex-col justify-center gap-4 p-7 md:p-10">
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#3d7a29]">
              <span className="rounded-full bg-[#CAFFB8] px-2.5 py-1 text-[#15300c]">
                {featured.tag}
              </span>
              <span>{featured.date}</span>
            </div>
            <h2
              className="text-[clamp(26px,3.4vw,40px)] font-[800] leading-[1.04] tracking-[-0.01em]"
              style={{ fontFamily: "var(--font-display-v2)" }}
            >
              {featured.title}
            </h2>
            <p
              className="text-[14px] leading-[1.7] text-[#3a5230]"
              style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
            >
              {featured.excerpt}
            </p>
            <span
              className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-[500] uppercase tracking-[0.1em] text-[#15300c]"
              style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
            >
              Read the post
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </span>
          </div>
        </Link>
      )}

      {/* more posts grid (empty for now) */}
      {rest.length > 0 && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {rest.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="group block overflow-hidden rounded-[24px] border border-[#15300c]/10 bg-white/55 p-6 backdrop-blur-sm transition-transform hover:-translate-y-1"
            >
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#3d7a29]">
                <span>{p.tag}</span> · <span>{p.date}</span>
              </div>
              <h3
                className="mt-3 text-[22px] font-[800] leading-[1.1]"
                style={{ fontFamily: "var(--font-display-v2)" }}
              >
                {p.title}
              </h3>
              <p className="mt-2 text-[15px] leading-[1.5] text-[#3a5230]">{p.excerpt}</p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
