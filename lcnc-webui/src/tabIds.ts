// The ids a TabNav tab and its panel share (design wave D3): the tab's
// `aria-controls` names the panel, the panel's `aria-labelledby` the tab.
export function tabIds(base: string, id: string): { tab: string; panel: string } {
  return { tab: `${base}-tab-${id}`, panel: `${base}-panel-${id}` };
}
