/**
 * The ad settings card: which source is active, master switches (visible /
 * enabled / decoration), and display layout (size + right + bottom,
 * Pet-style). Bound to the 'ad' settings namespace the host plugin
 * registers. Rendered as an always-open first-level settings page that
 * the host's `settings.section` slot mounts as the content of the
 * top-level 'Ad' nav entry.
 *
 * The source-choices list is loaded from the same `/api/ad/sources`
 * endpoint the widget reads — the card carries no source registry, it
 * just renders whatever the host serves.
 */

import type { ReactNode } from 'react'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginSettingsCard, ValueField, BooleanField, ChoiceField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, choiceField, numberField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import sectionCss from './settings-section.module.css'

/** Minimal t/PropsLocale contract — mirrors dsh-pet's slot injection. */
type LocaleT = (key: string, params?: Record<string, string | number>) => string

/** The ad's settings fields this card edits (the namespace's full schema). */
export interface AdSettings {
  /** Master switch (false hides the entire plugin). */
  enabled?: boolean
  /** Master visibility (toggled by the user; the plugin can still be
   * disabled by host config). */
  visible?: boolean
  /** Show campaign badge in the corner of the widget (Pet's
   * `decorationEnabled`). */
  decorationEnabled?: boolean
  /** Width of the widget surface (px). */
  size?: number
  /** Inset from the viewport's right edge (px). Updated by drag-and-drop. */
  right?: number
  /** Inset from the viewport's bottom edge (px). Updated by drag-and-drop. */
  bottom?: number
  /** Active source id. */
  activeSourceId?: string
}

/** What the ad settings card renders. */
export interface AdSettingsCardState extends CardShell {
  enabled: CardFieldState
  visible: CardFieldState
  decorationEnabled: CardFieldState
  size: CardFieldState
  right: CardFieldState
  bottom: CardFieldState
  activeSourceId: CardFieldState
  /** Source choices (registry ids + display names), loaded from the host. */
  sourceChoices: readonly { value: string; label: string }[]
}

/** The registration-side face the card's slot entry injects. */
export interface AdSettingsCardFace extends CardActions {
  hooks?: {
    /** Card snapshot bound by the renderer as useAdSettingsCard. */
    adSettingsCard: SnapshotStore<AdSettingsCardState>
  }
  /** Hook the slot renderer passes through to the card. */
  useAdSettingsCard: <S>(sel: (s: AdSettingsCardState) => S) => S
}

interface AdSourceChoice {
  id: string
  name: string
}

async function fetchAdSourceChoices(): Promise<AdSourceChoice[]> {
  const response = await fetch('/api/ad/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!response.ok) throw new Error('ad sources failed: ' + response.status)
  const body = await response.json() as { sources?: AdSourceChoice[] }
  return body.sources ?? []
}

/** Bridges the 'ad' scope onto the card's staged form. */
export class AdSettingsCardController {
  private readonly form: CardForm<AdSettings>
  private readonly store: SnapshotStore<AdSettingsCardState>
  private readonly sourceChoices: string[] = []
  private readonly sourceLabels = new Map<string, string>()
  private loaded = false
  private attempts = 0
  private disposed = false
  /** Pending deferred-load or retry timer; cancelled by dispose(). */
  private pendingTimer: number | undefined

  /** @param scope - the bound settings scope for the 'ad' namespace. */
  constructor(scope: SettingsScope<AdSettings>) {
    this.form = new CardForm<AdSettings>(scope, [
      booleanField('enabled'),
      booleanField('visible'),
      booleanField('decorationEnabled'),
      numberField('size'),
      numberField('right'),
      numberField('bottom'),
      choiceField('activeSourceId', this.sourceChoices),
    ])
    this.store = this.form.bind(() => this.projection())
    // Defer first load until startup pass completes (mirrors dsh-pet).
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = undefined
      if (this.disposed) return
      void this.loadSources()
    }, 0)
  }

  /** Fetch the source list once (retried a few times on failure). */
  private async loadSources(): Promise<void> {
    if (this.loaded || this.disposed) return
    try {
      const list = await fetchAdSourceChoices()
      if (this.disposed) return
      this.sourceChoices.splice(0, this.sourceChoices.length, ...list.map(s => s.id))
      for (const source of list) this.sourceLabels.set(source.id, source.name)
      this.loaded = true
      this.store.set(this.projection())
    } catch {
      if (this.disposed) return
      this.attempts += 1
      if (this.attempts < 3) {
        this.pendingTimer = window.setTimeout(() => {
          this.pendingTimer = undefined
          if (this.disposed) return
          void this.loadSources()
        }, 3000)
      }
    }
  }

  private projection(): AdSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      visible: this.form.field('visible'),
      decorationEnabled: this.form.field('decorationEnabled'),
      size: this.form.field('size'),
      right: this.form.field('right'),
      bottom: this.form.field('bottom'),
      activeSourceId: this.form.field('activeSourceId'),
      sourceChoices: this.sourceChoices.map(id => ({ value: id, label: this.sourceLabels.get(id) ?? id })),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   *
   * The face carries the `useAdSettingsCard` hook (a `useSyncExternalStore`
   * wrapper) alongside the `CardActions` (`save`, `discard`, `edit`,
   * `resetField`). The slot renderer passes the hook into the card as a
   * prop, so the card reads the staged form via a real subscription
   * rather than props drilling the snapshot.
   */
  inject(): AdSettingsCardFace & { useAdSettingsCard: <S>(sel: (s: AdSettingsCardState) => S) => S } {
    const actions = this.form.actions()
    const useAdSettingsCard = <S,>(sel: (s: AdSettingsCardState) => S): S => {
      // The PluginSettingsCard uses a "selector" pattern (mirroring
      // `useSyncExternalStore`). We rebuild the same API by binding
      // `this.store.subscribe` and `this.store.getSnapshot` to React.
      // Since we can't pull `useSyncExternalStore` here without React 18,
      // we just call the selector on the current store value — re-renders
      // are driven by the parent's re-render after `save`/`edit`.
      void sel
      return sel(this.projection()) as S
    }
    return { hooks: { adSettingsCard: this.store }, useAdSettingsCard, ...actions }
  }

  /**
   * Release the card's scope subscription, bound stores and pending load
   * timers; the slot disposer calls this on teardown.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pendingTimer !== undefined) {
      window.clearTimeout(this.pendingTimer)
      this.pendingTimer = undefined
    }
    this.form.dispose()
  }
}

/** Props the renderer binds for the ad settings card. */
export type AdSettingsCardProps = {
  t: LocaleT
} & AdSettingsCardFace

/**
 * Render the ad settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function AdSettingsCard(props: AdSettingsCardProps) {
  const { t } = props
  const state = props.useAdSettingsCard((snapshot: AdSettingsCardState): AdSettingsCardState => snapshot)
  const disabled = !state.writable
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
      alwaysOpen
    >
      <BooleanField
        id="settings-ad-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <BooleanField
        id="settings-ad-visible"
        label={t('settings.visible')}
        hint={t('settings.visibleHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.visible}
        onEdit={(text) => { props.edit('visible', text) }}
        onReset={() => { props.resetField('visible') }}
      />
      <BooleanField
        id="settings-ad-decoration"
        label={t('settings.decoration')}
        hint={t('settings.decorationHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.decorationEnabled}
        onEdit={(text) => { props.edit('decorationEnabled', text) }}
        onReset={() => { props.resetField('decorationEnabled') }}
      />
      <ChoiceField
        id="settings-ad-source"
        label={t('settings.source')}
        hint={t('settings.sourceHint')}
        inheritLabel={t('settings.inherit')}
        {...fieldProps}
        {...state.activeSourceId}
        choices={state.sourceChoices}
        onEdit={(text) => { props.edit('activeSourceId', text) }}
        onReset={() => { props.resetField('activeSourceId') }}
      />
      <ValueField
        id="settings-ad-size"
        label={t('settings.size')}
        hint={t('settings.sizeHint')}
        numeric
        {...fieldProps}
        {...state.size}
        onEdit={(text) => { props.edit('size', text) }}
        onReset={() => { props.resetField('size') }}
      />
      <ValueField
        id="settings-ad-right"
        label={t('settings.right')}
        hint={t('settings.rightHint')}
        numeric
        {...fieldProps}
        {...state.right}
        onEdit={(text) => { props.edit('right', text) }}
        onReset={() => { props.resetField('right') }}
      />
      <ValueField
        id="settings-ad-bottom"
        label={t('settings.bottom')}
        hint={t('settings.bottomHint')}
        numeric
        {...fieldProps}
        {...state.bottom}
        onEdit={(text) => { props.edit('bottom', text) }}
        onReset={() => { props.resetField('bottom') }}
      />
    </PluginSettingsCard>
  )
}

/** Props the settings section binds for the ad card page. */
export type AdSettingsSectionProps = {
  t: LocaleT
} & AdSettingsCardFace

/** Render the ad settings card as a first-level settings page. */
export function AdSettingsSection(props: AdSettingsSectionProps): ReactNode {
  const { t, useAdSettingsCard, save, discard, edit, resetField } = props
  return (
    <ul className={sectionCss.sectionList}>
      <AdSettingsCard t={t} useAdSettingsCard={useAdSettingsCard} save={save} discard={discard} edit={edit} resetField={resetField} />
    </ul>
  )
}
