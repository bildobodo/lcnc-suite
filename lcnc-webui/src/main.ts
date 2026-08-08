import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { fetchSettings, saveSettingsSection } from './lcncApi'
import { initServerDefaults } from './defaults'
import { VALID_GATES } from './permissions'
import { initDragScroll } from './dragScroll'
import { initScrollFade } from './scrollFade'
import { initTouchDetect } from './touchDetect'
import { startClientDiag } from './clientDiag'

const SERVER_SECTIONS = ["macros", "machine", "camera", "mdi", "gamepad", "keyboard", "probe", "toolsetter", "display", "viewer", "panels"];

async function bootstrap() {
  initTouchDetect();

  let serverSettings: Record<string, any> = {};
  let fetchOk = false;
  try {
    serverSettings = await fetchSettings();
    fetchOk = true;
  } catch (e) {
    console.error("[settings] initial fetch failed; deferring to WS settings_init:", e);
  }

  // Strip a localStorage key for one server section only AFTER its save lands.
  // A failed save keeps the data locally so the next boot retries it, instead
  // of wiping it from both places (the old code stripped before awaiting).
  async function migrateSection(section: string, data: any): Promise<boolean> {
    try {
      await saveSettingsSection(section, data);
      return true;
    } catch (e) {
      console.warn(`[migrate] ${section} save failed — kept in localStorage for retry`, e);
      return false;
    }
  }

  // One-time migration: lcnc-defaults localStorage → server for server sections
  // Only run if REST fetch succeeded (otherwise we'd migrate stale data)
  if (fetchOk) try {
    const raw = localStorage.getItem("lcnc-defaults");
    if (raw) {
      const local = JSON.parse(raw);
      const failed = new Set<string>();
      await Promise.all(SERVER_SECTIONS.map(async (key) => {
        if (local[key] && !serverSettings[key]) {
          serverSettings[key] = local[key];
          if (!(await migrateSection(key, local[key]))) failed.add(key);
        }
      }));
      // Rewrite localStorage keeping local-only sections AND any server section
      // whose migration failed (so it isn't lost and retries next boot).
      const remaining: Record<string, any> = {};
      for (const [k, v] of Object.entries(local as Record<string, any>)) {
        if (!SERVER_SECTIONS.includes(k) || failed.has(k)) remaining[k] = v;
      }
      localStorage.setItem("lcnc-defaults", JSON.stringify(remaining));
    }
  } catch (e) {
    console.warn("[migrate] lcnc-defaults migration failed", e);
  }

  // One-time migration: legacy lcnc-probe-params → server "probe" section
  if (fetchOk) try {
    const probeRaw = localStorage.getItem("lcnc-probe-params");
    if (probeRaw && !serverSettings.probe) {
      const probeLocal = JSON.parse(probeRaw);
      serverSettings.probe = probeLocal;
      if (await migrateSection("probe", probeLocal)) localStorage.removeItem("lcnc-probe-params");
    } else if (probeRaw) {
      localStorage.removeItem("lcnc-probe-params"); // server already has it — local copy stale
    }
  } catch (e) {
    console.warn("[migrate] lcnc-probe-params migration failed", e);
  }

  // One-time migration: legacy lcnc-toolsetter-params → server "toolsetter" section
  if (fetchOk) try {
    const tsRaw = localStorage.getItem("lcnc-toolsetter-params");
    if (tsRaw && !serverSettings.toolsetter) {
      const tsLocal = JSON.parse(tsRaw);
      delete tsLocal.toolNumber; // toolNumber lives in App.vue
      serverSettings.toolsetter = tsLocal;
      if (await migrateSection("toolsetter", tsLocal)) localStorage.removeItem("lcnc-toolsetter-params");
    } else if (tsRaw) {
      localStorage.removeItem("lcnc-toolsetter-params"); // server already has it — local copy stale
    }
  } catch (e) {
    console.warn("[migrate] lcnc-toolsetter-params migration failed", e);
  }

  initServerDefaults(serverSettings, fetchOk);
  createApp(App).mount('#app');
  initDragScroll();
  initScrollFade();
  startClientDiag();

  if (import.meta.env.DEV) {
    function auditElement(el: HTMLElement) {
      const gate = el.closest('[data-gate]');
      if (gate && VALID_GATES.has(gate.getAttribute('data-gate')!)) return;

      el.style.outline = '3px solid red';
      el.title = 'UNGATED: not inside a <Gate> with a valid permission';
      console.warn(
        '[Gate audit] Ungated element:',
        el,
        gate ? `(nearest data-gate="${gate.getAttribute('data-gate')}" is not a valid permission)` : '(no Gate ancestor)',
      );
    }

    function auditAll(root: Element | Document = document) {
      for (const el of root.querySelectorAll('button, input, select, textarea')) {
        auditElement(el as HTMLElement);
      }
    }

    // Audit initial DOM after mount settles
    setTimeout(() => {
      auditAll();

      // Watch for dynamically added elements (dialogs, popovers)
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches('button, input, select, textarea')) auditElement(node);
            auditAll(node);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }, 0);
  }
}

bootstrap();
