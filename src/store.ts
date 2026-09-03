import type { Diagnostics, Settings } from './types'

const SETTINGS_KEY = 'settings'
const DIAGNOSTICS_KEY = 'diagnostics'

export const defaultSettings: Settings = { enabled: true, order: [] }

/**
 * 並び順は端末をまたいで持ち歩きたいので sync に置く。sync が使えない
 * （同期を切っている、容量超過など）場合は local に落とす。
 */
async function settingsArea(): Promise<chrome.storage.StorageArea> {
  try {
    await chrome.storage.sync.get(SETTINGS_KEY)
    return chrome.storage.sync
  } catch {
    return chrome.storage.local
  }
}

function normalize(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return defaultSettings
  const raw = value as Partial<Settings>
  const order = Array.isArray(raw.order)
    ? raw.order.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return []
        const { id, alias } = entry as Partial<Settings['order'][number]>
        if (typeof alias !== 'string') return []
        return [{ id: typeof id === 'string' ? id : null, alias }]
      })
    : []
  return { enabled: raw.enabled !== false, order }
}

export async function loadSettings(): Promise<Settings> {
  const area = await settingsArea()
  const stored = await area.get(SETTINGS_KEY)
  return normalize(stored[SETTINGS_KEY])
}

export async function saveSettings(settings: Settings): Promise<void> {
  const area = await settingsArea()
  await area.set({ [SETTINGS_KEY]: settings })
}

/** 適用状況はポップアップに出すだけの揮発情報なので、同期させない。 */
export async function saveDiagnostics(diagnostics: Diagnostics): Promise<void> {
  await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: diagnostics })
}

export async function loadDiagnostics(): Promise<Diagnostics | null> {
  const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY)
  const value = stored[DIAGNOSTICS_KEY]
  if (typeof value !== 'object' || value === null) return null
  return value as Diagnostics
}

export function onStoredChange(listener: (change: {
  settings?: Settings
  diagnostics?: Diagnostics
}) => void): void {
  chrome.storage.onChanged.addListener((changes) => {
    const payload: { settings?: Settings; diagnostics?: Diagnostics } = {}
    const settings = changes[SETTINGS_KEY]
    if (settings) payload.settings = normalize(settings.newValue)
    const diagnostics = changes[DIAGNOSTICS_KEY]
    if (diagnostics) payload.diagnostics = diagnostics.newValue as Diagnostics
    if (payload.settings || payload.diagnostics) listener(payload)
  })
}
