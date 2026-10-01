import type { TrackIdentity } from "@autolight/contracts";
import { resolveIdentity } from "@autolight/track-model";
import { ServiceTracker, type Service, type ServiceStatus } from "./base.js";

// identity-service (04-target-architecture section 1): the TrackId resolver
// chain (DS-22). Native ID, then path, then file hash, then PCM fingerprint;
// never title or artist strings alone. Delegates the chain to
// @autolight/track-model and memoizes resolved identities so the same native
// id keeps one TrackId for the whole session.

export interface IdentityParts {
  rekordboxId?: string;
  seratoPath?: string;
  canonicalPath?: string;
  title?: string;
  artist?: string;
  fileHash?: string;
  pcmFingerprint?: string;
}

export interface IdentityResolution {
  ok: true;
  identity: TrackIdentity;
  cached: boolean;
}

export interface IdentityFailure {
  ok: false;
  error: { code: string; message: string };
}

export class IdentityService implements Service {
  readonly name = "identity-service";
  private readonly tracker = new ServiceTracker("identity-service");
  private readonly cache = new Map<string, TrackIdentity>();

  start(): ServiceStatus {
    this.tracker.set("running", "resolver chain rb id, path, file hash, PCM fingerprint");
    return this.status();
  }

  stop(): ServiceStatus {
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("cached", this.cache.size);
    return this.tracker.status();
  }

  resolve(parts: IdentityParts): IdentityResolution | IdentityFailure {
    const key = parts.rekordboxId ?? parts.seratoPath ?? parts.canonicalPath ?? parts.fileHash ?? parts.pcmFingerprint;
    if (key === undefined) {
      return {
        ok: false,
        error: {
          code: "E_NO_IDENTITY_KEY",
          message: "track identity needs a native id, path, or fingerprint (DS-22); title and artist alone are not identity",
        },
      };
    }
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.tracker.count("hits");
      return { ok: true, identity: cached, cached: true };
    }
    let identity: TrackIdentity;
    try {
      identity = resolveIdentity(parts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.tracker.count("failures");
      return { ok: false, error: { code: "E_IDENTITY_RESOLVE", message } };
    }
    this.cache.set(key, identity);
    this.tracker.count("misses");
    return { ok: true, identity, cached: false };
  }

  cachedIdentities(): TrackIdentity[] {
    return [...this.cache.values()];
  }
}

let instance: IdentityService | null = null;

export function getIdentityService(): IdentityService {
  instance ??= new IdentityService();
  return instance;
}
