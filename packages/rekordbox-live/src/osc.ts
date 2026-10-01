// OSC 1.0 codec (T-LIVE-03). Written from the OSC 1.0 specification message
// grammar: a message is an address pattern, a comma-prefixed type tag string,
// then arguments; every string is NUL-terminated and padded to 4 bytes, every
// 32-bit value is big-endian. Bundles carry "#bundle", an 8-byte timetag and
// size-prefixed elements. No third-party library is used, so rkbx_link's OSC
// output can be decoded from committed golden vectors alone.

export type OscArgument = number | string | Uint8Array;

export interface OscMessage {
  readonly address: string;
  readonly args: readonly OscArgument[];
}

export interface OscDatagram {
  readonly timetag: bigint | null;
  readonly messages: readonly OscMessage[];
  readonly malformed: string[];
}

function assertOffset(data: Uint8Array, offset: number, need: number): void {
  if (offset + need > data.length) throw new RangeError(`truncated OSC element at ${offset}`);
}

function readPaddedString(data: Uint8Array, offset: number): { text: string; next: number } {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  if (end >= data.length) throw new RangeError("unterminated OSC string");
  const text = new TextDecoder().decode(data.subarray(offset, end));
  const next = offset + Math.ceil((end - offset + 1) / 4) * 4;
  assertOffset(data, offset, next - offset);
  return { text, next };
}

// Golden-vector helper: the exact bytes an OSC writer must produce.
export function encodeOscMessage(msg: OscMessage): Uint8Array {
  const chunks: Uint8Array[] = [];
  chunks.push(paddedString(msg.address));
  let tags = ",";
  const body: Uint8Array[] = [];
  for (const arg of msg.args) {
    if (typeof arg === "number") {
      if (Number.isInteger(arg) && arg >= -(2 ** 31) && arg < 2 ** 31) {
        tags += "i";
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, arg, false);
        body.push(b);
      } else {
        tags += "f";
        const b = new Uint8Array(4);
        new DataView(b.buffer).setFloat32(0, arg, false);
        body.push(b);
      }
    } else if (typeof arg === "string") {
      tags += "s";
      body.push(paddedString(arg));
    } else {
      tags += "b";
      const b = new Uint8Array(4 + arg.length);
      new DataView(b.buffer).setUint32(0, arg.length, false);
      b.set(arg, 4);
      body.push(paddedStringBytes(b));
    }
  }
  chunks.push(paddedString(tags));
  chunks.push(...body);
  return concat(chunks);
}

export function encodeOscBundle(timetag: bigint, elements: readonly Uint8Array[]): Uint8Array {
  const head = new Uint8Array(16);
  head.set(new TextEncoder().encode("#bundle"), 0);
  new DataView(head.buffer).setBigUint64(8, timetag, false);
  const chunks: Uint8Array[] = [head];
  for (const el of elements) {
    const size = new Uint8Array(4);
    new DataView(size.buffer).setUint32(0, el.length, false);
    chunks.push(size, el);
  }
  return concat(chunks);
}

function paddedString(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const len = Math.ceil((bytes.length + 1) / 4) * 4;
  const out = new Uint8Array(len);
  out.set(bytes, 0);
  return out;
}

function paddedStringBytes(raw: Uint8Array): Uint8Array {
  const len = Math.ceil(raw.length / 4) * 4;
  const out = new Uint8Array(len);
  out.set(raw, 0);
  return out;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function decodeMessageElement(data: Uint8Array, offset: number, out: OscMessage[]): number {
  const { text: address, next } = readPaddedString(data, offset);
  if (!address.startsWith("/")) throw new RangeError(`OSC address must start with /: ${address}`);
  const { text: tags, next: afterTags } = readPaddedString(data, next);
  if (!tags.startsWith(",")) throw new RangeError(`OSC type tag string must start with a comma: ${tags}`);
  const args: OscArgument[] = [];
  let at = afterTags;
  for (const tag of tags.slice(1)) {
    if (tag === "i") {
      assertOffset(data, at, 4);
      args.push(new DataView(data.buffer, data.byteOffset + at, 4).getInt32(0, false));
      at += 4;
    } else if (tag === "f") {
      assertOffset(data, at, 4);
      args.push(new DataView(data.buffer, data.byteOffset + at, 4).getFloat32(0, false));
      at += 4;
    } else if (tag === "s") {
      const s = readPaddedString(data, at);
      args.push(s.text);
      at = s.next;
    } else if (tag === "b") {
      assertOffset(data, at, 4);
      const len = new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0, false);
      args.push(data.slice(at + 4, at + 4 + len));
      at += 4 + Math.ceil(len / 4) * 4;
    } else {
      throw new RangeError(`unsupported OSC type tag ${tag}`);
    }
  }
  out.push({ address, args });
  return at;
}

// Decode one UDP datagram: a single message, or a bundle of messages.
// Malformed elements are reported, never thrown at the caller (S26).
export function decodeOscDatagram(bytes: Uint8Array): OscDatagram {
  const messages: OscMessage[] = [];
  const malformed: string[] = [];
  const visit = (data: Uint8Array, depth: number): void => {
    if (depth > 4) {
      malformed.push("bundle nesting deeper than 4");
      return;
    }
    try {
      const { text: head } = readPaddedString(data, 0);
      if (head === "#bundle") {
        assertOffset(data, 0, 16);
        const timetag = new DataView(data.buffer, data.byteOffset + 8, 8).getBigUint64(0, false);
        let at = 16;
        while (at + 4 <= data.length) {
          const size = new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0, false);
          at += 4;
          if (at + size > data.length) throw new RangeError("bundle element overruns datagram");
          visit(data.subarray(at, at + size), depth + 1);
          at += size;
        }
        return;
      }
      decodeMessageElement(data, 0, messages);
    } catch (err) {
      malformed.push(err instanceof Error ? err.message : String(err));
    }
  };
  const t = bytes.length >= 8 ? readPaddedString(bytes, 0).text : "";
  visit(bytes, 0);
  let timetag: bigint | null = null;
  if (t === "#bundle" && bytes.length >= 16) {
    timetag = new DataView(bytes.buffer, bytes.byteOffset + 8, 8).getBigUint64(0, false);
  }
  return { timetag, messages, malformed };
}
