import { cn } from "../lib/cn";
import type { Translator } from "../lib/types";

export type AppNavTarget = "home" | "add" | "karaoke";

interface FloatingBottomNavProps {
  active: AppNavTarget;
  karaokeDisabled: boolean;
  contextTitle: string;
  contextSubtitle: string;
  contextAction?: string;
  onHome: () => void;
  onAdd: () => void;
  onKaraoke: () => void;
  t: Translator;
}

const navItemBase =
  "min-h-[38px] rounded-md text-sm font-medium transition-colors duration-150 ease-out " +
  "disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

export function FloatingBottomNav({
  active,
  karaokeDisabled,
  contextTitle,
  contextSubtitle,
  contextAction,
  onHome,
  onAdd,
  onKaraoke,
  t
}: FloatingBottomNavProps) {
  const isKaraoke = active === "karaoke";
  return (
    <aside
      data-active-view={active}
      aria-label={t("common:nav.label")}
      className={cn(
        "fixed right-1/2 z-[45] grid w-[min(440px,calc(100vw-32px))] gap-1 rounded-lg border p-1 backdrop-blur-xl",
        "translate-x-1/2 shadow-[var(--shadow-overlay)]",
        isKaraoke
          ? "bottom-[max(96px,calc(env(safe-area-inset-bottom)+96px))] border-white/15 bg-black/60"
          : "bottom-[max(18px,env(safe-area-inset-bottom))] border-border/85 bg-overlay"
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 pb-1 pt-2">
        <div className="min-w-0">
          <p
            className={cn(
              "m-0 block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium",
              isKaraoke ? "text-white/75" : "text-foreground"
            )}
          >
            {contextTitle}
          </p>
          <span
            className={cn(
              "block overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium",
              isKaraoke ? "text-white/55" : "text-faint"
            )}
          >
            {contextSubtitle}
          </span>
        </div>
        {contextAction ? (
          <strong className="flex-none rounded-full bg-accent-soft px-2 py-[3px] text-xs font-semibold text-accent-strong">
            {contextAction}
          </strong>
        ) : null}
      </div>

      <nav
        aria-label={t("common:nav.label")}
        className="inline-grid grid-cols-[repeat(3,minmax(88px,1fr))] gap-[3px]"
      >
        <NavButton active={active === "home"} onClick={onHome} isKaraoke={isKaraoke}>
          {t("common:nav.home")}
        </NavButton>
        <NavButton active={active === "add"} onClick={onAdd} isKaraoke={isKaraoke}>
          {t("common:nav.add")}
        </NavButton>
        <NavButton
          active={active === "karaoke"}
          onClick={onKaraoke}
          disabled={karaokeDisabled}
          isKaraoke={isKaraoke}
        >
          {t("common:nav.karaoke")}
        </NavButton>
      </nav>
    </aside>
  );
}

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  isKaraoke: boolean;
  children: React.ReactNode;
}

function NavButton({ active, onClick, disabled, isKaraoke, children }: NavButtonProps) {
  return (
    <button
      type="button"
      data-active={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        navItemBase,
        active
          ? "bg-primary text-primary-foreground shadow-xs"
          : isKaraoke
            ? "bg-transparent text-white/75 hover:enabled:bg-white/10"
            : "bg-transparent text-muted-foreground hover:enabled:bg-muted hover:enabled:text-foreground focus-visible:enabled:bg-muted"
      )}
    >
      {children}
    </button>
  );
}
