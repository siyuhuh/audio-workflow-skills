import i18n, { type ResourceLanguage } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enCommon from "./locales/en/common.json";
import enLibrary from "./locales/en/library.json";
import enCapture from "./locales/en/capture.json";
import enPackage from "./locales/en/package.json";
import enRoom from "./locales/en/room.json";
import enSettings from "./locales/en/settings.json";
import zhCommon from "./locales/zh/common.json";
import zhLibrary from "./locales/zh/library.json";
import zhCapture from "./locales/zh/capture.json";
import zhPackage from "./locales/zh/package.json";
import zhRoom from "./locales/zh/room.json";
import zhSettings from "./locales/zh/settings.json";

import type { AppLocale, AudioWorkflowApi } from "../../shared/types";

const STORAGE_KEY = "vocalflow.locale";

export const SUPPORTED_LOCALES: readonly AppLocale[] = ["en", "zh"] as const;

const resources = {
  en: {
    common: enCommon,
    library: enLibrary,
    capture: enCapture,
    package: enPackage,
    room: enRoom,
    settings: enSettings
  },
  zh: {
    common: zhCommon,
    library: zhLibrary,
    capture: zhCapture,
    package: zhPackage,
    room: zhRoom,
    settings: zhSettings
  }
} satisfies Record<AppLocale, Record<string, ResourceLanguage>>;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common", "library", "capture", "package", "room", "settings"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: STORAGE_KEY
    },
    returnNull: false
  });

/**
 * Resolve a system or user locale tag (e.g. `en-US`, `zh-Hans-CN`) to the closest supported app locale.
 */
export function normalizeLocale(value: string | null | undefined): AppLocale | null {
  if (!value) {
    return null;
  }
  const lower = value.toLowerCase();
  if (lower.startsWith("zh")) {
    return "zh";
  }
  if (lower.startsWith("en")) {
    return "en";
  }
  return null;
}

/**
 * Hydrate the language preference from main-process settings + Electron locale,
 * falling back to detector defaults. Persists confirmed user choice via the API.
 */
export async function hydrateLocaleFromHost(api: AudioWorkflowApi): Promise<AppLocale> {
  let resolved: AppLocale | null = null;
  try {
    const settings = await api.getSettings?.();
    resolved = normalizeLocale(settings?.locale ?? null);
  } catch {
    resolved = null;
  }
  if (!resolved) {
    try {
      const systemLocale = await api.getSystemLocale?.();
      resolved = normalizeLocale(systemLocale ?? null);
    } catch {
      resolved = null;
    }
  }
  if (!resolved) {
    resolved = normalizeLocale(i18n.resolvedLanguage ?? i18n.language ?? null) ?? "en";
  }
  if (i18n.resolvedLanguage !== resolved) {
    await i18n.changeLanguage(resolved);
  }
  return resolved;
}

/**
 * Switch language at runtime and persist to user settings + localStorage.
 */
export async function setAppLocale(locale: AppLocale, api?: AudioWorkflowApi): Promise<void> {
  await i18n.changeLanguage(locale);
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage may be unavailable in some contexts; ignore.
  }
  if (api?.setSettings) {
    try {
      await api.setSettings({ locale });
    } catch {
      // Best-effort persistence; localStorage already updated for next launch.
    }
  }
}

export default i18n;
