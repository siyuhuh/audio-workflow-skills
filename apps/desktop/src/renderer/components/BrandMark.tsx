import logoBgUrl from "../assets/logo-bg.svg";
import logoUrl from "../assets/logo.svg";
import { cn } from "../lib/cn";

interface BrandMarkProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  decorative?: boolean;
}

const sizeClass: Record<NonNullable<BrandMarkProps["size"]>, string> = {
  sm: "brandMark--sm",
  md: "brandMark--md",
  lg: "brandMark--lg"
};

const sizePx: Record<NonNullable<BrandMarkProps["size"]>, number> = {
  sm: 22,
  md: 28,
  lg: 72
};

/** Rounded Frame 3 monogram on olive tile, with Union silhouette as soft backdrop. */
export function BrandMark({ className, size = "md", decorative = true }: BrandMarkProps) {
  const px = sizePx[size];

  return (
    <span
      className={cn("brandMark", sizeClass[size], className)}
      aria-hidden={decorative ? true : undefined}
    >
      <img
        src={logoBgUrl}
        alt=""
        className="brandMarkBg"
        width={px}
        height={px}
        draggable={false}
      />
      <img
        src={logoUrl}
        alt=""
        className="brandMarkFg"
        width={px}
        height={px}
        draggable={false}
      />
    </span>
  );
}
