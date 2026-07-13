import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AccentColor, AppLocale, ThemeMode, UvrDetectionResult } from "../../shared/types";
import { motionDuration, motionEase } from "../lib/motion";
import type { Translator } from "../lib/types";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";
import { LanguageSwitcher } from "./LanguageSwitcher";

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"] as const;
const ACCENT_COLORS: readonly AccentColor[] = ["green", "lime", "mint", "teal"] as const;

const HF_TOKEN_DOCS_URL = "https://huggingface.co/settings/tokens";
/**
 * Best-known mirror for users in mainland China where `huggingface.co` is
 * unreachable without a VPN. Filled into the HF endpoint field by the
 * "Use China mirror" preset button.
 */
const HF_MIRROR_CHINA = "https://hf-mirror.com";
const HF_MIRROR_DOCS_URL = "https://hf-mirror.com/";
const UVR_MODELS_DOCS_URL = "https://github.com/Anjok07/ultimatevocalremovergui#download-the-application";

/** DOM id used by `App.tsx` to scroll/focus the HF token field after a toast action. */
export const HF_TOKEN_FIELD_ID = "settings-hf-token-input";
/** DOM id used by `App.tsx` to scroll/focus the separator-model-dir field after a toast action. */
export const SEPARATOR_MODEL_DIR_FIELD_ID = "settings-separator-model-dir-input";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  locale: AppLocale;
  hfToken: string | null;
  hfEndpoint: string | null;
  separatorModelDir: string | null;
  uvrDetection: UvrDetectionResult | null;
  onThemeModeChange: (themeMode: ThemeMode) => void | Promise<void>;
  onAccentColorChange: (accentColor: AccentColor) => void | Promise<void>;
  onLocaleChange: (locale: AppLocale) => void | Promise<void>;
  onHfTokenChange: (token: string | null) => void | Promise<void>;
  onHfEndpointChange: (endpoint: string | null) => void | Promise<void>;
  onSeparatorModelDirChange: (dir: string | null) => void | Promise<void>;
  /** Open the OS folder picker; resolves to the chosen path or `null`. */
  onPickFolder?: () => Promise<string | null>;
  /** Re-run UVR detection and return the latest payload. */
  onRedetectUvr?: () => Promise<UvrDetectionResult | null>;
  t: Translator;
}

/**
 * Mask everything but the first 4 / last 4 chars of the token preview shown
 * in Settings. Avoids leaking the secret in screenshots / screen recordings.
 */
function previewToken(token: string | null): string {
  if (!token) {
    return "";
  }
  const trimmed = token.trim();
  if (trimmed.length <= 8) {
    return trimmed.replace(/./g, "•");
  }
  return `${trimmed.slice(0, 4)}${"•".repeat(8)}${trimmed.slice(-4)}`;
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
  hfToken,
  hfEndpoint,
  separatorModelDir,
  uvrDetection,
  onThemeModeChange,
  onAccentColorChange,
  onLocaleChange,
  onHfTokenChange,
  onHfEndpointChange,
  onSeparatorModelDirChange,
  onPickFolder,
  onRedetectUvr,
  t
}: SettingsPanelProps) {
  // Local input state lets the user type/edit without firing a save on every
  // keystroke. We sync from props when the drawer opens or when the upstream
  // value changes (e.g. external clear) and only persist on the explicit
  // Save / Clear buttons.
  const [tokenDraft, setTokenDraft] = useState(hfToken ?? "");
  const [endpointDraft, setEndpointDraft] = useState(hfEndpoint ?? "");
  const [modelDirDraft, setModelDirDraft] = useState(separatorModelDir ?? "");
  const [redetecting, setRedetecting] = useState(false);
  useEffect(() => {
    if (open) {
      setTokenDraft(hfToken ?? "");
      setEndpointDraft(hfEndpoint ?? "");
      setModelDirDraft(separatorModelDir ?? "");
    }
  }, [open, hfToken, hfEndpoint, separatorModelDir]);
  const tokenChanged = tokenDraft.trim() !== (hfToken ?? "").trim();
  const endpointChanged = endpointDraft.trim().replace(/\/+$/, "") !== (hfEndpoint ?? "").trim().replace(/\/+$/, "");
  const modelDirChanged = modelDirDraft.trim() !== (separatorModelDir ?? "").trim();
  // The separator-dir field is "auto-managed" when the path on disk matches
  // the shadow folder we materialised from a detected UVR install. Showing a
  // badge here removes the "did the app actually find UVR?" anxiety.
  const usingAutoLink =
    !!uvrDetection?.linkedDir &&
    !!separatorModelDir &&
    uvrDetection.linkedDir === separatorModelDir;

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

            <section
              id="settings-hf-token"
              className="grid gap-3 rounded-lg border border-border bg-muted p-3 shadow-2xs scroll-mt-4"
            >
              <div>
                <h3 className="m-0 text-sm font-semibold text-foreground">
                  {t("settings:hf.title")}
                </h3>
                <p className="mt-1 text-sm font-medium leading-normal text-muted-foreground">
                  {t("settings:hf.description")}
                </p>
              </div>
              <label className="grid gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor={HF_TOKEN_FIELD_ID}>
                {t("settings:hf.fieldLabel")}
                <input
                  id={HF_TOKEN_FIELD_ID}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("settings:hf.placeholder")}
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && tokenChanged) {
                      event.preventDefault();
                      void onHfTokenChange(tokenDraft.trim() || null);
                    }
                  }}
                  className="min-h-10 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                />
              </label>
              {hfToken ? (
                <p className="m-0 text-xs font-medium text-muted-foreground">
                  {t("settings:hf.currentToken", { preview: previewToken(hfToken) })}
                </p>
              ) : (
                <p className="m-0 text-xs font-medium text-muted-foreground">
                  {t("settings:hf.notSet")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void onHfTokenChange(tokenDraft.trim() || null)}
                  disabled={!tokenChanged}
                >
                  {t("settings:hf.save")}
                </Button>
                {hfToken ? (
                  <Button
                    onClick={() => {
                      setTokenDraft("");
                      void onHfTokenChange(null);
                    }}
                  >
                    {t("settings:hf.clear")}
                  </Button>
                ) : null}
                <a
                  className="inline-flex min-h-10 items-center rounded-md border border-transparent bg-transparent px-3 text-sm font-medium text-accent-strong underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  href={HF_TOKEN_DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("settings:hf.helpLink")}
                </a>
              </div>
            </section>

            <section
              id="settings-hf-endpoint"
              className="grid gap-3 rounded-lg border border-border bg-muted p-3 shadow-2xs scroll-mt-4"
            >
              <div>
                <h3 className="m-0 text-sm font-semibold text-foreground">
                  {t("settings:endpoint.title")}
                </h3>
                <p className="mt-1 text-sm font-medium leading-normal text-muted-foreground">
                  {t("settings:endpoint.description")}
                </p>
              </div>
              <label className="grid gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="settings-hf-endpoint-input">
                {t("settings:endpoint.fieldLabel")}
                <input
                  id="settings-hf-endpoint-input"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("settings:endpoint.placeholder")}
                  value={endpointDraft}
                  onChange={(event) => setEndpointDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && endpointChanged) {
                      event.preventDefault();
                      void onHfEndpointChange(endpointDraft.trim() || null);
                    }
                  }}
                  className="min-h-10 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                />
              </label>
              <p className="m-0 text-xs font-medium text-muted-foreground">
                {hfEndpoint
                  ? t("settings:endpoint.current", { endpoint: hfEndpoint })
                  : t("settings:endpoint.notSet")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void onHfEndpointChange(endpointDraft.trim() || null)}
                  disabled={!endpointChanged}
                >
                  {t("settings:endpoint.save")}
                </Button>
                <Button
                  onClick={() => {
                    setEndpointDraft(HF_MIRROR_CHINA);
                    void onHfEndpointChange(HF_MIRROR_CHINA);
                  }}
                  disabled={hfEndpoint === HF_MIRROR_CHINA && endpointDraft === HF_MIRROR_CHINA}
                >
                  {t("settings:endpoint.useChinaMirror")}
                </Button>
                {hfEndpoint ? (
                  <Button
                    onClick={() => {
                      setEndpointDraft("");
                      void onHfEndpointChange(null);
                    }}
                  >
                    {t("settings:endpoint.clear")}
                  </Button>
                ) : null}
                <a
                  className="inline-flex min-h-10 items-center rounded-md border border-transparent bg-transparent px-3 text-sm font-medium text-accent-strong underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  href={HF_MIRROR_DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("settings:endpoint.helpLink")}
                </a>
              </div>
            </section>

            <section
              id="settings-separator-model-dir"
              className="grid gap-3 rounded-lg border border-border bg-muted p-3 shadow-2xs scroll-mt-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="m-0 text-sm font-semibold text-foreground">
                    {t("settings:separator.title")}
                  </h3>
                  <p className="mt-1 text-sm font-medium leading-normal text-muted-foreground">
                    {t("settings:separator.description")}
                  </p>
                </div>
                {usingAutoLink ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-accent-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong"
                    title={uvrDetection?.uvrRoot ?? undefined}
                  >
                    {t("settings:separator.autoBadge", { count: uvrDetection?.modelCount ?? 0 })}
                  </span>
                ) : null}
              </div>
              {usingAutoLink ? (
                <p className="m-0 text-xs font-medium text-muted-foreground">
                  {t("settings:separator.autoBody", {
                    count: uvrDetection?.modelCount ?? 0,
                    model: uvrDetection?.preferredModel ?? "—"
                  })}
                </p>
              ) : null}
              <label className="grid gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor={SEPARATOR_MODEL_DIR_FIELD_ID}>
                {t("settings:separator.fieldLabel")}
                <input
                  id={SEPARATOR_MODEL_DIR_FIELD_ID}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("settings:separator.placeholder")}
                  value={modelDirDraft}
                  onChange={(event) => setModelDirDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && modelDirChanged) {
                      event.preventDefault();
                      void onSeparatorModelDirChange(modelDirDraft.trim() || null);
                    }
                  }}
                  className="min-h-10 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                />
              </label>
              <p className="m-0 text-xs font-medium text-muted-foreground">
                {separatorModelDir
                  ? t("settings:separator.current", { dir: separatorModelDir })
                  : t("settings:separator.notSet")}
              </p>
              <div className="flex flex-wrap gap-2">
                {onPickFolder ? (
                  <Button
                    onClick={async () => {
                      const picked = await onPickFolder();
                      if (picked) {
                        setModelDirDraft(picked);
                        void onSeparatorModelDirChange(picked);
                      }
                    }}
                  >
                    {t("settings:separator.browse")}
                  </Button>
                ) : null}
                <Button
                  onClick={() => void onSeparatorModelDirChange(modelDirDraft.trim() || null)}
                  disabled={!modelDirChanged}
                >
                  {t("settings:separator.save")}
                </Button>
                {separatorModelDir ? (
                  <Button
                    onClick={() => {
                      setModelDirDraft("");
                      void onSeparatorModelDirChange(null);
                    }}
                  >
                    {t("settings:separator.clear")}
                  </Button>
                ) : null}
                {onRedetectUvr ? (
                  <Button
                    onClick={async () => {
                      setRedetecting(true);
                      try {
                        await onRedetectUvr();
                      } finally {
                        setRedetecting(false);
                      }
                    }}
                    disabled={redetecting}
                  >
                    {redetecting ? t("settings:separator.redetecting") : t("settings:separator.redetectUvr")}
                  </Button>
                ) : null}
                <a
                  className="inline-flex min-h-10 items-center rounded-md border border-transparent bg-transparent px-3 text-sm font-medium text-accent-strong underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  href={UVR_MODELS_DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("settings:separator.helpLink")}
                </a>
              </div>
            </section>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
