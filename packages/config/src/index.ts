export { KEYS, defineKey, defaultFor, defaultsObject, defaultsSchema } from "./registry.js";
export type { KeyDef, ConfigKey } from "./registry.js";
export { PersistentConfigStore, validateImportValues, CONFIG_CHANGED } from "./store.js";
export type { ConfigChange, ConfigChangeListener, StoredLayers } from "./store.js";
export { compareKeys, drainLiveQueue, planLiveChange, queueLiveChange } from "./compare.js";
export type { LiveChangePlan, PendingQueue } from "./compare.js";
export { ConfigStore, type Scope } from "./base.js";
export { containsSecretText, isSecretId, redactSecretText, SECRET_IDS, SECRET_STORED_LABEL, SecretVault } from "./secrets.js";
export type { SecretId, SafeStoragePort, SecretBlobStore } from "./secrets.js";
