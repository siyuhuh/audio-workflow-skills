import { motion } from "motion/react";
import { cn } from "../lib/cn";
import type { Translator } from "../lib/types";
import type { AppLocale } from "../../shared/types";
import { SUPPORTED_LOCALES } from "../i18n";

interface LanguageSwitcherProps {
  value: AppLocale;
  onChange: (next: AppLocale) => void | Promise<void>;
  t: Translator;
}

export function LanguageSwitcher({ value, onChange, t }: LanguageSwitcherProps) {
  return (
    <div
      role="group"
      aria-label={t("common:language.label")}
      className="relative grid grid-cols-2 rounded-md border border-border bg-card p-1 shadow-2xs"
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const selected = locale === value;
        return (
          <button
            key={locale}
            type="button"
            data-selected={selected}
            aria-pressed={selected}
            onClick={() => void onChange(locale)}
            className={cn(
              "relative min-h-9 min-w-28 rounded-md px-4 text-sm font-semibold transition-colors duration-150 ease-out",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              selected
                ? "text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {selected ? (
              <motion.span
                layoutId="language-switcher-active"
                className="absolute inset-0 rounded-md bg-primary shadow-xs"
                transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
              />
            ) : null}
            <span className="relative z-[1]">
              {locale === "en" ? t("common:language.english") : t("common:language.chinese")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
