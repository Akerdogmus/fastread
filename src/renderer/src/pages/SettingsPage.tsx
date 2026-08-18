import { useEffect, useState } from 'react'
import type { AppSettings, EngineName } from '@shared/types'
import './SettingsPage.css'

const LANGUAGES: { label: string; value: string }[] = [
  { label: 'Türkçe', value: 'Turkish' },
  { label: 'İngilizce', value: 'English' },
  { label: 'Almanca', value: 'German' }
]

export default function SettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [testResult, setTestResult] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    window.api.settings.load().then(setSettings)
  }, [])

  if (!settings) return <div className="settings-page">Yükleniyor…</div>

  async function persist(next: AppSettings): Promise<void> {
    setSettings(next)
    await window.api.settings.save(next)
    window.dispatchEvent(new Event('fastread:settings-changed'))
  }

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (!settings) return
    persist({ ...settings, [key]: value })
  }

  function setPriority(first: EngineName): void {
    const second: EngineName = first === 'lmstudio' ? 'gemini' : 'lmstudio'
    set('enginePriority', [first, second])
  }

  async function handleTest(): Promise<void> {
    if (!settings) return
    setTesting(true)
    setTestResult('')
    try {
      const result = await window.api.llm.translate('This is a short connectivity test sentence.')
      setTestResult(`Başarılı (${result.engine})`)
    } catch (err) {
      setTestResult(`Hata: ${(err as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  const primary = settings.enginePriority[0] ?? 'lmstudio'

  return (
    <div className="settings-page">
      <div className="settings-page__inner">
        <h1>Ayarlar</h1>
        <p className="settings-page__subtitle">
          Çeviri ve yorumlama önce kendi bilgisayarında çalışır. Bulut yalnızca yedek.
        </p>

        <div className="settings-page__stack">
          <div className="settings-card">
            <div className="settings-card__head">
              <h2>Motor sırası</h2>
              <span className="settings-card__hint">Tıklayarak önceliği değiştir</span>
            </div>
            <div className="engine-rows">
              <button
                className={`engine-row${primary === 'lmstudio' ? ' engine-row--active' : ''}`}
                onClick={() => setPriority('lmstudio')}
              >
                <span className="engine-row__handle">⠿</span>
                <span
                  className="engine-row__dot"
                  style={{ background: primary === 'lmstudio' ? '#728157' : '#c0b6a5' }}
                />
                <span className="engine-row__text">
                  <span className="engine-row__name">
                    LM Studio <em>· yerel</em>
                  </span>
                  <span className="engine-row__meta">
                    {settings.lmStudioModel || 'model seçilmedi'} · {settings.lmStudioBaseUrl}
                  </span>
                </span>
                <span className="engine-row__status">
                  {primary === 'lmstudio' ? 'Birincil motor' : 'Yalnızca yerel başarısız olursa'}
                </span>
              </button>
              <button
                className={`engine-row${primary === 'gemini' ? ' engine-row--active' : ''}`}
                onClick={() => setPriority('gemini')}
              >
                <span className="engine-row__handle">⠿</span>
                <span
                  className="engine-row__dot"
                  style={{ background: primary === 'gemini' ? '#b2622d' : '#c0b6a5' }}
                />
                <span className="engine-row__text">
                  <span className="engine-row__name">
                    Gemini <em>· bulut, yedek</em>
                  </span>
                  <span className="engine-row__meta">
                    {settings.geminiModel} ·{' '}
                    {settings.geminiApiKey ? 'anahtar kayıtlı' : 'anahtar yok'}
                  </span>
                </span>
                <span className="engine-row__status">
                  {primary === 'gemini' ? 'Birincil motor' : 'Yalnızca yerel başarısız olursa'}
                </span>
              </button>
            </div>
          </div>

          <div className="settings-page__grid">
            <div className="settings-card">
              <h2>LM Studio</h2>
              <label className="settings-field">
                Sunucu adresi
                <input
                  defaultValue={settings.lmStudioBaseUrl}
                  onBlur={(e) => set('lmStudioBaseUrl', e.target.value)}
                  placeholder="http://localhost:1234/v1"
                />
              </label>
              <label className="settings-field">
                Model
                <input
                  defaultValue={settings.lmStudioModel}
                  onBlur={(e) => set('lmStudioModel', e.target.value)}
                  placeholder="LM Studio'da yüklü model adı"
                />
              </label>
              <div className="settings-card__test">
                <button className="btn" onClick={handleTest} disabled={testing}>
                  {testing ? 'Test ediliyor…' : 'Bağlantıyı test et'}
                </button>
                {testResult && <span className="settings-card__test-result">{testResult}</span>}
              </div>
            </div>

            <div className="settings-card">
              <h2>Gemini</h2>
              <label className="settings-field">
                API anahtarı
                <input
                  type="password"
                  defaultValue={settings.geminiApiKey}
                  onBlur={(e) => set('geminiApiKey', e.target.value)}
                />
              </label>
              <label className="settings-field">
                Model
                <input
                  defaultValue={settings.geminiModel}
                  onBlur={(e) => set('geminiModel', e.target.value)}
                />
              </label>
              <p className="settings-card__note">
                Yedek motor açıkken sayfa metni Google sunucularına gönderilir.
              </p>
            </div>
          </div>

          <div className="settings-card settings-card--row">
            <div>
              <h2>Hedef dil</h2>
              <p className="settings-card__hint">Sağ sayfanın çeviri dili</p>
            </div>
            <div className="lang-seg">
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  className={settings.targetLanguage === l.value ? 'lang-seg__active' : ''}
                  onClick={() => set('targetLanguage', l.value)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
