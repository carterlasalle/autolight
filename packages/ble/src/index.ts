// @autolight/ble: BLE backends, scan, link, commands and sim (T-BLE-01 to T-BLE-04).
//
// Sources: WP04 (which cites govee-toolkit docs/protocol/ble.md, devices
// yaml, govee-homeassistant ble files, Lightwave DISCOVERY.md). No claim
// here measures the owner's units; sim runs prove code, never hardware.


export type {
  BackendSelectorOptions,
  BleAdapter,
  BleBackendKind,
  BleBackendMode,
  BleConnection,
  BleDeviceDecision,
  BleBackendSummary,
  BleNotifyHandler,
  BlePlacement,
  BlePlacementCaps,
  BleUnavailableReason,
} from "./backends.js";


export type {
  BleAdvertisement,
  BleBinding,
  BleBindingInputs,
  BleNameFamily,
  BleScanEntry,
  BleScanInput,
} from "./scan.js";


export type { BleClock, BleLinkPerDeviceConfig, BleLinkStatus, BleTimer } from "./link.js";


export type {
  BleAck,
  BleBrightnessScale,
  BleDialect,
  BleFrame,
  BleRgb,
} from "./commands.js";


export type { BleStreamEncodeOptions, BleStreamPlan } from "./stream.js";


export type { BleEncryptedMode, BleEncryptedNeed } from "./encrypted.js";


export type {
  SimAdapterOptions,
  SimPeripheralMetrics,
  SimPeripheralOptions,
} from "./sim.js";



export type { BleFrameFeedback, BleStreamedFrame } from "./stream.js";


export type { BleKeyDecision, BleKeysFile, BleV2Key } from "./encrypted.js";


export type { SimContractCheck, SimGatt } from "./sim.js";


export type {
  BleProvisionCredentials,
  BleProvisionFlowOptions,
  BleProvisionResult,
  BleProvisionTransport,
} from "./provisioning.js";


export type {
  BleQualificationRecord,
  BleWizardProbe,
  BleWizardStepResult,
} from "./qualify.js";
