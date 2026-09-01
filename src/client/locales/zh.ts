/**
 * Chinese UI copy for the dsh-ad widget. Mirrored verbatim by `en.ts` —
 * every key here must exist there (and vice versa). Add a new key to *both*
 * files in the same change.
 * @module dsh_plugin_ad/client/locales/zh
 */

export const zh = {
  // 组件外壳。
  'ad.widget.title': '广告',
  'ad.widget.loading': '加载中…',
  'ad.widget.empty': '暂无可展示的广告。',
  'ad.widget.error': '广告加载失败。',
  'ad.widget.refresh': '刷新',
  'ad.widget.videoUnavailable': '视频加载失败。',
  'ad.widget.dismiss': '关闭',
  'ad.widget.openLink': '前往',
  'ad.widget.sourcePicker': '来源',
  'ad.widget.clickHint': '点击跳转',
  'ad.widget.eligible': '可展示',
  'ad.widget.ineligibleFrequency': '已隐藏：曝光次数达到上限。',
  'ad.widget.ineligibleTargeting': '已隐藏：当前不匹配定向条件。',
  'ad.widget.itemCount': '共 {n} 条',
  'ad.widget.navPrev': '上一张',
  'ad.widget.navNext': '下一张',
  'ad.widget.resizeHint': '调整小部件大小',

  // 聊天面板。
  'ad.chat.title': '咨询助手',
  'ad.chat.placeholder': '向助手咨询这件商品…',
  'ad.chat.send': '发送',
  'ad.chat.sending': '发送中…',
  'ad.chat.error': '助手暂时无法回复，请稍后重试。',
  'ad.chat.emptyState': '就这件商品提个问题开始咨询吧。',
  'ad.chat.unavailable': '该来源未提供聊天助手。',
  'ad.chat.streaming': '正在输入…',

  // 商品卡片（市场渲染器）：轮播、价格/折扣、CTA、详情。
  'ad.product.discount': '-{percent}%',
  'ad.product.priceFree': '免费',
  'ad.product.mediaPrev': '上一张',
  'ad.product.mediaNext': '下一张',
  'ad.product.detailsToggle': '详情',
  'ad.product.specs': '规格参数',
  'ad.product.galleryCount': '{count} 个媒体',
  'ad.product.outOfStock': '缺货',
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

  // 内容类型标签。
  'ad.type.video': '视频',
  'ad.type.gif': 'GIF 动图',
  'ad.type.image': '图片',
  'ad.type.text': '文本',
  'ad.type.message': '消息',
  'ad.type.chat': '聊天',
  'ad.type.product': '商品',
  'ad.type.html': 'HTML',
  'ad.type.card': '卡片',
  'ad.type.raw': '原始',

  // 设置卡片（宿主 shell 通过 ad 命名空间的 TranslateNS 注入这些键，
  // 这样卡片里 `t('settings.title')` 等调用能直接解析到字符串）。
  'settings.title': '广告',
  'settings.description': '选择广告来源，像 Pet 一样拖动并定位小部件。',
  'settings.enabled': '启用广告',
  'settings.enabledHint': '关闭后隐藏小部件并停止轮询。',
  'settings.visible': '显示小部件',
  'settings.visibleHint': '关闭后小部件隐藏，但后台轮询继续。',
  'settings.decoration': '显示活动标签',
  'settings.decorationHint': '开启后小部件角落显示广告活动标签。',
  'settings.source': '广告来源',
  'settings.sourceHint': '使用哪个已配置的来源为小部件提供内容。',
  'settings.size': '宽度（px）',
  'settings.sizeHint': '小部件宽度，范围 200–800。',
  'settings.right': '右边距（px）',
  'settings.rightHint': '小部件距视口右边的距离，px。',
  'settings.bottom': '下边距（px）',
  'settings.bottomHint': '小部件距视口底部的距离，px。',
  'settings.rotation': '轮播间隔（毫秒）',
  'settings.rotationHint': '每张卡片展示多久后切换下一张，1000–600000 毫秒（1 秒 – 10 分钟）。',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'settings.overridden': '已覆盖',
  'settings.reset': '恢复默认',
  'settings.invalidNumber': '请输入数字，留空则使用默认值。',
  'settings.notExposed': '当前 DSH 部署未向设置页暴露 ad 配置命名空间。',
  'settings.readOnly': '当前部署的设置只读。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃',
  'settings.unsaved': '未保存',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',
} as const
