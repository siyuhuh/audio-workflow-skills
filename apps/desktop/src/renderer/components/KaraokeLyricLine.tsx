import { type CSSProperties, useMemo } from "react";
import { motion } from "motion/react";
import { motionDuration, motionEase } from "../lib/motion";
import { type Cue, inferTimedWords, wordProgressForTime } from "../lib/lyrics";

export type LyricEffect = "outline" | "sweep" | "neon" | "impact";
export type LyricFont = "rounded" | "poster" | "serif" | "mono";

interface KaraokeLyricLineProps {
  cue: Cue | null;
  currentTime: number;
  effect: LyricEffect;
}

export function KaraokeLyricLine({ cue, currentTime, effect }: KaraokeLyricLineProps) {
  const words = useMemo(
    () =>
      cue
        ? cue.words?.length
          ? cue.words
          : inferTimedWords(cue, "active")
        : [
            {
              id: "empty-cue",
              text: "Play to start lyrics.",
              start: 0,
              end: 0
            }
          ],
    [cue]
  );

  return (
    <motion.strong
      className="karaokeLyricLine"
      data-effect={effect}
      data-empty={!cue}
      initial={{ opacity: 0, y: 18, scale: effect === "impact" ? 0.92 : 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: motionDuration.base, ease: motionEase }}
    >
      {words.map((word) => {
        const progressPercent = `${Math.round(wordProgressForTime(word, currentTime) * 1000) / 10}%`;
        const style = { "--word-progress": progressPercent } as CSSProperties;
        const isActive = currentTime >= word.start && currentTime < word.end;

        return (
          <span
            key={word.id}
            className="karaokeWord"
            data-active={isActive}
            data-compact={word.compact}
            style={style}
          >
            <span className="karaokeWordBase">{word.text}</span>
            <span className="karaokeWordFill" aria-hidden="true">
              {word.text}
            </span>
          </span>
        );
      })}
    </motion.strong>
  );
}
