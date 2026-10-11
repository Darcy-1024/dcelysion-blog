'use strict';
const { inflateSync, deflateSync } = require('node:zlib');
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_BYTES = 384 * 1024;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}

// Accept only the small, non-interlaced RGB/RGBA PNG produced by our canvas.
// Decode with a bounded output and rebuild without metadata or animation chunks.
function normalizeAvatar(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('INVALID_IMAGE');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_BYTES || !bytes.subarray(0, 8).equals(signature)) throw new Error('INVALID_IMAGE');
  let header; let ended = false; let dataEnded = false; const parts = [];
  for (let offset = 8; offset < bytes.length;) {
    if (ended || offset + 12 > bytes.length) throw new Error('INVALID_IMAGE');
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) throw new Error('INVALID_IMAGE');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)) throw new Error('INVALID_IMAGE');
    if (!header && type !== 'IHDR') throw new Error('INVALID_IMAGE');
    if (type === 'IHDR') {
      if (header || size !== 13) throw new Error('INVALID_IMAGE');
      header = Buffer.from(data);
      const width = header.readUInt32BE(0); const height = header.readUInt32BE(4);
      if (!width || !height || width > 256 || height > 256 || header[8] !== 8 ||
          ![2, 6].includes(header[9]) || header[10] || header[11] || header[12]) throw new Error('INVALID_IMAGE');
    } else if (type === 'IDAT') {
      if (dataEnded) throw new Error('INVALID_IMAGE');
      parts.push(data);
    } else if (type === 'IEND') {
      if (size || !parts.length) throw new Error('INVALID_IMAGE');
      ended = true;
    } else {
      if (parts.length) dataEnded = true;
      if (!/^[a-z][A-Za-z]{3}$/.test(type) || ['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('INVALID_IMAGE');
    }
    offset += size + 12;
  }
  if (!ended) throw new Error('INVALID_IMAGE');
  const stride = header.readUInt32BE(0) * (header[9] === 6 ? 4 : 3) + 1;
  const expected = stride * header.readUInt32BE(4);
  const raw = inflateSync(Buffer.concat(parts), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error('INVALID_IMAGE');
  for (let i = 0; i < raw.length; i += stride) if (raw[i] > 4) throw new Error('INVALID_IMAGE');
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { normalizeAvatar, MAX_BYTES, chunk, signature };
