/**
 * dsh-my-go — shared client constants (tisitan.15 split).
 *
 * Color palettes, label maps and glyph helpers used by both the orchestration
 * tree panel (panel-tree.js) and the settings editors (settings-core.js and
 * friends). Pure data + string helpers, zero React/state dependency.
 */

export const AGENT_TYPES = ['sisyphus', 'hermes', 'explore', 'librarian', 'looker', 'hephaestus', 'prometheus', 'oracle']
export const AGENT_LABELS = {
  sisyphus: '总调度·质检 Sisyphus',
  hermes: '快速执行 Hermes',
  explore: '快速检索 Explore',
  librarian: '文档查询 Librarian',
  looker: '多模态看图 Looker',
  hephaestus: '代码编写 Hephaestus',
  prometheus: '需求规划 Prometheus',
  oracle: '疑难/极端复杂兜底 Oracle',
}
export const typeLabel = (t) => AGENT_LABELS[t] ?? String(t ?? '?')
// 工种徽章色板（面板 chip / 设置页共用）：深色底上取中亮度、彼此可辨的克制色
export const AGENT_COLORS = {
  sisyphus: '#64b5f6',
  hermes: '#4db6ac',
  explore: '#4dd0e1',
  librarian: '#81c784',
  looker: '#ba68c8',
  hephaestus: '#ffb74d',
  prometheus: '#7986cb',
  oracle: '#e57373',
}
// 设置页卡片标题行的一句话角色说明
export const AGENT_BLURBS = {
  sisyphus: '接需求、派活、验收把关',
  hermes: '指令明确、步骤具体的体力活',
  explore: 'grep、读文件、定位符号',
  librarian: '读文档、API 参考、历史资料',
  looker: '识别截图、设计稿、图表',
  hephaestus: '单文件重构、模块实现、写测试',
  prometheus: '理解模糊需求，拆解成步骤',
  oracle: '其他工种都搞不定时再上',
}
export const typeName = (t) => { const s = String(t ?? '?'); return s.charAt(0).toUpperCase() + s.slice(1) }
// 面板状态色（左缘色条）：运行=青，队列=琥珀，求助=红，历史无条
export const ACCENT_RUNNING = '#26a69a'
export const ACCENT_QUEUE = '#e6a23c'
export const ACCENT_HELP = '#ef5350'
export const ACCENT_FALLBACK = '#ce93d8'
export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
export const INTENT_LABELS = { explore: '检索', read_doc: '查文档', look_image: '看图', replan: '请求换工种', execute: '请求代执行', ask_user: '请求问用户' }
export const intentLabel = (i) => INTENT_LABELS[i] ?? String(i ?? '?')
