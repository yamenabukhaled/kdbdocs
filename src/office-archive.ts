import { Inflate } from "fflate";

export const MAX_XML_PART = 8_000_000;
export const MAX_XML_TOTAL = 25_000_000;
export type OfficePart = { name: string; xml: string };
const crcTable = new Uint32Array(256).map((_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const allowed = (name: string, kind: "word" | "slides") =>
  name === "[Content_Types].xml" ||
  (kind === "word"
    ? /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(
        name,
      )
    : name === "ppt/presentation.xml" ||
      name === "ppt/_rels/presentation.xml.rels" ||
      /^ppt\/(slides|notesSlides)\/(slide\d+|notesSlide\d+)\.xml$/.test(name) ||
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name));

// Deliberately bounded classic ZIP reader: no filesystem writes, media inflation,
// ZIP64 allocation, external relationships, encryption or macro execution.
export function readOfficeArchive(
  data: Uint8Array,
  kind: "word" | "slides",
): OfficePart[] {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (data.length > 20_000_000)
    fail("Office file exceeds the 20 MB import limit.");
  if (data[0] === 0xd0 && data[1] === 0xcf)
    fail(
      "Password-protected or legacy Office file. Save an unlocked .docx or .pptx copy locally and reimport.",
    );
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = -1;
  for (
    let offset = data.length - 22;
    offset >= Math.max(0, data.length - 65557);
    offset--
  ) {
    if (
      u32(offset) === 0x06054b50 &&
      offset + 22 + u16(offset + 20) === data.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0)
    fail(
      "Damaged or unsupported Office package. Re-save it as .docx or .pptx and retry.",
    );
  const count = u16(end + 10),
    directorySize = u32(end + 12),
    directoryStart = u32(end + 16);
  if (
    count === 65535 ||
    directorySize === 0xffffffff ||
    directoryStart === 0xffffffff
  )
    fail(
      "ZIP64 Office packages are not supported. Export a smaller standard Office file.",
    );
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    count > 10000 ||
    directoryStart + directorySize !== end
  )
    fail("Office package structure exceeds supported limits or is damaged.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const result: OfficePart[] = [];
  const names = new Set<string>();
  let cursor = directoryStart,
    total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50)
      fail("Damaged Office package directory.");
    const flags = u16(cursor + 8),
      method = u16(cursor + 10),
      checksum = u32(cursor + 16),
      compressed = u32(cursor + 20),
      original = u32(cursor + 24),
      nameSize = u16(cursor + 28),
      extra = u16(cursor + 30),
      comment = u16(cursor + 32),
      local = u32(cursor + 42);
    const next = cursor + 46 + nameSize + extra + comment;
    if (next > end || nameSize > 512) fail("Invalid Office package entry.");
    const name = decoder.decode(
      data.subarray(cursor + 46, cursor + 46 + nameSize),
    );
    cursor = next;
    if (!allowed(name, kind)) continue;
    if (names.has(name))
      fail("Office package contains duplicate document parts.");
    names.add(name);
    if (flags & 1 || flags & 64)
      fail(
        "Encrypted Office packages are not supported. Unlock a copy locally first.",
      );
    if (
      ![0, 8].includes(method) ||
      original > MAX_XML_PART ||
      total + original > MAX_XML_TOTAL
    )
      fail(
        "Office text expansion exceeds the safety limit (8 MB per XML part / 25 MB total), or compression is unsupported.",
      );
    if (
      local + 30 > directoryStart ||
      u32(local) !== 0x04034b50 ||
      u16(local + 8) !== method ||
      u16(local + 6) !== flags
    )
      fail("Damaged Office part header.");
    const localNameSize = u16(local + 26),
      start = local + 30 + localNameSize + u16(local + 28);
    if (
      start + compressed > directoryStart ||
      decoder.decode(data.subarray(local + 30, local + 30 + localNameSize)) !==
        name
    )
      fail("Invalid Office part bounds.");
    let size = 0,
      crc = 0xffffffff;
    const chunks: Uint8Array[] = [];
    const append = (chunk: Uint8Array) => {
      size += chunk.length;
      if (
        size > original ||
        size > MAX_XML_PART ||
        total + size > MAX_XML_TOTAL
      )
        fail("Expanded Office text exceeds its declared size or safety limit.");
      for (const byte of chunk)
        crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      chunks.push(chunk.slice());
    };
    if (method === 0) append(data.subarray(start, start + compressed));
    else {
      const inflate = new Inflate(append);
      // Bounded compressed chunks also limit an inflater's transient expansion.
      if (!compressed) fail("Empty compressed Office part.");
      for (let offset = 0; offset < compressed; offset += 1024)
        inflate.push(
          data.subarray(
            start + offset,
            start + Math.min(offset + 1024, compressed),
          ),
          offset + 1024 >= compressed,
        );
    }
    if (size !== original || (crc ^ 0xffffffff) >>> 0 !== checksum)
      fail("Office part is damaged (size or checksum mismatch).");
    total += size;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    const xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      fail("Office XML with DTD or entity declarations is unsupported.");
    result.push({ name, xml });
  }
  if (
    cursor !== directoryStart + directorySize ||
    !names.has("[Content_Types].xml")
  )
    fail("Invalid Office package or missing content types.");
  return result;
}
