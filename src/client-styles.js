/**
 * dsh-my-go — configuration card stylesheet (0.5.0-tisitan.3).
 *
 * The settings face used to be a stack of inline styles: one column, everything
 * always expanded, and no way to state a layout contract (a grid column width or
 * an ellipsis rule cannot be asserted from a JS object). The page now rides the
 * official plugin page, so its layout lives here as one stylesheet with
 * `mygo-` classes, built on the host's own color aliases and with zero
 * animation / backdrop-filter / break-all.
 *
 * The panel (overlay tree, usage panel) keeps its inline styles — that surface
 * is not part of this migration and shares nothing with these rules.
 */

/** One rule block; the tests read this string as the layout contract. */
export const SETTINGS_CSS = `
.mygo-config {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, #ddd);
}
.mygo-intro {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #999);
  overflow-wrap: anywhere;
}
.mygo-notice,
.mygo-blocked {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2, #444);
  background: var(--dsw-alias-bg-layer-1, #232323);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.mygo-noticeWarn {
  border-color: rgba(230, 162, 60, 0.45);
}
.mygo-noticeError {
  border-color: var(--dsw-alias-state-error-primary, #f44336);
}
.mygo-block {
  border: 1px solid var(--dsw-alias-border-l1, #333);
  border-radius: 8px;
  padding: 12px;
  background: var(--dsw-alias-bg-layer-1, #1f1f1f);
}
.mygo-blockHead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.mygo-blockTitle {
  font-size: 13px;
  font-weight: 600;
}
.mygo-blockHint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #777);
  overflow-wrap: anywhere;
}
.mygo-count {
  font-size: 10px;
  line-height: 15px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-secondary, #999);
}
.mygo-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
.mygo-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mygo-colHead,
.mygo-colFoot {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mygo-colFoot {
  margin-top: 2px;
}
.mygo-list {
  height: 252px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l1, #333);
  border-radius: 6px;
  padding: 2px;
  background: var(--dsw-alias-bg-layer-2, #1a1a1a);
}
.mygo-listRow {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
  cursor: pointer;
}
.mygo-listRow[data-selected='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgba(47, 111, 237, 0.18));
}
.mygo-rowName {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.mygo-rowMeta {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #777);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mygo-rowBadge {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 14px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2, #444);
  color: var(--dsw-alias-label-secondary, #999);
}
.mygo-rowBadge[data-tone='on'] {
  border-color: var(--dsw-alias-state-success-primary, #4caf50);
  color: var(--dsw-alias-state-success-primary, #4caf50);
}
.mygo-rowBadge[data-tone='warn'] {
  border-color: rgba(230, 162, 60, 0.6);
  color: #e6a23c;
}
.mygo-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.mygo-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mygo-fieldWide {
  grid-column: 1 / -1;
}
.mygo-label {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #999);
}
.mygo-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #777);
  overflow-wrap: anywhere;
}
.mygo-input,
.mygo-select,
.mygo-textarea {
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2, #444);
  background: var(--dsw-alias-bg-layer-2, #161616);
  color: var(--dsw-alias-label-primary, #ddd);
  font-size: 12px;
  font-family: inherit;
}
.mygo-inputMono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.mygo-textarea {
  min-height: 60px;
  resize: vertical;
}
.mygo-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.mygo-chain {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mygo-chainRow {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) minmax(0, 1fr) 70px;
  gap: 6px;
  align-items: center;
}
.mygo-chainIndex {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #999);
}
.mygo-chainActors {
  display: flex;
  gap: 4px;
}
.mygo-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mygo-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.07));
  color: var(--dsw-alias-label-secondary, #999);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.mygo-chipName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mygo-chipKill {
  cursor: pointer;
  color: var(--dsw-alias-state-error-primary, #e57373);
  flex-shrink: 0;
}
.mygo-detail {
  min-height: 62px;
  max-height: 124px;
  overflow-y: auto;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2, #444);
  background: var(--dsw-alias-bg-layer-2, #1a1a1a);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #999);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mygo-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #777);
}
.mygo-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mygo-btn,
.mygo-btnPrimary {
  height: 26px;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--dsw-alias-border-l2, #444);
  background: var(--dsw-alias-button-tool-bar-fill, transparent);
  color: var(--dsw-alias-label-primary, #ddd);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.mygo-btnPrimary {
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #2f6fed));
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #111);
  font-weight: 600;
}
.mygo-btnMini {
  height: 22px;
  padding: 0 6px;
  font-size: 11px;
}
.mygo-btn:disabled,
.mygo-btnPrimary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.mygo-status {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #777);
  overflow-wrap: anywhere;
}
.mygo-statusOk {
  font-size: 12px;
  color: var(--dsw-alias-state-success-primary, #4caf50);
  overflow-wrap: anywhere;
}
.mygo-statusError {
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary, #f44336);
  overflow-wrap: anywhere;
}
.mygo-summary {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #999);
  overflow-wrap: anywhere;
}
`

/** Style tag identity, so repeat mounts and unloads are exact. */
export const STYLE_TAG = 'dsh-my-go/settings.css'

/**
 * Ensure the stylesheet is present once per document. Called from the slot
 * registration, not at import time: the module may load in a node --test worker
 * where no document exists at all.
 * @returns a disposer removing the tag this call added (a no-op when it was
 *   already there or when there is no DOM).
 */
export function mountSettingsStyles() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return () => {}
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_TAG}"]`)
  if (existing !== null && existing !== undefined) return () => {}
  const tag = document.createElement('style')
  tag.setAttribute('data-plugin', 'dsh-my-go')
  tag.setAttribute('data-plugin-css', STYLE_TAG)
  tag.textContent = SETTINGS_CSS
  document.head.appendChild(tag)
  return () => {
    if (tag.isConnected === false) return
    tag.remove()
  }
}
