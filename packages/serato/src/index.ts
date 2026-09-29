// Serato live transport (serato-connect) + disk GEOB complement each other (§3.1).
// Remote → identity/playhead/rate/faders; files → grid/cues/crates.

export interface SeratoCrateEntry { path: string }

// Minimal .crate parser: vrsn header + otrk rows with ptrk UTF-16BE paths.
// Throws on bad magic so corrupt crates fail loudly.
export function parseCrate(buf: Uint8Array): SeratoCrateEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(...buf.slice(0, 4));
  if (magic !== "vrsn") throw new Error(`bad crate magic ${JSON.stringify(magic)}`);
  const readU32 = (o: number): number => v.getUint32(o, false);
  const readTag = (o: number): string => String.fromCharCode(...buf.slice(o, o + 4));
  const vlen = readU32(4);
  let o = 8 + vlen;
  const out: SeratoCrateEntry[] = [];
  const decodePath = (start: number, len: number): string => {
    const raw = buf.slice(start, start + len);
    let s = "";
    for (let i = 0; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw[i]! << 8) | raw[i + 1]!);
    return s;
  };
  while (o + 8 <= buf.length) {
    const tag = readTag(o);
    const len = readU32(o + 4);
    o += 8;
    if (o + len > buf.length) break;
    if (tag === "otrk") {
      let j = o;
      while (j + 8 <= o + len) {
        const it = readTag(j);
        const il = readU32(j + 4);
        j += 8;
        if (j + il > o + len) break;
        if (it === "ptrk") out.push({ path: decodePath(j, il) });
        j += il;
      }
    }
    o += len;
  }
  return out;
}
