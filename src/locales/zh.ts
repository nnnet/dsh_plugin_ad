/**
 * Chinese copy for the ad plugin. Keep in lockstep with en.ts: every key
 * here must exist there too (and vice versa) — see locales/index.ts's AdKey.
 * @module @linxin666/dsh-ad/locales/zh
 */
export const zh = {
  // 组件外壳。
  'ad.widget.title': '广告',
  'ad.widget.loading': '加载中…',
  'ad.widget.empty': '暂无可展示的广告。',
  'ad.widget.error': '广告加载失败。',
  'ad.widget.refresh': '刷新',
  'ad.widget.dismiss': '关闭',
  'ad.widget.openLink': '前往',
  'ad.widget.sourcePicker': '来源',
  'ad.widget.clickHint': '点击跳转',

  // 聊天面板。
  'ad.chat.title': '咨询助手',
  'ad.chat.placeholder': '向助手咨询这件商品…',
  'ad.chat.send': '发送',
  'ad.chat.sending': '发送中…',
  'ad.chat.error': '助手暂时无法回复，请稍后重试。',
  'ad.chat.emptyState': '就这件商品提个问题开始咨询吧。',
  'ad.chat.unavailable': '该来源未提供聊天助手。',
  'ad.chat.streaming': '正在输入…',

  // 商品卡片（v0.2）：轮播、价格/折扣、CTA、详情。
  'ad.product.discount': '-{percent}%',
  'ad.product.priceFree': '免费',
  'ad.product.mediaPrev': '上一张',
  'ad.product.mediaNext': '下一张',
  'ad.product.detailsToggle': '详情',
  'ad.product.specs': '规格参数',
  'ad.cta.buy': '立即购买',
  'ad.cta.cart': '加入购物车',
  'ad.cta.link': '了解更多',
  'ad.cta.chat': '咨询助手',

  // 购物车。
  'ad.cart.title': '购物车',
  'ad.cart.empty': '购物车是空的。',
  'ad.cart.added': '已加入购物车',
  'ad.cart.remove': '移除',
  'ad.cart.qty': '数量',
  'ad.cart.total': '合计',
  'ad.cart.clear': '清空购物车',
  'ad.cart.checkoutHint': '结算需前往对应电商平台完成。',

  // 内容类型标签（用于来源选择器/诊断信息）。
  'ad.type.video': '视频',
  'ad.type.gif': 'GIF 动图',
  'ad.type.image': '图片',
  'ad.type.text': '文本',
  'ad.type.message': '消息',
  'ad.type.chat': '聊天',

  // 设置面板。
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
} as const
