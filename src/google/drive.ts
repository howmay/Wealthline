// Reads and writes the app's data as one JSON file in the user's own Google Drive.
// The file lives in a visible "We Wealth" folder so the user can see, download or delete it.

import type { AccessToken } from './auth'

const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export const FOLDER_NAME = 'We Wealth'
export const DATA_FILE_NAME = 'we-wealth-data.json'
// Tags the app's own files so a search finds them even if the user renames them.
const APP_PROP = { key: 'weWealth', folder: 'folder', data: 'data' }

async function driveFetch(token: AccessToken, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token.value}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Drive 錯誤 ${res.status}: ${body}`)
  }
  return res
}

async function findFile(token: AccessToken, role: string): Promise<string | null> {
  const q = `appProperties has { key='${APP_PROP.key}' and value='${role}' } and trashed = false`
  const url = `${API}?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id)&orderBy=createdTime`
  const { files } = (await (await driveFetch(token, url)).json()) as { files: { id: string }[] }
  return files[0]?.id ?? null
}

async function ensureFolder(token: AccessToken): Promise<string> {
  const existing = await findFile(token, APP_PROP.folder)
  if (existing) return existing
  const res = await driveFetch(token, `${API}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { [APP_PROP.key]: APP_PROP.folder },
    }),
  })
  return ((await res.json()) as { id: string }).id
}

function multipartBody(metadata: object, content: string): { body: string; contentType: string } {
  const boundary = `we-wealth-${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`
  return { body, contentType: `multipart/related; boundary=${boundary}` }
}

export interface DriveFile<T> {
  fileId: string
  data: T
}

// Returns null when the user has no data file yet.
export async function loadData<T>(token: AccessToken): Promise<DriveFile<T> | null> {
  const fileId = await findFile(token, APP_PROP.data)
  if (!fileId) return null
  const res = await driveFetch(token, `${API}/${fileId}?alt=media`)
  return { fileId, data: (await res.json()) as T }
}

// Creates the file on first save; afterwards overwrites the same file.
export async function saveData<T>(token: AccessToken, data: T, fileId?: string): Promise<string> {
  const content = JSON.stringify(data, null, 2)
  if (fileId) {
    await driveFetch(token, `${UPLOAD}/${fileId}?uploadType=media&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    })
    return fileId
  }
  const folderId = await ensureFolder(token)
  const { body, contentType } = multipartBody(
    {
      name: DATA_FILE_NAME,
      mimeType: 'application/json',
      parents: [folderId],
      appProperties: { [APP_PROP.key]: APP_PROP.data },
    },
    content,
  )
  const res = await driveFetch(token, `${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
  return ((await res.json()) as { id: string }).id
}
