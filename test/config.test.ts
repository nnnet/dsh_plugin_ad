/**
 * Unit tests for `src/config.ts`: schemastery validation, credential
 * resolution, and file-based config loading. Run with `npx vitest`.
 */

import { describe, expect, it } from 'vitest'
import {
  adConfigSchema,
  adSourceSchema,
  resolveCredentials,
  resolveSecret,
  loadConfigFromFile,
} from '../src/config.ts'

describe('config: secret resolution', () => {
  it('returns the plain value when no env var is configured', () => {
    expect(resolveSecret('user', undefined)).toBe('user')
  })

  it('returns the env value when the env var is set', () => {
    const previous = process.env.TEST_DSH_AD_LOGIN
    process.env.TEST_DSH_AD_LOGIN = 'from-env'
    try {
      expect(resolveSecret('inline', 'TEST_DSH_AD_LOGIN')).toBe('from-env')
    } finally {
      if (previous === undefined) delete process.env.TEST_DSH_AD_LOGIN
      else process.env.TEST_DSH_AD_LOGIN = previous
    }
  })

  it('env wins when both are set', () => {
    const previous = process.env.TEST_DSH_AD_LOGIN
    process.env.TEST_DSH_AD_LOGIN = 'from-env'
    try {
      expect(resolveSecret('inline', 'TEST_DSH_AD_LOGIN')).toBe('from-env')
    } finally {
      if (previous === undefined) delete process.env.TEST_DSH_AD_LOGIN
      else process.env.TEST_DSH_AD_LOGIN = previous
    }
  })

  it('falls back to plain when env var is empty', () => {
    const previous = process.env.TEST_DSH_AD_LOGIN
    process.env.TEST_DSH_AD_LOGIN = ''
    try {
      expect(resolveSecret('inline', 'TEST_DSH_AD_LOGIN')).toBe('inline')
    } finally {
      if (previous === undefined) delete process.env.TEST_DSH_AD_LOGIN
      else process.env.TEST_DSH_AD_LOGIN = previous
    }
  })
})

describe('config: resolveCredentials', () => {
  it('returns an empty bag when no credentials are configured', () => {
    const resolved = resolveCredentials(undefined)
    expect(resolved).toEqual({
      extra: {},
      fromEnv: { login: false, password: false, apiKey: false, token: false },
    })
  })

  it('passes through extra headers verbatim', () => {
    const resolved = resolveCredentials({ extra: { clientId: 'widget' } })
    expect(resolved.extra).toEqual({ clientId: 'widget' })
  })
})

describe('config: schemastery validation', () => {
  it('rejects unknown content types', () => {
    expect(() => adSourceSchema({
      id: 'a',
      name: 'a',
      contentTypes: ['hologram'],
    } as never)).toThrow()
  })

  it('rejects poll intervals below the minimum', () => {
    expect(() => adSourceSchema({
      id: 'a',
      name: 'a',
      contentTypes: ['image'],
      pollIntervalMs: 100,
    } as never)).toThrow()
  })

  it('accepts a valid source', () => {
    expect(() => adSourceSchema({
      id: 'csgo',
      name: 'CS:GO Market',
      contentTypes: ['image', 'product', 'chat'],
      allowHosts: ['market.csgo.com', 'cdn2.csgo.com'],
      pollIntervalMs: 60_000,
      maxResponseBytes: 1_048_576,
      frequencyCap: { maxImpressions: 5, windowMs: 600_000 },
      targeting: { locales: ['en', 'zh'], paths: ['/shop'] },
    } as never)).not.toThrow()
  })
})

describe('config: file-based loading', () => {
  it('returns the inline config when no file is configured', () => {
    const cfg = loadConfigFromFile({ enabled: true, sources: [] })
    expect(cfg.enabled).toBe(true)
  })
})
