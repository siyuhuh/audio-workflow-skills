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
      className="inline-flex rounded-full border border-border bg-card p-[2px] shadow-2xs"
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
              "min-h-7 rounded-full px-3 text-sm font-medium transition-colors duration-150 ease-out",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              selected
                ? "bg-line-strong text-card"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {locale === "en" ? t("common:language.english") : t("common:language.chinese")}
          </button>
        );
      })}
    </div>
  );
}
