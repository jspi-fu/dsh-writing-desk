// MD5(知乎图片上传要 image_hash)与 AWS4-HMAC-SHA256 签名(掘金 ImageX)+ CRC32。
// 都是公开算法,按 RFC/规范直接实现,与上游实现无衍生关系。
const encoder = new TextEncoder()

function rotl(x, n) {
  return (x << n) | (x >>> (32 - n))
}

function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** MD5:输入任意字节数组,输出 hex。按 RFC 1321 实现。 */
export function md5(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data)
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)

  const withPad = padMessage(bytes)
  const view = new DataView(withPad.buffer)
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
  for (let chunk = 0; chunk < withPad.length; chunk += 64) {
    const M = new Uint32Array(16)
    for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(chunk + i * 4, true)
    let [A, B, C, D] = [a0, b0, c0, d0]
    for (let i = 0; i < 64; i += 1) {
      let F
      let g
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D
      D = C
      C = B
      B = (B + rotl(F, S[i])) >>> 0
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }
  const out = new DataView(new ArrayBuffer(16))
  out.setUint32(0, a0, true)
  out.setUint32(4, b0, true)
  out.setUint32(8, c0, true)
  out.setUint32(12, d0, true)
  return toHex(new Uint8Array(out.buffer))
}

function padMessage(bytes) {
  const bitLen = bytes.length * 8
  const padded = new Uint8Array((bytes.length + 8 + 64) - ((bytes.length + 8) % 64) || bytes.length + 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bitLen >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true)
  return padded
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes instanceof Uint8Array ? keyBytes : new Uint8Array(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', key, encoder.encode(message))
}

async function sha256Hex(message) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(message))
  return toHex(new Uint8Array(digest))
}

/**
 * AWS4-HMAC-SHA256:掘金 ImageX 的 ApplyImageUpload / CommitImageUpload 用。
 * @returns {Promise<{authorization: string, headers: Record<string, string>}>}
 */
export async function signAWS4({ method, url, accessKeyId, secretAccessKey, securityToken, region = 'cn-north-1', service = 'imagex' }) {
  const parsed = new URL(url)
  const query = [...new URLSearchParams(parsed.search.slice(1)).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const signed = { 'x-amz-date': amzDate, ...(securityToken ? { 'x-amz-security-token': securityToken } : {}) }
  const entries = Object.entries(signed).map(([key, value]) => [key.toLowerCase(), value.trim()]).sort((a, b) => a[0].localeCompare(b[0]))
  const names = entries.map(([key]) => key)
  const canonicalHeaders = entries.map(([key, value]) => `${key}:${value}`).join('\n') + '\n'

  const payloadHash = await sha256Hex('')
  const canonicalRequest = [method.toUpperCase(), parsed.pathname || '/', query, canonicalHeaders, names.join(';'), payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')

  const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp)
  const kRegion = await hmacSha256(new Uint8Array(kDate), region)
  const kService = await hmacSha256(new Uint8Array(kRegion), service)
  const kSigning = await hmacSha256(new Uint8Array(kService), 'aws4_request')
  const signature = toHex(new Uint8Array(await hmacSha256(new Uint8Array(kSigning), stringToSign)))

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
  return {
    authorization,
    headers: { authorization, 'x-amz-date': amzDate, ...(securityToken ? { 'x-amz-security-token': securityToken } : {}) },
  }
}

/** CRC32(hex 字符串):掘金 TOS 直传要 Content-CRC32。 */
let crcTable = null

function crcTableOf() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let bit = 0; bit < 8; bit += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    crcTable[i] = c
  }
  return crcTable
}

export function crc32(data) {
  const table = crcTableOf()
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF]
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0')
}
