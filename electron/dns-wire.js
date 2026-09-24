'use strict';

/**
 * The bits of the DNS message format HawCode needs.
 *
 * Shared by the mDNS responder (electron/mdns.js) and the name server
 * (electron/dns-server.js). They answer on different ports with different
 * conventions, but the bytes on the wire are the same shape, and having one
 * copy of the parsing is what keeps a fix in one place from being missing in
 * the other.
 */

const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_ANY = 255;
const CLASS_IN = 1;

const RCODE_OK = 0;
const RCODE_SERVFAIL = 2;
const RCODE_NXDOMAIN = 3;

const FLAG_RESPONSE = 0x8000;
const FLAG_AUTHORITATIVE = 0x0400;
const FLAG_TRUNCATED = 0x0200;
const FLAG_RECURSION_DESIRED = 0x0100;
const FLAG_RECURSION_AVAILABLE = 0x0080;

/**
 * Read a QNAME. Compression pointers are recognised but not followed: every
 * name this reads comes from a question section, which is never compressed
 * because there is nothing before it to point at.
 */
function readName(buffer, offset) {
  const labels = [];
  let cursor = offset;
  while (cursor < buffer.length) {
    const length = buffer[cursor];
    if (length === 0) return { name: labels.join('.'), offset: cursor + 1 };
    if ((length & 0xc0) === 0xc0) return { name: labels.join('.'), offset: cursor + 2 };
    cursor += 1;
    if (cursor + length > buffer.length) return null;
    labels.push(buffer.toString('utf-8', cursor, cursor + length));
    cursor += length;
  }
  return null;
}

function encodeName(name) {
  const parts = String(name).split('.').filter(Boolean);
  const chunks = [];
  for (const part of parts) {
    const bytes = Buffer.from(part, 'utf-8');
    if (bytes.length > 63) return null;
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

/**
 * Pull apart a query far enough to decide what to do with it. Returns null for
 * anything malformed — this listens on a network port, so "I could not read
 * that" has to be an ordinary outcome rather than a thrown error.
 */
function parseQuery(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const id = buffer.readUInt16BE(0);
  const flags = buffer.readUInt16BE(2);
  const total = buffer.readUInt16BE(4);

  const questions = [];
  let offset = 12;
  for (let index = 0; index < total; index += 1) {
    const parsed = readName(buffer, offset);
    if (!parsed || parsed.offset + 4 > buffer.length) return null;
    questions.push({
      name: parsed.name,
      type: buffer.readUInt16BE(parsed.offset),
      klass: buffer.readUInt16BE(parsed.offset + 2)
    });
    offset = parsed.offset + 4;
  }

  return {
    id,
    flags,
    isResponse: Boolean(flags & FLAG_RESPONSE),
    recursionDesired: Boolean(flags & FLAG_RECURSION_DESIRED),
    questions,
    questionEnd: offset
  };
}

function encodeIpv4(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  const bytes = Buffer.alloc(4);
  for (let index = 0; index < 4; index += 1) {
    const value = Number(parts[index]);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

/**
 * Build a reply to `query`, echoing its question section as a resolver must.
 *
 * `answers` is a list of `{ name, type, ip, ttl }`. An empty list with
 * `rcode: RCODE_OK` is a deliberate and useful answer — "this name exists, but
 * not with the record you asked for" — and is what keeps a client asking for
 * IPv6 from concluding the name does not exist at all.
 */
function buildResponse(query, queryBuffer, { answers = [], rcode = RCODE_OK, authoritative = true } = {}) {
  let flags = FLAG_RESPONSE | FLAG_RECURSION_AVAILABLE | (rcode & 0x0f);
  if (authoritative) flags |= FLAG_AUTHORITATIVE;
  if (query.recursionDesired) flags |= FLAG_RECURSION_DESIRED;

  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.id, 0);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(query.questions.length, 4);
  header.writeUInt16BE(answers.length, 6);

  const sections = [header, queryBuffer.subarray(12, query.questionEnd)];

  for (const answer of answers) {
    const name = encodeName(answer.name);
    const address = encodeIpv4(answer.ip);
    if (!name || !address) continue;
    const record = Buffer.alloc(10);
    record.writeUInt16BE(answer.type || TYPE_A, 0);
    record.writeUInt16BE(CLASS_IN, 2);
    record.writeUInt32BE(answer.ttl || 60, 4);
    record.writeUInt16BE(address.length, 8);
    sections.push(name, record, address);
  }

  return Buffer.concat(sections);
}

module.exports = {
  readName,
  encodeName,
  parseQuery,
  buildResponse,
  encodeIpv4,
  TYPE_A,
  TYPE_AAAA,
  TYPE_ANY,
  CLASS_IN,
  RCODE_OK,
  RCODE_SERVFAIL,
  RCODE_NXDOMAIN,
  FLAG_RESPONSE,
  FLAG_TRUNCATED
};
