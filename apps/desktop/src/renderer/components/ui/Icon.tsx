import { cn } from "../../lib/cn";

export type IconName =
  | "folder"
  | "headphones"
  | "home"
  | "menu"
  | "mic"
  | "minimize"
  | "music"
  | "play"
  | "plus"
  | "qr"
  | "restart"
  | "search"
  | "settings"
  | "sliders"
  | "spark"
  | "rewind"
  | "pause"
  | "trash";

interface IconProps {
  name: IconName;
  className?: string;
}

const paths: Record<IconName, string[]> = {
  folder: ["M3.5 6.5h5l1.4 2h6.6v8h-13z", "M3.5 8.5h15v8h-15z"],
  headphones: ["M4.5 11v-1a5.5 5.5 0 0 1 11 0v1", "M4.5 11.5h2v4h-2z", "M13.5 11.5h2v4h-2z", "M13.5 15.5c0 1-1.2 1.8-3.5 1.8"],
  home: ["M3.5 10.5 10 4l6.5 6.5", "M5.5 9.5v7h9v-7"],
  menu: ["M4.5 6.5h11", "M4.5 10h11", "M4.5 13.5h11"],
  mic: ["M10 3.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 10 3.5Z", "M5 9.5a5 5 0 0 0 10 0", "M10 14.5v3", "M7 17.5h6"],
  minimize: ["M5 10h10"],
  music: ["M7 14.5a2 2 0 1 1-1.2-1.8L15 10.5", "M15 12.5V4.5L7 6.5v8"],
  play: ["M7 5.5v9l7-4.5z"],
  plus: ["M10 4.5v11", "M4.5 10h11"],
  qr: ["M4.5 4.5h4v4h-4z", "M11.5 4.5h4v4h-4z", "M4.5 11.5h4v4h-4z", "M11.5 11.5h1.8", "M15.5 11.5v1.8", "M11.5 15.5h4", "M13.5 13.5h2"],
  restart: ["M6 6.5A5.5 5.5 0 1 1 4.8 12", "M6 3.8v2.7h-2.7"],
  search: ["M9 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z", "m13 13 3.5 3.5"],
  settings: ["M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z", "M3.8 8.2l1.1-1.9 2 .4.9-.5.7-1.9h3l.7 1.9.9.5 2-.4 1.1 1.9-1.3 1.5v1.1l1.3 1.5-1.1 1.9-2-.4-.9.5-.7 1.9h-3l-.7-1.9-.9-.5-2 .4-1.1-1.9 1.3-1.5V9.7Z"],
  sliders: ["M4.5 6.5h5", "M12.5 6.5h3", "M9.5 5v3", "M4.5 13.5h2", "M9.5 13.5h6", "M7.5 12v3"],
  spark: ["M10 3.5 11.6 8 16 10l-4.4 2L10 16.5 8.4 12 4 10l4.4-2Z"],
  rewind: ["M10 6 5.5 10 10 14z", "M15 6l-4.5 4 4.5 4z"],
  pause: ["M7.5 5.5v9", "M12.5 5.5v9"],
  trash: ["M5 6.5h10", "M8 6.5V5h4v1.5", "M6.5 8v7.5h7V8", "M9 9.5v4", "M11 9.5v4"]
};

export function Icon({ name, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={cn("size-4 flex-none", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      {paths[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
