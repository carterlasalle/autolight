// Synthetic Serato fixture library generator (T-SER-04).
//
// The work package asks for a generator script under tools/fixtures/, but that
// directory is outside this slice, so the generator lives here next to the
// readers it feeds. Tests call makeSeratoFixtureLibrary() into a temp dir and
// never hand-edit the bytes. The writers below satisfy serato-connect's own
// parsers (parseDatabaseSync, parseCrateSync), which keeps the fixtures honest:
// if the writer drifts from the real format, the dependency's parser rejects
// the fixture.
//
// Format notes (all integers big-endian):
// - database V2: vrsn record, then otrk records. Each otrk holds field
//   records: pfil (path, required), tsng/tart/talb/tgen/tkey (UTF-16BE text),
//   tbpm/tlen/tbit/tsmp/ttyp (UTF-16BE text), bbgl/bmis (1 byte bool),
//   uadd (u32 unix time). Unknown field tags are kept by the reader.
// - .crate: vrsn record, then otrk records each holding one ptrk record with
//   the track path in UTF-16BE. Track order is the file order.
// - .scrate: vrsn record, then rule records. The SmartCrates folder on the
//   owner machine is empty, so no real sample pins the rule layout. The
//   parser in library.ts reads every record generically; this writer emits one
//   text rule record and one unknown record so the tests prove raw retention.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FixtureTrack {
  filePath: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  bpm?: number;
  /** Tags this slice does not model, for the raw retention path (spec 9.5). */
  extraTags?: { tag: string; text: string }[];
}

export interface FixtureCrate {
  name: string;
  trackPaths: string[];
}

export interface FixtureScrate {
  name: string;
  trackPaths: string[];
  textRule?: string;
}

function utf16be(text: string): Buffer {
  const le = Buffer.from(text, "utf16le");
  const out = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    out[i] = le[i + 1] as number;
    out[i + 1] = le[i] as number;
  }
  return out;
}

function record(tag: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(tag, 0, "ascii");
  head.writeUInt32BE(data.length, 4);
  return Buffer.concat([head, data]);
}

function textRecord(tag: string, text: string): Buffer {
  return record(tag, utf16be(text));
}

export function writeDatabaseV2(tracks: readonly FixtureTrack[]): Buffer {
  const parts: Buffer[] = [textRecord("vrsn", "2.0/Serato Scratch LIVE Database")];
  for (const track of tracks) {
    const fields: Buffer[] = [textRecord("pfil", track.filePath)];
    if (track.title !== undefined) fields.push(textRecord("tsng", track.title));
    if (track.artist !== undefined) fields.push(textRecord("tart", track.artist));
    if (track.album !== undefined) fields.push(textRecord("talb", track.album));
    if (track.genre !== undefined) fields.push(textRecord("tgen", track.genre));
    if (track.bpm !== undefined) fields.push(textRecord("tbpm", String(track.bpm)));
    for (const extra of track.extraTags ?? []) fields.push(textRecord(extra.tag, extra.text));
    parts.push(record("otrk", Buffer.concat(fields)));
  }
  return Buffer.concat(parts);
}

export function writeCrate(trackPaths: readonly string[]): Buffer {
  const parts: Buffer[] = [textRecord("vrsn", "1.0/Serato ScratchLive Crate")];
  for (const trackPath of trackPaths) {
    parts.push(record("otrk", textRecord("ptrk", trackPath)));
  }
  return Buffer.concat(parts);
}

export function writeScrate(scrate: FixtureScrate): Buffer {
  const parts: Buffer[] = [textRecord("vrsn", "1.0/Serato ScratchLive SmartCrate")];
  if (scrate.textRule !== undefined) parts.push(textRecord("rrul", scrate.textRule));
  parts.push(record("runk", Buffer.from([0xde, 0xad, 0xbe, 0xef])));
  for (const trackPath of scrate.trackPaths) {
    parts.push(record("otrk", textRecord("ptrk", trackPath)));
  }
  return Buffer.concat(parts);
}

export interface FixtureLibrary {
  root: string;
  tracks: FixtureTrack[];
  crates: FixtureCrate[];
  scrates: FixtureScrate[];
}

export function makeSeratoFixtureLibrary(dir: string, library: FixtureLibrary): string {
  const root = join(dir, "fixture-serato");
  mkdirSync(join(root, "Subcrates"), { recursive: true });
  mkdirSync(join(root, "SmartCrates"), { recursive: true });
  writeFileSync(join(root, "database V2"), writeDatabaseV2(library.tracks));
  for (const crate of library.crates) {
    writeFileSync(join(root, "Subcrates", `${crate.name}.crate`), writeCrate(crate.trackPaths));
  }
  for (const scrate of library.scrates) {
    writeFileSync(join(root, "SmartCrates", `${scrate.name}.scrate`), writeScrate(scrate));
  }
  return root;
}

export function demoLibrary(): FixtureLibrary {
  const tracks: FixtureTrack[] = [
    { filePath: "/music/house-a.mp3", title: "House A", artist: "DJ Test", album: "Fixture", genre: "House", bpm: 124 },
    { filePath: "/music/house-b.mp3", title: "House B", artist: "DJ Test", album: "Fixture", genre: "House", bpm: 126 },
    { filePath: "/music/hiphop-c.mp3", title: "Hip Hop C", artist: "MC Test", album: "Fixture", genre: "Hip-Hop", bpm: 95 },
  ];
  return {
    root: "",
    tracks,
    crates: [{ name: "Evening", trackPaths: ["/music/house-b.mp3", "/music/house-a.mp3"] }],
    scrates: [{ name: "Smart House", trackPaths: [], textRule: "genre is House" }],
  };
}
