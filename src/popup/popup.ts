import {
  defaultSettings,
  loadDiagnostics,
  loadSettings,
  onStoredChange,
  saveSettings,
} from '../store'
import type { Diagnostics, Settings } from '../types'

const enabledInput = document.querySelector<HTMLInputElement>('#enabled')
const statusEl = document.querySelector<HTMLParagraphElement>('#status')
const orderEl = document.querySelector<HTMLOListElement>('#order')
const resetButton = document.querySelector<HTMLButtonElement>('#reset')
const orderEmptyEl = document.querySelector<HTMLParagraphElement>('#order-empty')

let settings: Settings = defaultSettings

function describe(diagnostics: Diagnostics | null): { text: string; tone: 'info' | 'warn' } {
  if (!settings.enabled) return { text: '無効にしています。', tone: 'info' }
  if (!diagnostics) return { text: 'まだ日表示を開いていません。', tone: 'info' }
  switch (diagnostics.state) {
    case 'applied':
      return { text: `適用中（${diagnostics.detail ?? ''}）`, tone: 'info' }
    case 'idle':
      return { text: diagnostics.detail ?? '待機中です。', tone: 'info' }
    case 'unsupported':
    case 'rolled-back':
      return {
        text: `並び替えを適用できません。${diagnostics.detail ?? ''}保存した順序は保持されています。`,
        tone: 'warn',
      }
  }
}

function renderStatus(diagnostics: Diagnostics | null): void {
  if (!statusEl) return
  const { text, tone } = describe(diagnostics)
  statusEl.textContent = text
  statusEl.dataset.tone = tone
}

function renderOrder(): void {
  if (!orderEl) return
  const empty = settings.order.length === 0
  orderEl.hidden = empty
  if (orderEmptyEl) orderEmptyEl.hidden = !empty
  orderEl.textContent = ''
  for (const column of settings.order) {
    const item = document.createElement('li')
    item.textContent = column.alias
    orderEl.append(item)
  }
}

function render(diagnostics: Diagnostics | null): void {
  if (enabledInput) enabledInput.checked = settings.enabled
  if (resetButton) resetButton.disabled = settings.order.length === 0
  renderStatus(diagnostics)
  renderOrder()
}

enabledInput?.addEventListener('change', () => {
  settings = { ...settings, enabled: enabledInput.checked }
  void saveSettings(settings)
  void loadDiagnostics().then((diagnostics) => render(diagnostics))
})

resetButton?.addEventListener('click', () => {
  settings = { ...settings, order: [] }
  void saveSettings(settings)
  void loadDiagnostics().then((diagnostics) => render(diagnostics))
})

onStoredChange((change) => {
  if (change.settings) settings = change.settings
  void loadDiagnostics().then((diagnostics) => render(diagnostics))
})

void Promise.all([loadSettings(), loadDiagnostics()]).then(([loaded, diagnostics]) => {
  settings = loaded
  render(diagnostics)
})
