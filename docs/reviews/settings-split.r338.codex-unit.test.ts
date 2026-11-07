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

it('control: own settings changed activates its own simulation', () => {
  last().frame({type:'settings_changed', settings:{simulation:{enabled:true}},
    revs:{simulation:1}, device:{id:'A',name:'Panel A'}});
  expect(d.simulationOn.value).toBe(true);
});

it('foreign success must not advance this device revision', async () => {
  const p = ws.request({cmd:'save_settings',section:'simulation',device:'B',base_rev:4,data:{enabled:false}});
  const sent = last().posted.filter(m => m.type === 'send').map(m => JSON.parse(m.payload)).at(-1);
  last().frame({type:'reply',ok:true,cmd:'save_settings',req_id:sent.req_id,section:'simulation',rev:5});
  await p;
  expect(d.sectionServerRev('simulation')).toBe(0);
});

it('foreign stale reply must not activate the local simulation', async () => {
  const p = ws.request({cmd:'save_settings',section:'simulation',device:'B',base_rev:4,data:{enabled:false}});
  const sent = last().posted.filter(m => m.type === 'send').map(m => JSON.parse(m.payload)).at(-1);
  last().frame({type:'reply',ok:false,cmd:'save_settings',req_id:sent.req_id,section:'simulation',
    stale:true,data:{enabled:true},rev:5,error:'simulation changed elsewhere — reloaded'});
  await p;
  expect({id:d.deviceInfo.value.id,rev:d.sectionServerRev('simulation'),simulation:d.simulationOn.value})
    .toEqual({id:'A',rev:0,simulation:false});
});

it('rebind invalidates the old confirmed settings and connection immediately', () => {
  last().frame({type:'settings_changed', settings:{simulation:{enabled:true}},
    revs:{simulation:1},device:{id:'A',name:'Panel A'}});
  localStorage.setItem('lcnc-device-token','b'.repeat(32));
  token.recheckDeviceToken();
  expect(last().posted[0]).toMatchObject({type:'connect',deviceToken:'b'.repeat(32),resumeArmed:false});
  expect({ready:d.serverSettingsReady.value,id:d.deviceInfo.value.id,
    simulation:d.simulationOn.value,armed:ws.armed.value,key:connKey()})
    .toEqual({ready:false,id:null,simulation:false,armed:false,key:null});
});

it('a device edit while rebind is unconfirmed must not move from A to B', () => {
  localStorage.setItem('lcnc-device-token','b'.repeat(32)); token.recheckDeviceToken();
  d.saveDisplayDefaults({...d.loadDisplayDefaults(),theme:'dark'});
  // B has not sent its settings yet. Its WS worker accepts sends once open.
  vi.advanceTimersByTime(300);
  const sent = last().posted.filter(m=>m.type==='send').map(m=>JSON.parse(m.payload));
  expect(sent.filter(m=>m.cmd==='save_settings')).toEqual([]);
});

it('a stale refusal of an older draft must not erase a newer edit still in debounce', () => {
  // A's old edit is refused; user made a new explicit edit after seeing a
  // newer server state but before that refusal arrived.
  d.saveSimulationDefaults({enabled:true}); vi.advanceTimersByTime(300);
  const first = last().posted.filter(m=>m.type==='send').map(m=>JSON.parse(m.payload)).at(-1);
  last().frame({type:'settings_changed',settings:{simulation:{enabled:false}},
    revs:{simulation:1},device:{id:'A',name:'Panel A'}});
  d.saveSimulationDefaults({enabled:true});
  last().frame({type:'reply',ok:false,cmd:'save_settings',req_id:first.req_id,section:'simulation',
    stale:true,data:{enabled:false},rev:1,error:'simulation changed elsewhere — reloaded'});
  expect(d.loadSimulationDraft().enabled).toBe(true);
});

it('an older stale reply must not roll back a more recent confirmed snapshot', () => {
  d.saveSimulationDefaults({enabled:true}); vi.advanceTimersByTime(300);
  const first = last().posted.filter(m=>m.type==='send').map(m=>JSON.parse(m.payload)).at(-1);
  last().frame({type:'settings_changed',settings:{simulation:{enabled:false}},
    revs:{simulation:2},device:{id:'A',name:'Panel A'}});
  last().frame({type:'reply',ok:false,cmd:'save_settings',req_id:first.req_id,section:'simulation',
    stale:true,data:{enabled:true},rev:1,error:'simulation changed elsewhere — reloaded'});
  expect({rev:d.sectionServerRev('simulation'),simulation:d.simulationOn.value})
    .toEqual({rev:2,simulation:false});
});
