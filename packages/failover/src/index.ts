// Failover package surface (T-FOV-01, T-FOV-02).
export {
  authorizeCloudBasic,
  DEFAULT_TRANSPORT_ORDER,
  DEVICE_MODES,
  FRAME_CLASS,
  MODE_PINNED,
  modeAvailability,
  routeFrame,
  selectFrameTransport,
  TRANSPORTS,
} from "./transports.js";
export type {
  DeviceTransportMode,
  FailoverPolicy,
  FixtureTransportConfig,
  FrameClass,
  FrameSink,
  Selection,
  TransportId,
  TransportStatus,
} from "./transports.js";
export {
  CAMPUS_SEQUENCE,
  FailoverMachine,
} from "./machine.js";
export type {
  CampusFault,
  CampusStep,
  FailoverMachineOptions,
  FailoverThresholds,
  HealthSignal,
  MachineState,
  SwitchEvent,
  SwitchObserver,
} from "./machine.js";
