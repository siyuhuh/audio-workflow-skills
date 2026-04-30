import { type FocusEvent, type MouseEvent, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "../lib/cn";
import type { Translator } from "../lib/types";
import { Icon } from "./ui/Icon";

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
  "relative min-h-9 overflow-hidden rounded-full px-4 text-sm font-semibold transition-colors duration-150 ease-out " +
  "disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

interface HoverFillState {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

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
  const isAdd = active === "add";
  const shouldReduceMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const dockRef = useRef<HTMLElement | null>(null);
  const dragAreaRef = useRef<HTMLDivElement | null>(null);
  const suppressExpandClickRef = useRef(false);
  const suppressExpandClickTimerRef = useRef<number | null>(null);
  const [hoverFill, setHoverFill] = useState<HoverFillState>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false
  });

  const showHoverFill = (target: HTMLElement) => {
    const dock = dockRef.current;
    if (!dock) {
      return;
    }
    const dockRect = dock.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setHoverFill({
      x: targetRect.left - dockRect.left,
      y: targetRect.top - dockRect.top,
      width: targetRect.width,
      height: targetRect.height,
      visible: true
    });
  };

  const hideHoverFill = () => {
    if (dockRef.current?.matches(":focus-within")) {
      return;
    }
    setHoverFill((current) => ({ ...current, visible: false }));
  };

  const handleDockBlur = () => {
    window.setTimeout(() => {
      if (!dockRef.current?.matches(":focus-within")) {
        setHoverFill((current) => ({ ...current, visible: false }));
      }
    }, 0);
  };

  const handleHoverTarget = (event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) => {
    showHoverFill(event.currentTarget);
  };
  const suppressNextExpandClick = () => {
    suppressExpandClickRef.current = true;
    if (suppressExpandClickTimerRef.current !== null) {
      window.clearTimeout(suppressExpandClickTimerRef.current);
    }
    suppressExpandClickTimerRef.current = window.setTimeout(() => {
      suppressExpandClickRef.current = false;
      suppressExpandClickTimerRef.current = null;
    }, 160);
  };
  const handleCollapsedExpandClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressExpandClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressExpandClickRef.current = false;
      return;
    }
    setCollapsed(false);
  };
  const menuTransition = shouldReduceMotion
    ? { duration: 0.01 }
    : { duration: 0.68, type: "tween" as const, ease: [0.76, 0, 0.24, 1] as const };
  const contentTransition = shouldReduceMotion
    ? { duration: 0.01 }
    : { duration: 0.2, ease: [0.23, 1, 0.32, 1] as const };

  return (
    <div ref={dragAreaRef} className="pointer-events-none fixed inset-0 z-[45]">
      <motion.aside
        ref={dockRef}
        layout
        drag={collapsed}
        dragConstraints={dragAreaRef}
        dragElastic={0.08}
        dragMomentum={false}
        onDragStart={() => {
          if (collapsed) {
            suppressExpandClickRef.current = true;
          }
        }}
        onDragEnd={(_, info) => {
          if (collapsed && Math.hypot(info.offset.x, info.offset.y) > 3) {
            suppressNextExpandClick();
          }
        }}
        data-active-view={active}
        data-collapsed={collapsed}
        aria-label={t("common:nav.label")}
        onMouseLeave={hideHoverFill}
        onBlur={handleDockBlur}
        initial={false}
        animate={{
          width: collapsed ? 44 : 286,
          height: collapsed ? 44 : 58,
          borderRadius: 999
        }}
        transition={menuTransition}
        className={cn(
          "floatingDock group fixed z-[45] overflow-hidden rounded-full border backdrop-blur-xl",
          "pointer-events-auto shadow-[var(--shadow-overlay)]",
          isKaraoke
            ? "left-[18px] top-1/2 -translate-y-1/2"
            : "bottom-[max(18px,env(safe-area-inset-bottom))] right-1/2 translate-x-1/2",
          collapsed && "cursor-grab active:cursor-grabbing",
          isKaraoke
            ? "border-white/15 bg-black/60"
            : "border-border/80 bg-overlay/90"
        )}
      >
        <motion.span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 top-0 z-0 rounded-full",
            isKaraoke ? "bg-white/10" : "bg-muted"
          )}
          animate={{
            opacity: hoverFill.visible && !collapsed ? 1 : 0,
            x: hoverFill.x,
            y: hoverFill.y,
            width: hoverFill.width,
            height: hoverFill.height
          }}
          transition={{
            x: { duration: shouldReduceMotion ? 0.01 : 0.22, ease: [0.34, 1.25, 0.52, 1] },
            y: { duration: shouldReduceMotion ? 0.01 : 0.22, ease: [0.34, 1.25, 0.52, 1] },
            width: { duration: shouldReduceMotion ? 0.01 : 0.22, ease: [0.34, 1.25, 0.52, 1] },
            height: { duration: shouldReduceMotion ? 0.01 : 0.22, ease: [0.34, 1.25, 0.52, 1] },
            opacity: { duration: shouldReduceMotion ? 0.01 : 0.12 }
          }}
        />

      <AnimatePresence mode="popLayout" initial={false}>
        {collapsed ? (
          <motion.button
            key="collapsed"
            type="button"
            aria-label={t("common:nav.expand")}
            onClick={handleCollapsedExpandClick}
            initial={{ opacity: 0, scale: 0.72, rotate: -12 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.72, rotate: 12 }}
            transition={contentTransition}
            className={cn(
              "absolute inset-0 z-[2] grid place-items-center border-0 bg-transparent transition-colors active:scale-95",
              isKaraoke ? "text-white/80 hover:text-white" : "text-foreground hover:text-primary"
            )}
          >
            <Icon name="menu" />
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, filter: "blur(6px)", scale: 0.96 }}
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, filter: "blur(6px)", scale: 0.96 }}
            transition={contentTransition}
            className="absolute inset-0 z-[1] flex items-center gap-2 p-2"
          >
            <div
              className={cn(
                "floatingDockTip pointer-events-none absolute bottom-[calc(100%+10px)] left-3 grid min-w-56 max-w-[min(360px,calc(100vw-48px))] gap-1 rounded-lg border px-3 py-2 text-left opacity-0 shadow-sm backdrop-blur-xl",
                "translate-y-1 transition duration-150 ease-out",
                isKaraoke ? "border-white/15 bg-black/72" : "border-border/80 bg-overlay/95"
              )}
              role="status"
            >
              <strong className={cn("text-sm font-semibold", isKaraoke ? "text-white/85" : "text-foreground")}>
                {contextTitle}
              </strong>
              <span className={cn("text-xs font-medium", isKaraoke ? "text-white/55" : "text-faint")}>
                {contextSubtitle}
              </span>
              {contextAction ? (
                <span className="mt-1 w-fit rounded-full bg-accent-soft px-2 py-[3px] text-xs font-semibold text-accent-strong">
                  {contextAction}
                </span>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onAdd}
              onMouseEnter={handleHoverTarget}
              onFocus={handleHoverTarget}
              aria-label={t("common:nav.add")}
              className={cn(
                "relative z-[1] grid size-10 place-items-center overflow-hidden rounded-full border-0 bg-transparent text-foreground transition duration-150 ease-out",
                "active:enabled:scale-95",
                isAdd && "text-primary-foreground",
                isKaraoke && !isAdd && "text-white/75"
              )}
            >
              {isAdd ? (
                <motion.span
                  layoutId="floating-nav-active"
                  className="absolute inset-0 rounded-full bg-primary shadow-sm"
                  transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
                />
              ) : null}
              <Icon name="plus" className="relative z-[1] size-5" />
            </button>

            <motion.nav
              layout
              aria-label={t("common:nav.label")}
              transition={{ type: "spring", stiffness: 500, damping: 32, mass: 0.8 }}
              className="relative z-[1] inline-flex min-h-10 items-center gap-1"
            >
              <NavButton active={active === "home"} onClick={onHome} onHoverTarget={handleHoverTarget} isKaraoke={isKaraoke}>
                {t("common:nav.home")}
              </NavButton>
              <NavButton
                active={active === "karaoke"}
                onClick={onKaraoke}
                onHoverTarget={handleHoverTarget}
                disabled={karaokeDisabled}
                isKaraoke={isKaraoke}
              >
                {t("common:nav.karaoke")}
              </NavButton>
            </motion.nav>

            <button
              type="button"
              aria-label={t("common:nav.minimize")}
              onClick={() => {
                setHoverFill((current) => ({ ...current, visible: false }));
                setCollapsed(true);
              }}
              onMouseEnter={handleHoverTarget}
              onFocus={handleHoverTarget}
              className={cn(
                "relative z-[1] grid size-9 place-items-center rounded-full border-0 bg-transparent text-muted-foreground transition duration-150 ease-out",
                "active:enabled:scale-95 hover:enabled:text-foreground",
                isKaraoke && "text-white/55 hover:enabled:text-white/85"
              )}
            >
              <Icon name="minimize" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      </motion.aside>
    </div>
  );
}

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  onHoverTarget: (event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  isKaraoke: boolean;
  children: React.ReactNode;
}

function NavButton({ active, onClick, onHoverTarget, disabled, isKaraoke, children }: NavButtonProps) {
  return (
    <button
      type="button"
      data-active={active}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onHoverTarget}
      onFocus={onHoverTarget}
      className={cn(
        navItemBase,
        active
          ? "text-primary-foreground"
          : isKaraoke
            ? "bg-transparent text-white/75"
            : "bg-transparent text-muted-foreground hover:enabled:text-foreground"
      )}
    >
      {active ? (
        <motion.span
          layoutId="floating-nav-active"
          className="absolute inset-0 rounded-full bg-primary shadow-sm"
          transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
        />
      ) : null}
      <span className="relative z-[1] inline-flex items-center justify-center">
        {children}
      </span>
    </button>
  );
}
