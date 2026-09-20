import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export interface ControlBox {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Beyond the visible part of a scrollable ancestor (reached by its scroll). */
  scrolledOut?: boolean;
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
    const visible: { x: number; y: number; width: number; height: number }[] = [];
    const controls = candidates.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const label = el.getAttribute('aria-label') || el.getAttribute('title') ||
        el.textContent?.trim().replace(/\s+/g, ' ') || el.getAttribute('name') || el.tagName;
      const id = `${name}/${el.tagName.toLowerCase()}[${i}]`;
      const box = { id, label, x: rect.x - bounds.x, y: rect.y - bounds.y,
        width: rect.width, height: rect.height };
      const issue = (kind: string, detail: string) => issues.push({ kind, controls: [id], detail });
      // The part of a control beyond the VISIBLE box of a scrollable
      // (auto/scroll) ancestor is reached by that scroll, not mislaid: the
      // control's VISIBLE rect (clamped to every scroll ancestor) is what
      // "outside" and the overlap pairs judge; a fully scrolled-out control
      // is exempt. Callers that must prove the hidden part measure again at
      // the other scroll end (tool-geometry.spec.ts).
      const vis = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      for (let parent = el.parentElement; parent && parent !== element; parent = parent.parentElement) {
        const css = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        if (['auto', 'scroll'].includes(css.overflowY)) { vis.top = Math.max(vis.top, clip.top); vis.bottom = Math.min(vis.bottom, clip.bottom); }
        if (['auto', 'scroll'].includes(css.overflowX)) { vis.left = Math.max(vis.left, clip.left); vis.right = Math.min(vis.right, clip.right); }
      }
      const scrolledOut = vis.right - vis.left < 1 || vis.bottom - vis.top < 1;
      if (rect.width < 4 || rect.height < 4) issue('collapsed', `${label}: ${rect.width} × ${rect.height}px`);
      if (!scrolledOut && (vis.left < bounds.left - 1 || vis.top < bounds.top - 1 || vis.right > bounds.right + 1 || vis.bottom > bounds.bottom + 1))
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
      visible.push({ x: vis.left - bounds.x, y: vis.top - bounds.y, width: vis.right - vis.left, height: vis.bottom - vis.top });
      return { ...box, scrolledOut };
    });
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        if (candidates[i]!.contains(candidates[j]!) || candidates[j]!.contains(candidates[i]!)) continue;
        if (controls[i]!.scrolledOut || controls[j]!.scrolledOut) continue;
        const a = visible[i]!, b = visible[j]!;
        const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (dx > 1 && dy > 1) issues.push({ kind: 'overlap', controls: [controls[i]!.id, controls[j]!.id],
          detail: `${controls[i]!.label} overlaps ${controls[j]!.label} by ${dx.toFixed(1)} × ${dy.toFixed(1)}px` });
      }
    }
    if (!controls.length) issues.push({ kind: 'empty', controls: [], detail: `${name}: no visible controls` });
    return { name, width: bounds.width, height: bounds.height, controls, issues };
  }, { name, selector });
}

// ── Frame envelope (WP4, UI-08) ──
// The three boxes whose geometry must not react to what the strip shows:
// the strip itself, the viewer pane and the content area. Each carries its
// bounding box AND its inner usable size (clientWidth/clientHeight): in
// portrait the strip's outer 280 px never changed while a vanished
// vertical scrollbar band widened its inner column and re-flowed every
// control — a bounding-box compare was blind to it.
export interface FrameBox {
  x: number; y: number; width: number; height: number;
  clientWidth: number; clientHeight: number;
}
export interface FrameSnapshot { strip: FrameBox; viewer: FrameBox; content: FrameBox }
export type FrameKey = keyof FrameSnapshot;
export type FrameDimension = keyof FrameBox;

export async function measureFrame(page: Page): Promise<FrameSnapshot> {
  return page.evaluate(() => {
    const box = (sel: string): FrameBox => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) throw new Error(`measureFrame: ${sel} not found`);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height,
        clientWidth: el.clientWidth, clientHeight: el.clientHeight };
    };
    return { strip: box('.strip'), viewer: box('.viewerPane'), content: box('.content') };
  });
}

/** Frame differences beyond `tolerance` px, as layout issues. `exempt`
 * names dimensions that MAY change for a state ("viewer.height" while a
 * macro bar takes its row); everything else is a regression. */
export function frameChanges(before: FrameSnapshot, after: FrameSnapshot, exempt: string[] = [],
  tolerance = 1): LayoutIssue[] {
  const out: LayoutIssue[] = [];
  for (const key of ['strip', 'viewer', 'content'] as const) {
    for (const dim of ['x', 'y', 'width', 'height', 'clientWidth', 'clientHeight'] as const) {
      if (exempt.includes(`${key}.${dim}`)) continue;
      const a = before[key][dim], b = after[key][dim];
      if (Math.abs(a - b) > tolerance) out.push({ kind: 'frame-change', controls: [key],
        detail: `${key}.${dim} ${a.toFixed(2)} → ${b.toFixed(2)}px` });
    }
  }
  return out;
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

/** A dialog must be the hit target at its corners and centre: nothing
 * (strip, banner, another overlay) may cover it, in any viewport. */
export async function expectDialogUncovered(dialog: Locator): Promise<void> {
  await expect(dialog).toHaveCount(1);
  const covered = await dialog.evaluate(el => {
    const r = el.getBoundingClientRect();
    // Probe points sit inside the dialog's rounded corners (radius-xl), not
    // on the 2-px corner that the border radius cuts away.
    const inset = 16;
    const pts: [number, number][] = [
      [r.left + inset, r.top + inset], [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset],
      [r.left + r.width / 2, r.top + r.height / 2],
    ];
    return pts.filter(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !hit || !el.contains(hit);
    }).map(([x, y]) => `${Math.round(x)},${Math.round(y)}`);
  });
  expect(covered, `dialog covered at ${covered.join(' ')}`).toEqual([]);
}
