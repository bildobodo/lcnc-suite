import './testGlobals';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';

// Exercise the actual connection, frame dispatcher and settings store.
// Only the worker transport is a controllable stand-in; no live service.
class WorkerStub {
  static all: WorkerStub[] = [];
  posted: any[] = [];
  onmessage: ((ev: {data: any}) => void) | null = null;
  terminated = false;
  constructor(_url: URL) { WorkerStub.all.push(this); }
  postMessage(m: any) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  frame(m: any) { this.onmessage!({data: {type: 'message', data: JSON.stringify(m)}}); }
}
(globalThis as any).Worker = WorkerStub;
(globalThis as any).location = {protocol: 'http:', hostname: 'review.invalid', host: 'review.invalid:4188'};
const d = await import('./defaults');
const token = await import('./deviceToken');
const ws = await import('./lcncWs');
const transport = await import('./ws/wsTransport');
const {connKey} = await import('./connKey');
const {resetSaveStatusForTests} = await import('./settingsSaveStatus');
const last = () => WorkerStub.all.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  d.resetSettingsForTests(); resetSaveStatusForTests();
  token.resetDeviceTokenForTests(); localStorage.setItem('lcnc-device-token', 'a'.repeat(32));
  token.initDeviceToken(); ws.connectWs();
  last().frame({type:'reply', armed:true, ok:true, conn_key:'connection-A'});
  last().frame({type:'settings_init', settings:{simulation:{enabled:false}},
    revs:{simulation:0, display:0}, device:{id:'A',name:'Panel A'}});
});
afterEach(() => { transport.terminateTransport(); d.resetSettingsForTests(); vi.useRealTimers(); });

it('pending save must not cross a socket reconnect into another INI profile', () => {
  d.saveSimulationDefaults({enabled:true});
  vi.advanceTimersByTime(100);
  // Normal worker close (not a localStorage token change).
  last().onmessage!({data:{type:'close',code:1006,reason:'restart'}});
  console.log('CLOSED_BINDING', {ready:d.serverSettingsReady.value,id:d.deviceInfo.value.id});
  // Same token, new gateway INI: the new server announces its own profile.
  last().onmessage!({data:{type:'open'}});
  last().frame({type:'settings_init',settings:{simulation:{enabled:false}},
    revs:{simulation:0},device:{id:'NEW-INI',name:'New INI profile'}});
  vi.advanceTimersByTime(250);
  const sent = last().posted.filter(m=>m.type==='send').map(m=>JSON.parse(m.payload));
  const saves = sent.filter(m=>m.cmd==='save_settings');
  console.log('SAVES_AFTER_RECONNECT', JSON.stringify(saves));
  expect(saves).toEqual([]);
});

it('an open socket without its new settings must not admit a device edit from the old view', () => {
  last().onmessage!({data:{type:'close',code:1006,reason:'restart'}});
  vi.advanceTimersByTime(1500);
  last().onmessage!({data:{type:'open'}});
  // Binding/store work has not completed: no settings_init yet.
  d.saveSimulationDefaults({enabled:true});
  vi.advanceTimersByTime(350);
  const saves = last().posted.filter(m=>m.type==='send').map(m=>JSON.parse(m.payload)).filter(m=>m.cmd==='save_settings');
  console.log('EDIT_BEFORE_NEW_SETTINGS',JSON.stringify({ready:d.serverSettingsReady.value,id:d.deviceInfo.value.id,saves}));
  expect(saves).toEqual([]);
});
