import { describe, expect, it } from 'vitest'
import { getPath, renderTemplate, resolveConfig, secret } from '../src/config.ts'
import { en } from '../src/locales/en.ts'
import { zh } from '../src/locales/zh.ts'

describe('config', () => {
  it('resolves nested paths and templates', () => {
    const context = { payload: { product: { id: 'p-1' } }, locale: 'zh-CN' }
    expect(getPath(context, 'payload.product.id')).toBe('p-1')
    expect(renderTemplate('/p/{{payload.product.id}}?lang={{locale}}', context)).toBe('/p/p-1?lang=zh-CN')
  })
  it('resolves env secrets', () => {
    expect(secret({ env: 'PASSWORD' }, { PASSWORD: 'secret' })).toBe('secret')
  })
  it('clamps unsafe polling values', () => {
    expect(resolveConfig({ pollIntervalMs: 1 }).pollIntervalMs).toBe(5000)
  })
})

describe('locales', () => {
  it('keeps English and Chinese key sets identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
