// @autolight/track-identity: durable track identity (spec 12, T-ID-01, T-ID-02).
//
// Resolution hierarchy: native library ID + canonical path + file identity +
// decoded-audio fingerprint. Never title/artist alone. Every native ID, path
// and hash ever seen for a TrackId lives in the alias graph, which persists
// in the `track_aliases` table (packages/storage) across restarts.
export * from "./alias.js";
export * from "./fingerprint.js";
export * from "./hash.js";
export * from "./seed.js";
