import { appendFileSync, mkdirSync, existsSync, readFileSync, statSync, renameSync } from "node:fs";
import path from "node:path";

/**
 * Persistent request/response logging (JSON Lines).
 * Entries are appended to <data>/logs/requests.jsonl — one JSON object per
 * line, so they can be grepped/parsed. Logging never throws: a failure to
 * write must not break the app.
 */

const MAX_BYTES = 10 * 1024 * 1024; // rotate past 10 MB

let logDir = "";

/** Testability: point the log store elsewhere (empty = env/cwd default). */
export function setLogDir(dir: string): void {
  logDir = dir;
}

export function logFilePath(): string {
  const dir = logDir || process.env.TABI_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "logs", "requests.jsonl");
}

function rotateIfNeeded(file: string): void {
  try {
    if (existsSync(/* turbopackIgnore: true */ file) && statSync(/* turbopackIgnore: true */ file).size > MAX_BYTES) {
      renameSync(/* turbopackIgnore: true */ file, `${file}.old`);
    }
  } catch {
    // best effort
  }
}

export function logEntry(entry: Record<string, unknown>): void {
  try {
    const file = logFilePath();
    rotateIfNeeded(file);
    mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
    appendFileSync(/* turbopackIgnore: true */ file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // logging must never break the app
  }
}

/** Short unique id correlating all phases of one user request (dev traces). */
export function newTraceId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Last `n` entries (most recent first); optionally filtered by traceId. */
export function readLogTail(n: number, trace?: string): unknown[] {
  try {
    const file = logFilePath();
    if (!existsSync(file)) return [];
    const raw: string = readFileSync(/* turbopackIgnore: true */ file, "utf8");
    const lines = raw.trim().split("\n");
    return lines
      .slice(-n * 4) // keep some headroom when filtering
      .filter((l: string) => {
        if (!trace) return true;
        try {
          return JSON.parse(l).traceId === trace;
        } catch {
          return false;
        }
      })
      .slice(-n)
      .map((l: string) => {
        try {
          return JSON.parse(l);
        } catch {
          return { raw: l.slice(0, 200) };
        }
      })
      .reverse();
  } catch {
    return [];
  }
}
