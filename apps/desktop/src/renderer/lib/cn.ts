type ClassValue = string | number | null | false | undefined | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue) => {
    if (!value && value !== 0) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) {
        out.push(text);
      }
    }
  };
  values.forEach(walk);
  return out.join(" ");
}
