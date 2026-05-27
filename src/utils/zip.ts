interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();

export async function createZip(files: Array<{ name: string; blob: Blob }>): Promise<Blob> {
  const entries: ZipEntry[] = await Promise.all(files.map(async (file) => ({
    name: sanitizeName(file.name),
    data: new Uint8Array(await file.blob.arrayBuffer()),
  })));

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = concat([
      u32(0x04034b50),
      u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ]);
    localParts.push(local);

    const central = concat([
      u32(0x02014b50),
      u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0), u16(0), u16(0), u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = concat([
    u32(0x06054b50),
    u16(0), u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ]);

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'redcard.png';
}

function u16(value: number): Uint8Array {
  const b = new Uint8Array(2);
  const v = new DataView(b.buffer);
  v.setUint16(0, value, true);
  return b;
}

function u32(value: number): Uint8Array {
  const b = new Uint8Array(4);
  const v = new DataView(b.buffer);
  v.setUint32(0, value >>> 0, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
