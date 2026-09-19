import { expect, type Locator, type TestInfo } from '@playwright/test';

export interface ControlBox {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LayoutIssue { kind: string; controls: string[]; detail: string }
export interface LayoutSnapshot {
  name: string;
  width: number;
  height: number;
  controls: ControlBox[];
  issues: LayoutIssue[];
}

/** Audit a bounded panel, not the whole scrolling page. Scrollable ancestors
 * outside the panel are deliberately excluded. Native controls are measured,
 * including disabled ones; their explanatory wrappers are not extra controls.
 * Nested controls are excluded from overlap pairs (e.g. a labelled toggle).
 */
export async function measureLayout(root: Locator, name: string,
  selector = 'button, input:not([type="hidden"]), select, textarea'): Promise<LayoutSnapshot> {
  await expect(root).toHaveCount(1);
  return root.evaluate((element, { name, selector }) => {
    const bounds = element.getBoundingClientRect();
    const issues: LayoutIssue[] = [];
    const candidates = [...element.querySelectorAll<HTMLElement>(selector)].filter(el => {
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (node === element) break;
      }
      return true;
    });
    const controls = candidates.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const label = el.getAttribute('aria-label') || el.getAttribute('title') ||
        el.textContent?.trim().replace(/\s+/g, ' ') || el.getAttribute('name') || el.tagName;
      const id = `${name}/${el.tagName.toLowerCase()}[${i}]`;
      const box = { id, label, x: rect.x - bounds.x, y: rect.y - bounds.y,
        width: rect.width, height: rect.height };
      const issue = (kind: string, detail: string) => issues.push({ kind, controls: [id], detail });
      if (rect.width < 4 || rect.height < 4) issue('collapsed', `${label}: ${rect.width} × ${rect.height}px`);
      if (box.x < -1 || box.y < -1 || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1)
        issue('outside-panel', `${label} extends outside ${name}`);
      // Inputs may intentionally scroll their value; button labels must fit.
      if (el.tagName === 'BUTTON' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1))
        issue('clipped-label', `${label}: content ${el.scrollWidth} × ${el.scrollHeight}, box ${el.clientWidth} × ${el.clientHeight}`);
      for (let parent = el.parentElement; parent && parent !== element; parent = parent.parentElement) {
        const css = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        // auto/scroll is intentional navigation, hidden/clip is not navigable.
        if ((['hidden', 'clip'].includes(css.overflowX) && (rect.left < clip.left - 1 || rect.right > clip.right + 1)) ||
            (['hidden', 'clip'].includes(css.overflowY) && (rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1)))
          issue('clipped-control', `${label} is clipped by ${parent.tagName.toLowerCase()}.${parent.className}`);
      }
      return box;
    });
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        if (candidates[i]!.contains(candidates[j]!) || candidates[j]!.contains(candidates[i]!)) continue;
        const a = controls[i]!, b = controls[j]!;
        const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (dx > 1 && dy > 1) issues.push({ kind: 'overlap', controls: [a.id, b.id],
          detail: `${a.label} overlaps ${b.label} by ${dx.toFixed(1)} × ${dy.toFixed(1)}px` });
      }
    }
    if (!controls.length) issues.push({ kind: 'empty', controls: [], detail: `${name}: no visible controls` });
    return { name, width: bounds.width, height: bounds.height, controls, issues };
  }, { name, selector });
}

/** Compare only within one viewport/profile. Labels and enabled state may
 * change, but a permission change must not move, resize or remove controls. */
export function layoutChanges(before: LayoutSnapshot, after: LayoutSnapshot, tolerance = 1): LayoutIssue[] {
  const changes: LayoutIssue[] = [];
  if (before.controls.length !== after.controls.length) changes.push({ kind: 'control-count', controls: [],
    detail: `${before.name}: ${before.controls.length} controls became ${after.controls.length}` });
  for (let i = 0; i < Math.min(before.controls.length, after.controls.length); i++) {
    const a = before.controls[i]!, b = after.controls[i]!;
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      if (Math.abs(a[dimension] - b[dimension]) > tolerance) changes.push({ kind: 'geometry-change',
        controls: [b.id], detail: `${b.label}: ${dimension} ${a[dimension].toFixed(2)} → ${b[dimension].toFixed(2)}px` });
    }
  }
  return changes;
}

/** Attach machine-readable geometry and a marked screenshot before failing.
 * Outlines are test-only and do not affect layout or conceal controls. */
export async function assertLayout(root: Locator, snapshot: LayoutSnapshot, info: TestInfo,
  extra: LayoutIssue[] = []): Promise<void> {
  const issues = [...snapshot.issues, ...extra];
  if (issues.length) {
    await info.attach(`${snapshot.name}-layout.json`, {
      body: JSON.stringify({ ...snapshot, issues }, null, 2), contentType: 'application/json',
    });
    await root.scrollIntoViewIfNeeded();
    await root.evaluate((el, boxes) => {
      for (const box of boxes) {
        const marker = document.createElement('div');
        Object.assign(marker.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
          outline: '2px solid magenta', left: `${el.getBoundingClientRect().x + box.x}px`,
          top: `${el.getBoundingClientRect().y + box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
        marker.dataset.layoutMarker = 'true';
        document.body.append(marker);
      }
    }, snapshot.controls.filter(box => issues.some(issue => issue.controls.includes(box.id))));
    try {
      await info.attach(`${snapshot.name}-layout.png`, { body: await root.screenshot(), contentType: 'image/png' });
    } finally {
      await root.page().locator('[data-layout-marker]').evaluateAll(nodes => nodes.forEach(node => node.remove()));
    }
  }
  expect(issues, `${snapshot.name}: layout defects\n${issues.map(issue => issue.detail).join('\n')}`).toEqual([]);
}
