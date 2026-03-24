import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { fetchSettings, saveSettingsSection } from './lcncApi'
import { initServerDefaults } from './defaults'

const SERVER_SECTIONS = ["macros", "machine", "camera", "mdi", "gamepad", "keyboard", "probe", "toolsetter", "display", "viewer", "panels"];

async function bootstrap() {
  let serverSettings: Record<string, any> = {};
  let fetchOk = false;
  try {
    serverSettings = await fetchSettings();
    fetchOk = true;
  } catch {
    // Gateway unreachable — WS handshake will deliver settings later
  }

  const migrations: Promise<void>[] = [];

  // One-time migration: lcnc-defaults localStorage → server for server sections
  // Only run if REST fetch succeeded (otherwise we'd migrate stale data)
  if (fetchOk) try {
    const raw = localStorage.getItem("lcnc-defaults");
    if (raw) {
      const local = JSON.parse(raw);
      for (const key of SERVER_SECTIONS) {
        if (local[key] && !serverSettings[key]) {
          serverSettings[key] = local[key];
          migrations.push(saveSettingsSection(key, local[key]));
        }
      }
      // Strip server sections from localStorage
      const localOnly: Record<string, any> = {};
      for (const [k, v] of Object.entries(local as Record<string, any>)) {
        if (!SERVER_SECTIONS.includes(k)) localOnly[k] = v;
      }
      localStorage.setItem("lcnc-defaults", JSON.stringify(localOnly));
    }
  } catch { /* ignore corrupt localStorage */ }

  // One-time migration: legacy lcnc-probe-params → server "probe" section
  if (fetchOk) try {
    const probeRaw = localStorage.getItem("lcnc-probe-params");
    if (probeRaw && !serverSettings.probe) {
      const probeLocal = JSON.parse(probeRaw);
      serverSettings.probe = probeLocal;
      migrations.push(saveSettingsSection("probe", probeLocal));
    }
    if (probeRaw) localStorage.removeItem("lcnc-probe-params");
  } catch { /* ignore */ }

  // One-time migration: legacy lcnc-toolsetter-params → server "toolsetter" section
  if (fetchOk) try {
    const tsRaw = localStorage.getItem("lcnc-toolsetter-params");
    if (tsRaw && !serverSettings.toolsetter) {
      const tsLocal = JSON.parse(tsRaw);
      delete tsLocal.toolNumber; // toolNumber lives in App.vue sidebar
      serverSettings.toolsetter = tsLocal;
      migrations.push(saveSettingsSection("toolsetter", tsLocal));
    }
    if (tsRaw) localStorage.removeItem("lcnc-toolsetter-params");
  } catch { /* ignore */ }

  if (migrations.length) await Promise.all(migrations);

  initServerDefaults(serverSettings, fetchOk);
  createApp(App).mount('#app');

  if (import.meta.env.DEV) {
    // After initial mount, watch for elements added outside a Gate (<fieldset>).
    // Exempt elements must have data-gate-exempt on themselves or an ancestor.
    setTimeout(() => {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            const els = [
              ...(node.matches('button, input, select, textarea') ? [node] : []),
              ...node.querySelectorAll('button, input, select, textarea'),
            ] as HTMLElement[];
            for (const el of els) {
              if (!el.closest('fieldset') && !el.closest('[data-gate-exempt]')) {
                console.warn('[Gate audit] Element outside fieldset:', el);
              }
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, 0);
  }
}

bootstrap();
