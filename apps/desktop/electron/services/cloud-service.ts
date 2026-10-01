import { ServiceTracker, messageOf, type Service, type ServiceStatus } from "./base.js";

// cloud-service (04-target-architecture section 1): optional Govee cloud
// metadata only. It may fetch device catalogs and qualification metadata;
// it must never carry show frames (the ownership table gives every frame path
// to the show host govee-manager). Disabled unless explicitly enabled, with
// or without an API key: live shows never depend on the cloud.

export interface GoveeCloudDevice {
  device: string;
  sku: string;
  name: string;
  firmware?: string;
}

export interface GoveeCloudTransport {
  name: string;
  devices(apiKey: string): Promise<GoveeCloudDevice[]>;
}

export interface CloudServiceOptions {
  enabled?: boolean;
  apiKey?: string;
  transport?: GoveeCloudTransport;
}

export interface CloudDevicesReply {
  ok: true;
  devices: GoveeCloudDevice[];
}

export interface CloudFailure {
  ok: false;
  error: { code: string; message: string };
}

export class CloudService implements Service {
  readonly name = "cloud-service";
  private readonly tracker = new ServiceTracker("cloud-service");
  private lastDevices: GoveeCloudDevice[] = [];
  private readonly opts: CloudServiceOptions;

  constructor(opts: CloudServiceOptions = {}) {
    this.opts = opts;
  }

  start(): ServiceStatus {
    if (this.opts.enabled !== true) {
      this.tracker.set("degraded", "optional cloud metadata disabled (config or flag); frames never use the cloud");
      return this.status();
    }
    if (this.opts.transport === undefined) {
      this.tracker.set("degraded", "no cloud transport configured");
      return this.status();
    }
    if (this.opts.apiKey === undefined || this.opts.apiKey === "") {
      this.tracker.set("degraded", "no Govee cloud API key configured");
      return this.status();
    }
    this.tracker.set("running", `metadata via ${this.opts.transport.name}; frames never use the cloud`);
    return this.status();
  }

  stop(): ServiceStatus {
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("enabled", this.opts.enabled === true ? 1 : 0);
    this.tracker.setCounter("devices", this.lastDevices.length);
    return this.tracker.status();
  }

  async devices(): Promise<CloudDevicesReply | CloudFailure> {
    if (this.opts.enabled !== true || this.opts.transport === undefined) {
      return { ok: false, error: { code: "E_CLOUD_DISABLED", message: "cloud metadata is disabled; enable it in settings to fetch device metadata" } };
    }
    if (this.opts.apiKey === undefined || this.opts.apiKey === "") {
      return { ok: false, error: { code: "E_CLOUD_NO_KEY", message: "no Govee cloud API key configured" } };
    }
    try {
      const devices = await this.opts.transport.devices(this.opts.apiKey);
      this.lastDevices = devices;
      this.tracker.count("fetches");
      return { ok: true, devices };
    } catch (err) {
      this.tracker.count("failures");
      return { ok: false, error: { code: "E_CLOUD_FETCH", message: messageOf(err) } };
    }
  }

  // Metadata is all this service exposes: there is deliberately no frame,
  // turn or brightness method here.
  deviceMetadata(): GoveeCloudDevice[] {
    return this.lastDevices.map((d) => ({ ...d }));
  }
}

let instance: CloudService | null = null;

export function getCloudService(opts: CloudServiceOptions = {}): CloudService {
  instance ??= new CloudService(opts);
  return instance;
}
