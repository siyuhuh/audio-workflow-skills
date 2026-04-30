import { AnimatePresence, motion } from "motion/react";
import type { AccentColor, AppLocale, ThemeMode } from "../../shared/types";
import { motionDuration, motionEase } from "../lib/motion";
import type { Translator } from "../lib/types";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";
import { LanguageSwitcher } from "./LanguageSwitcher";

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"] as const;
const ACCENT_COLORS: readonly AccentColor[] = ["green", "lime", "mint", "teal"] as const;

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  locale: AppLocale;
  onThemeModeChange: (themeMode: ThemeMode) => void | Promise<void>;
  onAccentColorChange: (accentColor: AccentColor) => void | Promise<void>;
  onLocaleChange: (locale: AppLocale) => void | Promise<void>;
  t: Translator;
}

const choiceClasses =
  "min-h-10 rounded-md border border-border bg-card text-sm font-medium text-foreground " +
  "transition-colors duration-150 ease-out " +
  "hover:enabled:border-line-strong hover:enabled:bg-muted " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

const choiceSelectedClasses = "border-primary bg-accent-soft text-accent-strong";

export function SettingsPanel({
  open,
  onClose,
  themeMode,
  accentColor,
  locale,
  onThemeModeChange,
  onAccentColorChange,
  onLocaleChange,
  t
}: SettingsPanelProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="settingsPanel"
          role="dialog"
          aria-label={t("settings:title")}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: motionDuration.panel, ease: motionEase }}
          className="fixed inset-0 z-[60] grid grid-cols-[1fr_min(440px,94vw)]"
        >
          <div
            onClick={onClose}
            aria-hidden="true"
            className="cursor-pointer bg-black/35"
          />
          <div className="grid content-start gap-4 overflow-y-auto border-l border-border bg-card p-4 shadow-[var(--shadow-overlay)]">
            <header className="flex items-start justify-between gap-3">
              <div>
                <Eyebrow>{t("settings:eyebrow")}</Eyebrow>
                <h2 className="m-0 text-2xl font-semibold text-foreground">{t("settings:title")}</h2>
              </div>
              <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
            </header>

            <section className="grid gap-3 rounded-lg border border-border bg-muted p-3 shadow-2xs">
              <div>
                <h3 className="m-0 text-sm font-semibold text-foreground">
                  {t("settings:appearance.title")}
                </h3>
                <p className="mt-1 text-sm font-medium leading-normal text-muted-foreground">
                  {t("settings:appearance.description")}
                </p>
              </div>
              <div
                role="group"
                aria-label={t("settings:appearance.modeLabel")}
                className="grid grid-cols-3 gap-2"
              >
                {THEME_MODES.map((mode) => {
                  const selected = mode === themeMode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      data-selected={selected}
                      onClick={() => void onThemeModeChange(mode)}
                      className={cn(choiceClasses, selected && choiceSelectedClasses)}
                    >
                      {t(`settings:appearance.modes.${mode}`)}
                    </button>
                  );
                })}
              </div>
              <div
                role="group"
                aria-label={t("settings:appearance.accentLabel")}
                className="grid grid-cols-2 gap-2"
              >
                {ACCENT_COLORS.map((color) => {
                  const selected = color === accentColor;
                  return (
                    <button
                      key={color}
                      type="button"
                      data-accent={color}
                      data-selected={selected}
                      onClick={() => void onAccentColorChange(color)}
                      className={cn(
                        choiceClasses,
                        "inline-flex items-center justify-start gap-2 px-3",
                        selected && choiceSelectedClasses
                      )}
                    >
                      <span
                        className="block size-3.5 rounded-full bg-primary"
                        data-accent-swatch={color}
                        style={{ boxShadow: "0 0 0 2px color-mix(in srgb, var(--primary) 18%, transparent)" }}
                      />
                      {t(`settings:appearance.accents.${color}`)}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-3 rounded-lg border border-border bg-muted p-3 shadow-2xs">
              <div>
                <h3 className="m-0 text-sm font-semibold text-foreground">
                  {t("settings:language.title")}
                </h3>
                <p className="mt-1 text-sm font-medium leading-normal text-muted-foreground">
                  {t("settings:language.description")}
                </p>
              </div>
              <LanguageSwitcher value={locale} onChange={onLocaleChange} t={t} />
            </section>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
