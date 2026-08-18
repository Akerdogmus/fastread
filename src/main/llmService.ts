import type { AppSettings, EngineName } from '@shared/types'

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

async function callLmStudio(settings: AppSettings, messages: ChatMessage[]): Promise<string> {
  const url = `${settings.lmStudioBaseUrl.replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.lmStudioModel || undefined,
      messages,
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(60_000)
  })
  if (!res.ok) {
    throw new Error(`LM Studio hata: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('LM Studio yanıtı beklenmeyen formatta')
  return content.trim()
}

async function callGemini(settings: AppSettings, messages: ChatMessage[]): Promise<string> {
  if (!settings.geminiApiKey) throw new Error('Gemini API anahtarı ayarlanmamış')
  const model = settings.geminiModel || 'gemini-2.0-flash'
  // The key travels in a header, not the query string. A query string is the part of a URL
  // that routinely ends up somewhere it shouldn't — crash dumps, process listings, proxy and
  // server access logs — whereas a header stays inside the TLS-encrypted body and out of all
  // of them. The model name is encoded because it comes from a user-editable settings field
  // and would otherwise be able to reshape the request path.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const systemMsg = messages.find((m) => m.role === 'system')?.content
  const userMsg = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n')

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: userMsg }] }]
  }
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg }] }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': settings.geminiApiKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000)
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Gemini hata: ${res.status} ${res.statusText} ${errText}`)
  }
  const data = await res.json()
  const content = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text)
    .join('')
  if (typeof content !== 'string' || !content) throw new Error('Gemini yanıtı beklenmeyen formatta')
  return content.trim()
}

async function callEngine(
  engine: EngineName,
  settings: AppSettings,
  messages: ChatMessage[]
): Promise<string> {
  if (engine === 'lmstudio') return callLmStudio(settings, messages)
  return callGemini(settings, messages)
}

/** Try each engine in settings.enginePriority order until one succeeds. */
async function runWithFallback(
  settings: AppSettings,
  messages: ChatMessage[]
): Promise<{ text: string; engine: EngineName }> {
  const errors: string[] = []
  for (const engine of settings.enginePriority) {
    try {
      const text = await callEngine(engine, settings, messages)
      return { text, engine }
    } catch (err) {
      errors.push(`${engine}: ${(err as Error).message}`)
    }
  }
  throw new Error(`Tüm motorlar başarısız oldu -> ${errors.join(' | ')}`)
}

export async function translateText(
  settings: AppSettings,
  text: string,
  targetLanguage = settings.targetLanguage
): Promise<{ text: string; engine: EngineName }> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are an expert academic translator. Translate the given academic text into ${targetLanguage}. Preserve technical terminology, citations, and formatting. Only output the translation, with no extra commentary.`
    },
    { role: 'user', content: text }
  ]
  return runWithFallback(settings, messages)
}

export async function interpretText(
  settings: AppSettings,
  text: string,
  targetLanguage = settings.targetLanguage
): Promise<{ text: string; engine: EngineName }> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a helpful academic reading assistant. In ${targetLanguage}, briefly explain/interpret the meaning and significance of the given excerpt for a reader trying to deeply understand the paper. Be concise (2-4 sentences).`
    },
    { role: 'user', content: text }
  ]
  return runWithFallback(settings, messages)
}

export async function extractCitationFromText(
  settings: AppSettings,
  firstPageText: string
): Promise<{ text: string; engine: EngineName }> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You extract bibliographic metadata from the first page of an academic PDF.',
        'Respond with ONLY a single JSON object — no markdown code fences, no ```json, no commentary before or after it.',
        'Keys: title, authors, year, journal, volume, issue, pages, doi.',
        '"authors" must be a single string (e.g. "Smith, J., & Doe, A."), never an array.',
        'For a conference paper, put the conference/proceedings name in "journal" and leave "volume" and "issue" empty.',
        'Use an empty string for any field you cannot determine. Do not invent values.'
      ].join(' ')
    },
    { role: 'user', content: firstPageText.slice(0, 4000) }
  ]
  return runWithFallback(settings, messages)
}
