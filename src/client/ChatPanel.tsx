/**
 * dsh-ad chat panel — talks to the source's AI-assistant endpoint. When the
 * source is configured with `chat.streaming: true` the panel consumes the
 * SSE stream the host proxies (`/api/ad/chat/stream`) and appends each
 * token delta to the assistant bubble as it arrives; otherwise it sends a
 * one-shot POST to `/api/ad/chat` and waits for the full JSON reply.
 * @module dsh_plugin_ad/client/ChatPanel
 */

import { useEffect, useRef, useState } from 'react'
import type { ChatTurn } from './types.ts'
import { t } from './locales.ts'
import { API_PREFIX } from './constants.ts'
import styles from './ad.module.css'

/**
 * Read an SSE response body incrementally, invoking `onDelta` per token and
 * resolving once an `event: done` frame arrives (or the stream ends).
 * Rejects on an `event: error` frame or a network failure.
 */
async function readSseStream(response: Response, onDelta: (delta: string) => void): Promise<void> {
  if (response.body === null) throw new Error('no-stream-body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'

  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const lines = frame.split('\n')
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (event === 'error') throw new Error((JSON.parse(data || '{}') as { error?: string }).error ?? 'stream-error')
      if (event === 'done') return
      if (data !== '') {
        try {
          const parsed = JSON.parse(data) as { delta?: string }
          if (typeof parsed.delta === 'string') onDelta(parsed.delta)
        } catch { /* ignore malformed frame */ }
      }
    }
  }
}

export function ChatPanel({ sourceId, streaming }: { sourceId: string; streaming: boolean }): React.ReactElement {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns])

  const sendStreaming = (message: string, history: ChatTurn[]): void => {
    let assistantIndex = -1
    fetch(API_PREFIX + '/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId, message, history }),
    }).then(async (response) => {
      setTurns((prev) => {
        assistantIndex = prev.length
        return [...prev, { role: 'assistant', content: '' }]
      })
      await readSseStream(response, (delta) => {
        setTurns((prev) => {
          const copy = [...prev]
          copy[assistantIndex] = { role: 'assistant', content: (copy[assistantIndex]?.content ?? '') + delta }
          return copy
        })
      })
      setSending(false)
    }).catch(() => {
      setSending(false)
      setError(true)
    })
  }

  const sendNonStreaming = (message: string, history: ChatTurn[], nextTurns: ChatTurn[]): void => {
    fetch(API_PREFIX + '/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId, message, history }),
    }).then(async (response) => {
      const res = (await response.json()) as { ok: true; reply: string } | { ok: false; error: string }
      setSending(false)
      if (res.ok) setTurns([...nextTurns, { role: 'assistant', content: res.reply }])
      else setError(true)
    }, () => {
      setSending(false)
      setError(true)
    })
  }

  const send = (): void => {
    const message = draft.trim()
    if (message === '' || sending) return
    setDraft('')
    setError(false)
    const history = turns
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', content: message }]
    setTurns(nextTurns)
    setSending(true)
    if (streaming) sendStreaming(message, history)
    else sendNonStreaming(message, history, nextTurns)
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatHeader}>{t('ad.chat.title')}</div>
      <div className={styles.chatList} ref={listRef}>
        {turns.length === 0 && <div className={styles.chatEmpty}>{t('ad.chat.emptyState')}</div>}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant}>
            {turn.content}
            {streaming && sending && turn.role === 'assistant' && i === turns.length - 1 && (
              <span className={styles.chatTypingDot}>{t('ad.chat.streaming')}</span>
            )}
          </div>
        ))}
        {error && <div className={styles.chatError}>{t('ad.chat.error')}</div>}
      </div>
      <div className={styles.chatInputRow}>
        <input
          className={styles.chatInput}
          value={draft}
          placeholder={t('ad.chat.placeholder')}
          onChange={(e) => { setDraft(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          disabled={sending}
        />
        <button className={styles.chatSend} onClick={send} disabled={sending || draft.trim() === ''}>
          {sending ? t('ad.chat.sending') : t('ad.chat.send')}
        </button>
      </div>
    </div>
  )
}
