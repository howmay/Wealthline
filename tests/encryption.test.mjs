import assert from 'node:assert/strict'
import { test } from 'node:test'

const cryptoModule = () => import('../src/encryption.ts')
const password = 'a long unique test passphrase'
const data = { version: 1, accounts: [{ name: '私人帳戶', balance: 12345 }] }

test('encrypted data round trips without exposing financial data or password', async () => {
  const { createEncryption, encryptData, decryptData } = await cryptoModule()
  const context = await createEncryption(password)
  const encrypted = await encryptData(data, context)
  assert.ok(!JSON.stringify(encrypted).includes('私人帳戶'))
  assert.ok(!JSON.stringify(encrypted).includes(password))
  assert.equal(context.key.extractable, false)
  assert.deepEqual((await decryptData(encrypted, password)).data, data)
})

test('each encryption uses a fresh nonce and each new key uses a fresh salt', async () => {
  const { createEncryption, encryptData } = await cryptoModule()
  const context = await createEncryption(password)
  const a = await encryptData(data, context)
  const b = await encryptData(data, context)
  const c = await createEncryption(password)
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.ciphertext, b.ciphertext)
  assert.notEqual(context.salt, c.salt)
})

test('wrong passwords and tampered ciphertext cannot produce plaintext', async () => {
  const { createEncryption, encryptData, decryptData } = await cryptoModule()
  const encrypted = await encryptData(data, await createEncryption(password))
  await assert.rejects(() => decryptData(encrypted, 'wrong password'), /密碼|損壞/)
  const bytes = Buffer.from(encrypted.ciphertext, 'base64')
  bytes[0] ^= 1
  await assert.rejects(() => decryptData({ ...encrypted, ciphertext: bytes.toString('base64') }, password), /密碼|損壞/)
})

test('unsupported encryption formats and malformed salts are rejected', async () => {
  const { createEncryption, encryptData, decryptData } = await cryptoModule()
  const encrypted = await encryptData(data, await createEncryption(password))
  await assert.rejects(() => decryptData({ ...encrypted, version: 99 }, password))
  await assert.rejects(() => decryptData({ ...encrypted, salt: 'AA==' }, password))
  await assert.rejects(() => createEncryption('short'))
})
