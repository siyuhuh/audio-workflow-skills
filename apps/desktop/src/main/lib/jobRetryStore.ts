import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { JobOptions } from "../../shared/types.js";

export function retryKey(options: JobOptions): string {
  // Output folders contain a new timestamp on every UI attempt. Credentials
  // participate in identity but are never written to the retry journal.
  const { outputDir: _outputDir, ...identity } = options;
  return createHash("sha256").update(JSON.stringify(Object.entries(identity).sort())).digest("hex");
}

export class JobRetryStore {
  constructor(private filePath: string) {}

  private read(): Record<string, string> {
    if (!existsSync(this.filePath)) return {};
    const data = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (data.version !== 1 || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)) {
      throw new Error("Invalid job retry journal; original file was preserved.");
    }
    for (const [key, value] of Object.entries(data.entries)) {
      if (!/^[a-f0-9]{64}$/.test(key) || typeof value !== "string" || !path.isAbsolute(value)) {
        throw new Error("Invalid retry entry; original file was preserved.");
      }
    }
    return data.entries;
  }

  private write(entries: Record<string, string>): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, entries }), { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.filePath);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  begin(options: JobOptions): { outputDir: string; resumed: boolean } {
    const entries = this.read();
    const key = retryKey(options);
    const previous = entries[key];
    const resumed = Boolean(previous && existsSync(previous));
    const outputDir = resumed ? previous : path.resolve(options.outputDir);
    entries[key] = outputDir;
    this.write(entries);
    return { outputDir, resumed };
  }

  complete(options: JobOptions): void {
    const entries = this.read();
    delete entries[retryKey(options)];
    this.write(entries);
  }
}
