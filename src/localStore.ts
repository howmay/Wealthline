// Local mode: the same data file as the Drive mode, kept in this browser's localStorage
// instead of Google Drive, with no sign-in. The user can download it as a JSON file and
// upload that file later (in this or another browser) to restore it.

import { localDate } from './history'
import { parseWealthData, type WealthData } from './model'

const DATA_KEY = 'wealthline.local.data'
// Set while the user is in local mode, so a reload of an app page reopens it.
// index.html reads this key too, to hide the prerendered sign-in page on such a reload.
const ACTIVE_KEY = 'wealthline.local.active'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export class LocalConflictError extends Error {
  constructor() {
    super('此瀏覽器中的資料已在其他分頁更新，已停止儲存。這個分頁的未儲存修改仍保留；請先下載本機備份，再重新載入並比對合併。')
    this.name = 'LocalConflictError'
  }
}

// The stored text is the version: a save only goes through when it still matches what this tab read.
export interface LocalFile {
  data: WealthData
  raw: string
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export const isLocalActive = () => read(ACTIVE_KEY) === '1'
export const hasLocalData = () => read(DATA_KEY) !== null

export function setLocalActive(active: boolean) {
  try {
    if (active) localStorage.setItem(ACTIVE_KEY, '1')
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Storage blocked: local mode still works in this tab, it just won't reopen on reload.
  }
}

// Throws when the stored data is not a valid data file.
export function loadLocal(): LocalFile | null {
  const raw = read(DATA_KEY)
  if (raw === null) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('此瀏覽器保存的資料不是有效的 JSON。可以上傳備份的資料檔取代它。')
  }
  return { data: parseWealthData(json, 'browser'), raw }
}

// Writes `data` unless another tab changed the stored data since `expected` was read
// (null: nothing was stored). Returns the new stored text, the version for the next save.
export function saveLocal(data: WealthData, expected: string | null): string {
  if (read(DATA_KEY) !== expected) throw new LocalConflictError()
  const raw = JSON.stringify(data)
  try {
    localStorage.setItem(DATA_KEY, raw)
  } catch {
    throw new Error('此瀏覽器的儲存空間不足或已停用，資料沒有儲存。請先下載本機備份。')
  }
  return raw
}

// Replaces the stored data with an uploaded file, whatever was there. Returns the new stored text.
export function replaceLocal(data: WealthData): string {
  return saveLocal(data, read(DATA_KEY))
}

// Removes the data and leaves local mode. Downloaded files are not affected.
export function clearLocal() {
  try {
    localStorage.removeItem(DATA_KEY)
    localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Nothing to clear.
  }
}

// Reads a data file the user picked: a download from local mode, or the Drive mode's data file.
export async function readDataFile(file: File): Promise<WealthData> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('檔案太大，不像是 Wealthline 的資料檔。')
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    throw new Error('這個檔案不是有效的 JSON，請選擇 Wealthline 的資料檔。')
  }
  return parseWealthData(json, 'file')
}

// Saves `data` as a JSON file, formatted like the Drive data file.
export function downloadDataFile(data: WealthData, name = `wealthline-data-${localDate(new Date().toISOString())}.json`) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
