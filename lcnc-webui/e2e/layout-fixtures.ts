import { expect, type Page } from '@playwright/test';
import { ctl, MOCK } from './ctl';
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
  await expect(status('E-Stop')).toHaveText(state === 'estop' ? 'TRUE' : 'FALSE');
  await expect(status('Enabled')).toHaveText(['off', 'estop'].includes(state) ? 'FALSE' : 'TRUE');
  await expect(status('Homed')).toHaveText(isHomed ? 'TRUE' : 'FALSE');
  await expect(status('Mode')).toHaveText(['running', 'paused'].includes(state) ? 'AUTO' : 'MANUAL');
  await expect(status('Interp')).toHaveText(state === 'running' ? 'RUNNING' : state === 'paused' ? 'PAUSED' : 'IDLE');
  await expect(page.locator(`.pill.${state === 'disarmed' ? 'disarmed' : 'armed'}`)).toHaveCount(1);
  await expect(page.locator('[data-strip="setup"]').getByRole('button', {
    name: isHomed ? 'Unhome All' : 'Home All', exact: true,
  })).toBeAttached();
  if (profile.kins) {
    const mode = state === 'tcp' ? 1 : state.startsWith('plane') ? 2 : 0;
    await expect(page.locator(`input[name="jogFrame"][value="${mode}"]`)).toBeChecked();
  }
  if (profile.name === '6axis-twp') {
    await expect(page.locator('label').filter({ has: page.locator('input[name="jogFrame"][value="2"]') }))
      .toHaveText(state === 'plane-stale' ? 'Plane (stale)' : 'Plane');
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

export async function settleLayout(page: Page) {
  // Render after WebSocket delivery + Vue update. Assertions on the state
  // marker in each spec establish that delivery happened before these frames.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
