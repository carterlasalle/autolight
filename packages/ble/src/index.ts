// @autolight/ble: BLE backends, scan, link, commands and sim (T-BLE-01 to T-BLE-04).
//
// Sources: WP04 (which cites govee-toolkit docs/protocol/ble.md, devices
// yaml, govee-homeassistant ble files, Lightwave DISCOVERY.md). No claim
// here measures the owner's units; sim runs prove code, never hardware.
export {
  BLE_A5_MIN_LEN,
  BLE_COLOR_MODE,
  BLE_DEFAULTS,
  BLE_ENCODED_FLAG,
  BLE_FRAME_LEN,
  BLE_HOST_COLOR,
  BLE_MASKED_KIND,
  BLE_NOTIFY_UUID,
  BLE_PAYLOAD_LEN,
  BLE_PROTYPE,
  BLE_READ_CMD,
  BLE_SERVICE_UUID,
  BLE_VERSION_UUID,
  BLE_WRITE_BUDGET_UNMEASURED_BADGE,
  BLE_WRITE_CMD,
  BLE_WRITE_UUID,
} from "./constants.js";
export {
  BackendSelector,
  BleBackendLoadFailure,
  BleBackendUnavailableError,
  LatestWinsChannel,
  bleReasonText,
  createBackendSelector,
  placeBleBackend,
} from "./backends.js";
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
  BleHost,
  BleUnavailableReason,
} from "./backends.js";
export {
  BLE_NOT_ADVERTISING_GUIDANCE,
  bindBleToLan,
  nameFamilyOf,
  normalizeMac,
  parseBleAdvertisement,
  toScanEntry,
} from "./scan.js";
export type {
  BleAdvertisement,
  BleBinding,
  BleBindingBasis,
  BleBindingInputs,
  BleNameFamily,
  BleScanEntry,
  BleScanInput,
} from "./scan.js";
export { BleLink } from "./link.js";
export type { BleClock, BleLinkPerDeviceConfig, BleLinkStatus, BleTimer } from "./link.js";
export {
  BLE_READS,
  bleBrightness,
  bleColorLegacy,
  bleColorMasked,
  bleColorSingle,
  bleHex,
  bleHostColorOne,
  bleHostColorProbe,
  bleInterpolation,
  bleMaskedBrightness,
  blePerZoneBrightness,
  blePower,
  bleRead,
  decodeBleFrame,
  decodeHostColor,
  defaultBleDialect,
  encodeBleFrame,
  encodeHostColor,
  maskForZones,
  parseBleAck,
} from "./commands.js";
export type {
  BleAck,
  BleBrightnessScale,
  BleColorMode,
  BleDialect,
  BleFrame,
  BleRgb,
} from "./commands.js";
export {
  bleBlackoutFrame,
  encodeBleStreamFrame,
  planBleFrame,
} from "./stream.js";
export type { BleStreamEncodeOptions, BleStreamPlan } from "./stream.js";
export {
  BLE_KEYS_NEEDED_COPY,
  encryptedLinkNeed,
} from "./encrypted.js";
export type { BleEncryptedMode, BleEncryptedNeed } from "./encrypted.js";
export {
  SimBleAdapter,
  SimPeripheral,
  simGoldenFrame,
} from "./sim.js";
export type {
  SimAdapterOptions,
  SimPeripheralMetrics,
  SimPeripheralOptions,
} from "./sim.js";
export {
  BLE_PROVISION_PLAINTEXT_WARNING,
  bleProvisionChunk,
  bleProvisionChunks,
  bleProvisionStart,
  bleProvisionStop,
} from "./provisioning.js";
export { streamBleRendererFrame } from "./stream.js";
export type { BleFrameFeedback, BleStreamedFrame } from "./stream.js";
export {
  BLE_V2_HANDSHAKE_CMD,
  BLE_V2_HANDSHAKE_MARK,
  BLE_V2_IV_LEN,
  BLE_V2_TAG_LEN,
  bleHandshakeSeedFrames,
  bleHandshakeV2,
  encodeBleHandshake,
  bleV2Decrypt,
  bleV2Encrypt,
  loadBleKeysFile,
  parseBleKeysFile,
  requireOwnerKeyDecision,
  verifyBleV2Reply,
} from "./encrypted.js";
export type { BleKeyDecision, BleKeysFile, BleV2Key } from "./encrypted.js";
export {
  SIM_NAME_FAMILIES,
  simContractChecks,
  simFamilyPeripherals,
  simGattState,
  simHostColorExpired,
  simProvisionBytes,
} from "./sim.js";
export type { SimContractCheck, SimGatt } from "./sim.js";
export {
  BLE_PROVISION_CHUNK_PACING_MS,
  BLE_PROVISION_START_WAIT_MS,
  bleProvisionPayload,
  provisionBleWifi,
} from "./provisioning.js";
export type {
  BleProvisionCredentials,
  BleProvisionFlowOptions,
  BleProvisionResult,
  BleProvisionTransport,
} from "./provisioning.js";
export { BLE_WIZARD_STEPS, bleQualificationSimReady, blankBleQualification, runBleQualification } from "./qualify.js";
export type {
  BleBudgetBenchmark,
  BleQualificationRecord,
  BleWizardProbe,
  BleWizardStep,
  BleWizardStepResult,
  BleWizardTransport,
  BleWizardUser,
} from "./qualify.js";
