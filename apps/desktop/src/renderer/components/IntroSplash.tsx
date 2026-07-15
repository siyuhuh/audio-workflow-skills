import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { motionDuration, motionEase } from "../lib/motion";

const INTRO_STORAGE_KEY = "vocalflow.introSeen";
const INTRO_HOLD_MS = 2200;

export function shouldShowIntroSplash(): boolean {
  try {
    return window.localStorage.getItem(INTRO_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_STORAGE_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}

interface IntroSplashProps {
  open: boolean;
  onDone: () => void;
}

export function IntroSplash({ open, onDone }: IntroSplashProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const hold = reduceMotion ? 400 : INTRO_HOLD_MS;
    const timer = window.setTimeout(() => {
      setExiting(true);
    }, hold);
    return () => window.clearTimeout(timer);
  }, [open, reduceMotion]);

  function finish() {
    markIntroSeen();
    onDone();
  }

  return (
    <AnimatePresence onExitComplete={finish}>
      {open && !exiting ? (
        <motion.div
          key="intro-splash"
          className="introSplash"
          role="dialog"
          aria-modal="true"
          aria-label={t("common:intro.aria")}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? motionDuration.instant : motionDuration.panel, ease: motionEase }}
          onClick={() => setExiting(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExiting(true);
            }
          }}
          tabIndex={0}
        >
          <motion.div
            className="introSplashGlow"
            aria-hidden="true"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.7, ease: motionEase }}
          />
          <div className="introSplashContent">
            <motion.p
              className="introSplashKicker"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.12, duration: motionDuration.base, ease: motionEase }}
            >
              {t("common:intro.kicker")}
            </motion.p>
            <motion.h1
              className="introSplashTitle"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.22, duration: 0.42, ease: motionEase }}
            >
              <span className="introSplashTitleStrong">Vocal</span>
              <span className="introSplashTitleLight">Flow</span>
            </motion.h1>
            <motion.p
              className="introSplashSubtitle"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.36, duration: motionDuration.base, ease: motionEase }}
            >
              {t("common:intro.subtitle")}
            </motion.p>
            <motion.div
              className="introSplashBar"
              aria-hidden="true"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: reduceMotion ? 0 : 0.48, duration: 0.55, ease: motionEase }}
            />
            <motion.p
              className="introSplashHint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.72 }}
              transition={{ delay: reduceMotion ? 0 : 0.7, duration: motionDuration.base }}
            >
              {t("common:intro.skip")}
            </motion.p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
