// Cloud package surface (T-CLD-01, T-CLD-02).
export {
  API_KEY_HEADER,
  CLOUD_BASE,
  CLOUD_CARRIES_FRAMES,
  CloudApiError,
  CloudDisabledError,
  CloudFrameRejectedError,
  CloudMetadataClient,
  CloudRateLimitError,
  DEVICES_PATH,
  SCENES_PATH,
  ensureNotShowTick,
  parseDeviceEntry,
  parseRateHeaders,
} from "./client.js";
export type {
  CloudAccounting,
  CloudClientOptions,
  CloudDevice,
  CloudFetch,
  CloudFetchRequest,
  CloudFetchResponse,
  CloudRequestOptions,
  CloudScene,
  DeclaredCapabilities,
  RawDeviceEntry,
} from "./client.js";
export {
  compareDeclaredSegments,
  crossCheckQualification,
} from "./cross-check.js";
export type {
  CrossCheckInput,
  CrossCheckOutcome,
  QualificationRetention,
  SegmentComparison,
} from "./cross-check.js";
