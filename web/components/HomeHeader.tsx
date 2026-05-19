import { Logo } from "./Logo";

export function HomeHeader({
  email,
  picture,
}: {
  email: string;
  picture: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-surface)]/85 backdrop-blur-md">
      <div className="flex items-center justify-between px-6 py-4 md:px-10">
        <Logo size={26} href="/home" />
        <div className="flex items-center gap-3 text-[12px] text-[var(--color-fg-muted)]">
          {picture && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={picture}
              alt=""
              className="h-7 w-7 rounded-full border border-[var(--color-line)]"
            />
          )}
          <span className="hidden sm:inline">{email}</span>
          <a
            href="/settings"
            className="text-[var(--color-fg-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
          >
            settings
          </a>
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="text-[var(--color-fg-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
            >
              sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
