// File hash for track identity (spec 12, T-ID-01).
//
// `library.fileHash.strategy`: `full` hashes the whole file (default, exact);
// `sampled` hashes size plus fixed windows (fast on large libraries, labelled
// weaker: two files that agree on every window still only "probably" match).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type FileHashStrategy = "full" | "sampled";

/** library.fileHash.strategy default. */
export const DEFAULT_FILE_HASH_STRATEGY: FileHashStrategy = "full";

/** Byte windows read by the sampled strategy. First, middle and last. */
export const SAMPLED_WINDOW_BYTES = 64 * 1024;
/** Sampled cap: files larger than this still hash the same windows. */
export const SAMPLED_MAX_BYTES = 256 * 1024 * 1024;

export interface FileHashInput {
  /** Raw file bytes (tests and callers that already read the file). */
  bytes?: Uint8Array;
  /** File size in bytes, used by the sampled strategy header. */
  sizeBytes?: number;
  strategy?: FileHashStrategy;
}

/**
 * Hash file bytes. Full strategy hashes everything; sampled hashes a header
 * of `size:<sizeBytes>` plus the first, middle and last windows so a rename
 * or tag edit still matches while a re-encode does not.
 */
export function fileHashOf(input: FileHashInput): { hash: string; strategy: FileHashStrategy; weak: boolean } {
  const strategy = input.strategy ?? DEFAULT_FILE_HASH_STRATEGY;
  const bytes = input.bytes ?? new Uint8Array(0);
  if (strategy === "full") {
    return { hash: createHash("sha256").update(bytes).digest("hex"), strategy, weak: false };
  }
  const h = createHash("sha256");
  h.update(`size:${input.sizeBytes ?? bytes.length}\n`);
  const w = SAMPLED_WINDOW_BYTES;
  const windows: Uint8Array[] = [bytes.slice(0, w)];
  if (bytes.length > w) {
    const mid = Math.max(0, Math.floor(bytes.length / 2) - Math.floor(w / 2));
    windows.push(bytes.slice(mid, mid + w));
    windows.push(bytes.slice(Math.max(0, bytes.length - w)));
  }
  for (const window of windows) h.update(window);
  return { hash: h.digest("hex"), strategy, weak: true };
}

export interface FileHashFileOptions {
  strategy?: FileHashStrategy;
  /** Read hook so tests inject bytes without touching disk. */
  readFile?: (path: string) => Uint8Array;
}

/** Hash a file on disk by strategy. Throws when the file is unreadable. */
export function fileHashOfPath(path: string, options: FileHashFileOptions = {}): { hash: string; strategy: FileHashStrategy; weak: boolean } {
  const bytes = options.readFile !== undefined ? options.readFile(path) : new Uint8Array(readFileSync(path));
  return options.strategy === undefined ? fileHashOf({ bytes, sizeBytes: bytes.length }) : fileHashOf({ bytes, sizeBytes: bytes.length, strategy: options.strategy });
}
