// Reader for the pipeline's binary bundles (pipeline/bundle.py):
//   'ASV1' | uint32 header length | header JSON | 8-byte-aligned little-endian arrays.
// Files are gzipped on disk. Browsers inflate them with DecompressionStream; Node uses zlib.

const TYPES = {
  f4: Float32Array, f8: Float64Array, i4: Int32Array, u4: Uint32Array,
  i2: Int16Array, u2: Uint16Array, i1: Int8Array, u1: Uint8Array,
};

export function parseBundle(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'ASV1') throw new Error('Not an ASV1 bundle');
  const headerLen = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen)));
  const base = 8 + headerLen;
  const arrays = {};
  for (const [name, a] of Object.entries(header.arrays)) {
    const T = TYPES[a.dtype];
    const start = base + a.offset;
    // Copy when the view would be misaligned (cannot happen with the writer, but be safe).
    if (start % T.BYTES_PER_ELEMENT === 0) arrays[name] = new T(buffer, start, a.length);
    else arrays[name] = new T(buffer.slice(start, start + a.length * T.BYTES_PER_ELEMENT));
  }
  return { meta: header.meta, arrays };
}

async function gunzipBrowser(buffer) {
  const b = new Uint8Array(buffer);
  // A server may already have removed the gzip layer (Content-Encoding); detect by magic bytes.
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';

/** Fetch (browser) or read (Node) raw bytes, inflating .gz files. */
export async function loadBytes(url, onProgress) {
  if (isNode) {
    const fs = await import('node:fs/promises');
    const zlib = await import('node:zlib');
    let buf = await fs.readFile(url);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  let buffer;
  const total = Number(res.headers.get('content-length')) || 0;
  if (onProgress && res.body && total) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(got / total);
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    buffer = out.buffer;
  } else {
    buffer = await res.arrayBuffer();
  }
  return gunzipBrowser(buffer);
}

export async function loadBundle(url, onProgress) {
  return parseBundle(await loadBytes(url, onProgress));
}

export async function loadJSON(url) {
  if (isNode) {
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(url, 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

export { isNode };
