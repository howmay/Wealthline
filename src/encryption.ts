// Version 1: PBKDF2-SHA256 (600,000 rounds), AES-256-GCM with a fresh 96-bit IV per save.
// Only salt/IV/ciphertext leave the browser. The non-extractable key lives in memory.
const FORMAT = 'wealthline-encrypted'
const AAD = new TextEncoder().encode(`${FORMAT}:1`)

export interface EncryptionContext {
  key: CryptoKey
  salt: string
}

interface EncryptedData {
  format: typeof FORMAT
  version: 1
  salt: string
  iv: string
  ciphertext: string
}

function encode(bytes: Uint8Array): string {
  let value = ''
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(value)
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (!password || password.length > 1024) throw new Error('加密密碼長度不正確')
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export async function createEncryption(password: string): Promise<EncryptionContext> {
  if (password.length < 12) throw new Error('加密密碼至少需要 12 個字元')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { key: await deriveKey(password, salt), salt: encode(salt) }
}

export function isEncryptedData(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'format' in raw && raw.format === FORMAT
}

export async function encryptData(data: unknown, context: EncryptionContext): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD }, context.key, new TextEncoder().encode(JSON.stringify(data)),
  )
  return { format: FORMAT, version: 1, salt: context.salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
}

export async function decryptData(raw: unknown, password: string): Promise<{ data: unknown; context: EncryptionContext }> {
  const file = raw as EncryptedData
  if (!isEncryptedData(raw) || file.version !== 1 || typeof file.salt !== 'string' || typeof file.iv !== 'string' || typeof file.ciphertext !== 'string') {
    throw new Error('不支援或損壞的加密資料格式')
  }
  try {
    const salt = decode(file.salt)
    const iv = decode(file.iv)
    const ciphertext = decode(file.ciphertext)
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('invalid envelope')
    const key = await deriveKey(password, salt)
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, ciphertext)
    return { data: JSON.parse(new TextDecoder().decode(plaintext)), context: { key, salt: file.salt } }
  } catch {
    throw new Error('密碼不正確或加密資料已損壞；原始檔案未被修改。')
  }
}
