import { expect, type Page } from '@playwright/test';
import { ctl, MOCK } from './ctl';
import { Folder, serveNow } from './macroFolder';
import { GATE_NAMES, type Permissions } from '../src/permissions';

export const PROFILES = [
  { name: '3axis-xyz', axes: ['X', 'Y', 'Z'], kins: null },
  { name: '5axis-xyzac', axes: ['X', 'Y', 'Z', 'A', 'C'],
    kins: { module: 'xyzac-trt-kins', type: 'xyzac-trt', identity_first: true, params: {} } },
  { name: '6axis-twp', axes: ['X', 'Y', 'Z', 'A', 'B', 'C'],
    kins: { module: 'xyzacb_trsrn', type: 'xyzacb-trsrn', identity_first: false, params: {} } },
] as const;
export type Profile = typeof PROFILES[number];
export const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 1000, touch: false },
  { name: 'compact', width: 1024, height: 768, touch: false },
  { name: 'touch-landscape', width: 1280, height: 800, touch: true },
  { name: 'touch-portrait', width: 900, height: 1200, touch: true },
] as const;
export type LayoutViewport = typeof VIEWPORTS[number];
export const PANELS = {
  safety: '.safetyStrip', jog: '[data-strip="jog"]', setup: '[data-strip="setup"]',
  overrides: '[data-strip="overrides"]', spindle: '[data-strip="spindle"]', tool: '[data-strip="tool"]',
};
export type LayoutState = 'homed' | 'unhomed' | 'off' | 'estop' | 'disarmed' | 'running' | 'paused' | 'tcp' | 'plane' | 'plane-stale';

// Representative gateway envelopes for rendering. Backend permission tests
// remain authoritative for machine policy; this fixture never drives LinuxCNC.
export async function setLayoutState(page: Page, profile: Profile, state: LayoutState) {
  const permissions = Object.fromEntries(GATE_NAMES.map(key => [key, true])) as Permissions;
  permissions.pause = false;
  permissions.resume = false;
  const disabled: (keyof Permissions)[] = [];
  if (state === 'unhomed') disabled.push('ready', 'run', 'jog', 'probe', 'touchoff', 'touchoffRotary',
    'machineFrame', 'goZero', 'planeFrame', 'twpCapture', 'surfaceComp');
  if (['off', 'estop', 'running', 'paused'].includes(state)) disabled.push('idle', 'ready', 'run', 'jog', 'probe',
    'zero', 'touchoff', 'touchoffRotary', 'machineFrame', 'goZero', 'planeFrame', 'twpCapture', 'surfaceComp');
  if (state === 'estop') disabled.push('safety', 'setup', 'override');
  if (state === 'tcp') disabled.push('touchoffRotary', 'machineFrame', 'goZero');
  if (state.startsWith('plane')) disabled.push('touchoffRotary', 'machineFrame', 'twpCapture');
  if (state === 'plane-stale') disabled.push('planeFrame', 'jog', 'goZero', 'run');
  for (const key of disabled) permissions[key] = false;
  permissions.pause = state === 'running';
  permissions.resume = state === 'paused';
  const isHomed = !['unhomed', 'off', 'estop'].includes(state);
  await ctl({ op: 'status_delta', armed: state !== 'disarmed', data: {
    homed: isHomed, homed_joints: profile.axes.map(() => isHomed),
    estop: state === 'estop', is_estop: state === 'estop',
    enabled: !['off', 'estop'].includes(state), is_enabled: !['off', 'estop'].includes(state),
    emc_enable_in: state !== 'estop', task_mode: state === 'running' || state === 'paused' ? 2 : 1,
    interp_state: state === 'running' ? 2 : state === 'paused' ? 3 : 1,
    paused: state === 'paused', motion_mode: 1,
    active_file: '/layout-example.ngc', program_elapsed_ms: 0,
    kins_type: profile.kins ? state === 'tcp' ? 1 : state.startsWith('plane') ? 2 : 0 : null,
    g5x_index: state.startsWith('plane') ? 6 : 1,
    twp_defined: state.startsWith('plane'), twp_active: state.startsWith('plane'),
    twp_pose_a: 0, twp_pose_b: 0, twp_pose_c: 0,
    rotary_abc: [state === 'plane-stale' ? 20 : 0, 0, 0],
    permissions, permission_reasons: Object.fromEntries(disabled.map(key => [key, `Unavailable in ${state}: return to a ready machine state`])),
  } });
  // A ctl receipt only acknowledges the mock, not WebSocket delivery or Vue's
  // render. Wait for independent state indicators before measuring anything.
  const status = (label: string) => page.locator('.safetyStrip .statusRow')
    .filter({ has: page.locator('.label-muted', { hasText: new RegExp(`^${label}$`) }) })
    .locator('.stable-width > span:not(.alt)');
  await expect(status('E-Stop')).toHaveText(state === 'estop' ? 'ACTIVE' : 'CLEAR');
  await expect(status('Power')).toHaveText(['off', 'estop'].includes(state) ? 'OFF' : 'ON');
  await expect(status('Axes')).toHaveText(isHomed ? 'HOMED' : 'UNHOMED');
  await expect(status('Mode')).toHaveText(['running', 'paused'].includes(state) ? 'AUTO' : 'MANUAL');
  await expect(status('Interp')).toHaveText(state === 'running' ? 'RUNNING' : state === 'paused' ? 'PAUSED' : 'IDLE');
  await expect(page.locator(`.pill.${state === 'disarmed' ? 'disarmed' : 'armed'}`)).toHaveCount(1);
  await expect(page.locator('[data-strip="setup"]').getByRole('button', {
    name: isHomed ? 'Unhome All' : 'Home All', exact: true,
  })).toBeAttached();
  if (profile.kins) {
    const mode = state === 'tcp' ? 1 : state.startsWith('plane') ? 2 : 0;
    await expect(page.getByRole('radiogroup', { name: 'Kinematics frame', exact: true })
      .getByRole('radio', { name: ['Machine', 'TCP', 'Plane'][mode], exact: true })).toHaveAttribute('aria-checked', 'true');
  }
  if (profile.name === '6axis-twp') {
    // The plane's state has its reserved line under the frame (operator P7).
    await expect(page.locator('[data-strip="jog"] .choiceNote'))
      .toHaveText(state === 'plane-stale' ? 'Plane stale — press Orient' : /^(\u00a0|Plane: .*)$/);
  }
  await settleLayout(page);
}

export async function openLayout(page: Page, profile: Profile, viewport: LayoutViewport) {
  await ctl({ op: 'reset' });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  if (viewport.touch) await page.evaluate(() => document.documentElement.classList.add('touch-device'));
  await ctl({ op: 'setAxes', axes: profile.axes });
  await ctl({ op: 'setKins', kins: profile.kins });
  await setLayoutState(page, profile, 'homed');
  await expect(page.locator('input.setupInput')).toHaveCount(profile.axes.length);
  await expect(page.locator('[data-strip="setup"]').getByRole('button', { name: 'Unhome All', exact: true })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
}

// ── Strip states (WP4, UI-08) ──
// Everything the bottom strip can SHOW instead of, or next to, its six
// sections — and every banner/bar that changes the rows above it. The
// layout gate enters each state from the homed baseline and requires the
// frame (strip / viewer / content, outer AND inner sizes) and the
// always-visible reference controls to stay put.
export type StripState = 'keypad-setup' | 'keypad-panel' | 'gcode-keypad' | 'macro-bar'
  | 'banner-estop' | 'banner-unhomed' | 'banner-message' | 'kins-chip';
export const STRIP_STATES: StripState[] = ['keypad-setup', 'keypad-panel', 'gcode-keypad', 'macro-bar',
  'banner-estop', 'banner-unhomed', 'banner-message', 'kins-chip'];

/** The Setup section's axis rows: in PORTRAIT all it keeps while the
 * keypad edits one of its fields (design wave D7 — Zero All, Go to and the
 * WCS block fold so the edited field stays in view at 150 %). */
export const SETUP_AXIS_ROWS = '[data-strip="setup"] .axisGrids';

/** Reference controls that stay visible in a state: the pinned Safety
 * section always, plus the keypad's OWNER section (it keeps its place
 * right of Safety while the others hide; in portrait its axis rows). */
export function stripStateRefs(state: StripState, portrait = false): string[] {
  if (state === 'keypad-setup') return [PANELS.safety, portrait ? SETUP_AXIS_ROWS : PANELS.setup];
  return [PANELS.safety];
}

/** Frame dimensions a state may legitimately change: a macro bar takes a
 * row above the strip in landscape (viewer, side pane and content lose
 * height, the strip moves up) and, in portrait, a row under the viewer in
 * the viewer's own column (package 5, stage A: the viewer alone loses height
 * — content and side pane stay exactly where they were). Nothing else, ever. */
export function stripStateExempt(state: StripState, portrait = false): string[] {
  if (state !== 'macro-bar') return [];
  return portrait
    ? ['viewer.height', 'viewer.clientHeight']
    : ['viewer.height', 'viewer.clientHeight', 'content.height', 'content.clientHeight',
       'side.height', 'side.clientHeight', 'strip.y'];
}

/** One macro file on the bar (macroFolder.ts): face_top, "Face top". */
const MACRO_BAR = { macros: { macros: [], bar: ['face_top'] } };

async function keypadCancel(page: Page) {
  const strip = page.locator('.nkStrip');
  if (await strip.count()) {
    await strip.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(strip).toHaveCount(0);
  }
}

export async function enterStripState(page: Page, profile: Profile, state: StripState) {
  switch (state) {
    case 'keypad-setup':
      await page.locator('input.setupInput').first().click();
      await expect(page.locator('.nkStrip')).toBeVisible();
      break;
    case 'keypad-panel':
      await page.getByRole('tab', { name: 'Tools', exact: true }).click();
      await page.getByRole('button', { name: '+ Add', exact: true }).click();
      await expect(page.locator('.editDialog')).toBeVisible();
      await page.locator('.editDialog input.inputField').first().click();
      await expect(page.locator('.nkStrip')).toBeVisible();
      break;
    case 'gcode-keypad':
      await page.getByRole('tab', { name: 'MDI', exact: true }).click();
      await page.locator('.mdiInput').click();
      await expect(page.locator('.tkStrip')).toBeVisible();
      break;
    case 'macro-bar':
      await serveNow(page, new Folder());
      await ctl({ op: 'raw', frame: { type: 'settings_init', settings: MACRO_BAR } });
      await expect(page.locator('.macroBar')).toBeVisible();
      await expect(page.locator('.macroBar').getByRole('button', { name: 'Face top', exact: true })).toBeVisible();
      break;
    case 'banner-estop':
      await setLayoutState(page, profile, 'estop');
      break;
    case 'banner-unhomed':
      await setLayoutState(page, profile, 'unhomed');
      break;
    case 'banner-message':
      await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'layout-probe', ok: false, error: 'Layout probe message — a long operator message that the banner must fit without moving its actions' } });
      await expect(page.locator('.statusBanner')).toContainText('Layout probe message');
      break;
    case 'kins-chip':
      await ctl({ op: 'setKins', kins: { module: 'xyzac-trt-kins', type: 'xyzac-trt', identity_first: true, params: {} } });
      await ctl({ op: 'status_delta', data: { kins_type: 1 } });
      await expect(page.locator('.kinsChip')).toBeVisible();
      break;
  }
  await settleLayout(page);
}

export async function leaveStripState(page: Page, profile: Profile, state: StripState) {
  switch (state) {
    case 'keypad-setup':
      await keypadCancel(page);
      break;
    case 'keypad-panel':
      await keypadCancel(page);
      await page.locator('.editDialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.locator('.editDialog')).toHaveCount(0);
      await page.getByRole('tab', { name: 'Program', exact: true }).click();
      break;
    case 'gcode-keypad':
      // A pointerdown outside the MDI tab and the keyboard ends the session.
      await page.locator('header.hdr').dispatchEvent('pointerdown', { button: 0 });
      await expect(page.locator('.tkStrip')).toHaveCount(0);
      await page.getByRole('tab', { name: 'Program', exact: true }).click();
      break;
    case 'macro-bar':
      await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { macros: { macros: [] } } } });
      await expect(page.locator('.macroBar')).toHaveCount(0);
      break;
    case 'banner-estop':
    case 'banner-unhomed':
      await setLayoutState(page, profile, 'homed');
      break;
    case 'banner-message':
      break;   // expires on its own (5 s); the next state does not depend on it
    case 'kins-chip':
      await ctl({ op: 'setKins', kins: profile.kins });
      await ctl({ op: 'status_delta', data: { kins_type: profile.kins ? 0 : null } });
      // The chip is a FIXED slot on switchable-kins machines (WP6, P2): it
      // stays rendered — "MACHINE" under identity kinematics — so the WCS
      // radios never shift; leaving the mode means it no longer reads TCP.
      await expect(page.locator('.kinsChip')).not.toHaveText(/TCP/);
      break;
  }
  await settleLayout(page);
}

export async function settleLayout(page: Page) {
  // Render after WebSocket delivery + Vue update. Assertions on the state
  // marker in each spec establish that delivery happened before these frames.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
