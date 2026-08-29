/**
 * Chinese UI copy for dsh-ad. Mirrored verbatim by `en.ts` — every key here
 * must exist there (and vice versa). Add a new key to *both* files in the
 * same change.
 * @module dsh_plugin_ad/locales/zh
 */

export const zh = {
  // 设置面板（host）。
  'settings.title': '广告',
  'settings.description': '选择广告来源，并控制组件是否显示。',
  'settings.enabled': '启用广告',
  'settings.enabledHint': '关闭后组件隐藏，并停止轮询。',
  'settings.visible': '显示组件',
  'settings.visibleHint': '关闭后组件隐藏，但后台仍继续轮询。',
  'settings.activeSource': '广告来源',
  'settings.activeSourceHint': '组件内容取自哪一个已配置的来源。',
  'settings.noSources': '尚未配置广告来源，请在插件配置的 `sources` 中添加。',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃',
  'settings.unsaved': '未保存',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',

  // 来源选择器诊断信息。
  'source.disabled': '已禁用',
  'source.noAuth': '未配置凭据（公开信息流）。',
  'source.usingEnv': '凭据从环境变量读取。',
  'source.usingPlain': '凭据直接写在配置文件中。',
  'source.streamingChat': '已启用流式聊天。',
  'source.staticChat': '非流式聊天（每次返回完整 JSON 回复）。',

  // 内容类型标签（用于来源选择器/诊断信息）。
  'type.video': '视频',
  'type.gif': 'GIF 动图',
  'type.image': '图片',
  'type.text': '文本',
  'type.message': '消息',
  'type.chat': '聊天',
  'type.product': '商品',
  'type.html': 'HTML',
  'type.card': '卡片',
  'type.raw': '原始',
} as const
