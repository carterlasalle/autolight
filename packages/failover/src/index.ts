// Failover package surface (T-FOV-01, T-FOV-02).

export type {
  DeviceTransportMode,
  FixtureTransportConfig,
  FrameClass,
  FrameSink,
  Selection,
  TransportId,
  TransportStatus,
} from "./transports.js";


export type {
  CampusStep,
  FailoverMachineOptions,
  FailoverThresholds,
  HealthSignal,
  MachineState,
  SwitchEvent,
  SwitchObserver,
} from "./machine.js";
