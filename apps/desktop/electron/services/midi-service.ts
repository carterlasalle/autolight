import { CC, NOTE, classifyCC, type Flx4Hint } from "@autolight/controller-flx4";
import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";

// midi-service (04-target-architecture section 1, DS-13): owns the FLX4 MIDI
// input. MIDI is secondary truth (spec 11): it produces director hints
// (fader rise, filter sweep, transport edges) and never sets the playhead.
// The backend is a port because the MIDI runtime is platform specific.

export interface MidiBackend {
  open(onMessage: (message: { cc?: number; note?: number; value: number }) => void): void;
  close(): void;
  name: string;
}

export interface MidiServiceOptions {
  openBackend?: () => MidiBackend;
}

export interface TransportHint {
  kind: "transport";
  control: keyof typeof NOTE;
  on: boolean;
}

// NOTE is const-typed; its keys are the transport control names, and both the
// backend callback and the direct injection path need the reverse lookup.
const NOTE_CONTROLS = Object.keys(NOTE) as (keyof typeof NOTE)[];

function controlForNote(note: number): keyof typeof NOTE | undefined {
  return NOTE_CONTROLS.find((control) => NOTE[control] === note);
}

export class MidiService implements Service {
  readonly name = "midi-service";
  private readonly tracker = new ServiceTracker("midi-service");
  private backend: MidiBackend | null = null;
  private hints: Flx4Hint[] = [];
  private readonly listeners = new Set<(hint: Flx4Hint) => void>();
  private readonly opts: MidiServiceOptions;

  constructor(opts: MidiServiceOptions = {}) {
    this.opts = opts;
  }

  start(): ServiceStatus {
    if (this.backend !== null) return this.status();

    let backend: MidiBackend | undefined;

    try {
      backend = this.opts.openBackend?.();

      if (backend === undefined) {
        this.tracker.set("degraded", "no MIDI backend wired (DS-13 backend lands with the FLX4 task)");

        return this.status();
      }

      backend.open((message) => {
        this.tracker.count("messages");

        if (message.cc !== undefined) {
          const hint = classifyCC(message.cc, message.value);

          if (hint !== null) this.publish(hint);

          return;
        }

        if (message.note !== undefined) {
          const control = controlForNote(message.note);

          if (control !== undefined) this.publish({ kind: "transport", control, on: message.value > 0 });
        }
      });
      this.backend = backend;
      this.tracker.set("running", `backend ${backend.name}`);
    } catch (err) {
      try { backend?.close(); } catch { /* open failed; still release the partial handle */ }

      this.tracker.set("degraded", `MIDI backend failed: ${messageOf(err)}`);
    }

    return this.status();
  }

  stop(): ServiceStatus {
    try {
      this.backend?.close();
    } catch { /* teardown never throws */ }

    this.backend = null;
    this.tracker.set("stopped");

    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("backend", this.backend === null ? 0 : 1);
    this.tracker.setCounter("hints", this.hints.length);

    return this.tracker.status();
  }

  onHint(listener: (hint: Flx4Hint) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  latestHints(limit = 16): Flx4Hint[] {
    return this.hints.slice(-limit);
  }

  // Direct CC injection, used by the capture tooling and by tests.
  handleCc(cc: number, value: number): Flx4Hint | null {
    this.tracker.count("messages");
    const hint = classifyCC(cc, value);

    if (hint !== null) this.publish(hint);

    return hint;
  }

  handleNote(note: number, velocity: number): TransportHint | null {
    this.tracker.count("messages");
    const control = controlForNote(note);

    if (control === undefined) return null;
    const hint: TransportHint = { kind: "transport", control, on: velocity > 0 };
    this.publish(hint);

    return hint;
  }

  private publish(hint: Flx4Hint): void {
    this.hints.push(hint);

    if (this.hints.length > 64) this.hints.shift();
    this.tracker.count("hints");

    for (const listener of Array.from(this.listeners)) {
      try { listener(hint); } catch { /* one listener must not block fan-out */ }
    }
  }
}

export const FLX4_CC = CC;

export const FLX4_NOTE = NOTE;

let instance: MidiService | null = null;

export function resetMidiService(): void {
  instance = null;
}

export function getMidiService(opts: MidiServiceOptions = {}): MidiService {
  if (instance !== null && opts.openBackend !== undefined) {
    throw new Error("midi-service already configured: call resetMidiService() first to reconfigure");
  }

  instance ??= new MidiService(opts);

  return instance;
}
