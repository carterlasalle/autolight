import { defineKey } from "./registry.js";

// Live-mode change safety (T-CFG-07, spec 144).
// Live-safe keys apply at the next bar (or immediately for emergency keys).
// Unsafe keys are queued while Live is active and applied when the owner
// leaves Live or confirms. The confirmation is a non-modal inline control.

export interface LiveChangePlan {
  key: string;
  liveSafe: boolean;
  apply: "next-bar" | "queued";
  note: string;
}

export function planLiveChange(key: string): LiveChangePlan {
  const def = defineKey(key);
  if (def.liveSafe) {
    return {
      key,
      liveSafe: true,
      apply: "next-bar",
      note: `${key}: live-safe, applies at the next bar`,
    };
  }
  return {
    key,
    liveSafe: false,
    apply: "queued",
    note: `${key}: not live-safe, queued until Live ends or the owner confirms inline (spec 144, never a modal)`,
  };
}

export interface PendingQueue {
  keys: string[];
}

// Unsafe changes requested during Live wait here; leaving Live (or inline
// confirm) applies them in order.
export function queueLiveChange(queue: PendingQueue, key: string): PendingQueue {
  const planned = planLiveChange(key);
  if (planned.apply === "next-bar") return queue;
  if (queue.keys.includes(key)) return queue;
  return { keys: [...queue.keys, key] };
}

export function drainLiveQueue(queue: PendingQueue): { applied: string[]; queue: PendingQueue } {
  return { applied: [...queue.keys], queue: { keys: [] } };
}

// Settings UI support: which keys to compare, grouped for the diff view.
export function compareKeys(a: Record<string, unknown>, b: Record<string, unknown>): { key: string; before: unknown; after: unknown }[] {
  const out: { key: string; before: unknown; after: unknown }[] = [];
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of [...names].sort()) {
    const before = a[key];
    const after = b[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ key, before, after });
  }
  return out;
}
