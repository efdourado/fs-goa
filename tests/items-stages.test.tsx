import assert from "node:assert/strict";
import test, {after} from "node:test";
import {act} from "react";
import {JSDOM} from "jsdom";
import {CheckpointPlanner} from "../app/goa/checkpoint-planner";
import {Toaster} from "../app/goa/ui";
import {AdminScreen} from "../app/goa/screens/admin";
import {SessionLog, sessionSpecOf} from "../app/goa/session-log";
import type {ChallengeDetail, ChallengeField, ChallengeItemInput, CheckpointInput} from "../app/goa/types";
import {withIntl} from "./helpers/intl";
const library = {id: "lib", kind: "custom_test", label: "Things", source: "custom"};
const field = {id: "answer", key: "answer", label: "Amount", type: "number", required: true};
const challenge = {id: "c", groupId: "g", title: "Test", status: "active", scope: "group", submissionMode: "item", libraries: [library], fields: [field], entryTypes: [{id: "response", name: "Unnecessary name", isPrimary: true, answerScope: "individual", submissionMode: "item", cardinality: "once_per_item", fields: [field]}], metrics: [], participants: [], checkpoints: [{id: "a", title: "Phase 1", kind: "session", position: 0, opensAt: "2027-01-10T15:00:00Z", dueAt: "2027-01-20T19:00:00Z"}, {id: "b", title: "Phase 2", kind: "session", position: 1}], items: [{id: "one", title: "One", position: 0, checkpointId: "a", catalogItem: {id: "catalog-one", kind: library.kind, title: "One", attributes: [{key: "test", label: "Details", type: "text", value: "Kept detail"}]}}, {id: "two", title: "Two", position: 1, checkpointId: "b"}, {id: "three", title: "Three", position: 2, checkpointId: null}]} as unknown as ChallengeDetail;
let sharedDom: JSDOM | undefined;
after(() => sharedDom?.window.close());
async function setup() {
 const dom = sharedDom ??= new JSDOM('<div id="root"></div>', {url: 'http://localhost'});
 dom.window.document.body.innerHTML = '<div id="root"></div>';
 const beforeFetch = globalThis.fetch;
 Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, requestAnimationFrame: (callback: () => void) => {callback(); return 0;}, IS_REACT_ACT_ENVIRONMENT: true});
 dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
 dom.window.HTMLElement.prototype.showPopover = function() {};
 dom.window.HTMLElement.prototype.hidePopover = function() {};
 dom.window.HTMLDialogElement.prototype.showModal = function() {this.open = true;};
 dom.window.HTMLDialogElement.prototype.close = function() {this.open = false;};
 dom.window.matchMedia = (() => ({matches: false, addEventListener() {}, removeEventListener() {}})) as unknown as typeof dom.window.matchMedia;
 globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/shelf') ? {libraries: [library], counts: {[library.kind]: 89, other: 12}, items: []} : {properties: [{key: "title", label: "Name", type: "text", storage: "native", hidden: false, position: 0}]}), {headers: {'content-type': 'application/json'}});
 const {createRoot} = await import('react-dom/client'); const root = createRoot(document.getElementById('root')!);
 const button = (label: string) => {const found = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button'), ...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label); assert.ok(found, `button ${label}`); return found;};
 const fill = async (input: HTMLInputElement, value: string) => act(async () => {assert.ok(input); Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input, value); input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 const render = async (element: React.ReactElement) => act(async () => root.render(withIntl(<>{element}<Toaster /></>)));
 return {root, button, fill, render, cleanup: async () => {await act(async () => root.unmount()); globalThis.fetch = beforeFetch;}};
}
const noop = async () => undefined;
function adminProps(extra: Partial<Parameters<typeof AdminScreen>[0]> = {}): Parameters<typeof AdminScreen>[0] {
 return {challenge, entries: [], tab: 'fields', onTab() {}, onBack() {}, duplicateTargets: [], onSaveFields: noop, onAddSharedResponse: noop, onRenameEntryType: noop, ...extra} as unknown as Parameters<typeof AdminScreen>[0];
}

test('stage editing uses a modal and preserves original date instants and other stages', async () => {
 const ui = await setup(); const saved: CheckpointInput[][] = [];
 try {
  await ui.render(<CheckpointPlanner challenge={challenge} onSaveCheckpoints={async (values) => {saved.push(values);}} onAssign={noop} />);
  assert.equal(document.querySelector('input'), null);
  assert.doesNotMatch(document.body.textContent!, /Editar etapa|Pronto|Salvar etapas/);
  await act(async () => ui.button('Configurações da etapa: Phase 1').click());
  assert.ok(document.querySelector('dialog'));
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="160"]')!, 'Horror movies');
  await act(async () => ui.button('Salvar').click());
  assert.equal(saved[0][0].title, 'Horror movies');
  assert.equal(saved[0][0].startsAt, '2027-01-10T15:00:00Z');
  assert.equal(saved[0][0].dueAt, '2027-01-20T19:00:00Z');
  assert.equal(saved[0][1].title, 'Phase 2');
  assert.equal(document.querySelector('dialog'), null);
 } finally {await ui.cleanup();}
});

test('a failed stage save keeps the modal and its draft editable', async () => {
 const ui = await setup();
 try {
  await ui.render(<CheckpointPlanner challenge={challenge} onSaveCheckpoints={async () => {throw new Error('Save failed');}} onAssign={noop} />);
  await act(async () => ui.button('Configurações da etapa: Phase 1').click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="160"]')!, 'Keep my title');
  await act(async () => ui.button('Salvar').click());
  assert.equal(document.querySelector<HTMLInputElement>('dialog input[maxlength="160"]')!.value, 'Keep my title');
  assert.match(document.body.textContent!, /Save failed/);
  assert.equal(ui.button('Salvar').disabled, false);
 } finally {await ui.cleanup();}
});

test('choosing items moves from other stages and unassigns deselected ones without removing them', async () => {
 const ui = await setup(); const saved: unknown[] = [];
 try {
  await ui.render(<CheckpointPlanner challenge={challenge} onSaveCheckpoints={noop} onAssign={async (values) => {saved.push(values);}} />);
  const open = [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((button) => button.textContent!.includes('Phase 1'))!;
  await act(async () => open.click());
  await act(async () => ui.button('Escolher itens').click());
  const checks = [...document.querySelectorAll<HTMLInputElement>('dialog input[type=checkbox]')];
  await act(async () => {checks[0].click(); checks[1].click();});
  await act(async () => ui.button('Salvar').click());
  assert.deepEqual(saved[0], [{itemId:'one',position:0,checkpointId:null},{itemId:'two',position:1,checkpointId:'a'},{itemId:'three',position:2,checkpointId:null}]);
 } finally {await ui.cleanup();}
});

test('new items can choose a stage and see the correct collection count', async () => {
 const ui = await setup(); const saved: ChallengeItemInput[][] = [];
 try {
  await ui.render(<CheckpointPlanner challenge={challenge} onSaveCheckpoints={noop} onAssign={noop} itemTools={{scope: {groupId:'g'},onAdd: async (values) => {saved.push(values);},onUpdate:noop,onRemove:noop}} />);
  await act(async () => ui.button('Adicionar itens').click());
  assert.match(document.querySelector('dialog')!.textContent!, /Da coleção \(89\)/);
  const stage = document.querySelector<HTMLButtonElement>('dialog button[aria-label="Etapa"]')!;
  await act(async () => stage.click());
  const option = document.querySelector<HTMLButtonElement>('dialog button[role="option"][data-value="b"]')!;
  await act(async () => option.click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[aria-label="Adicionar um título"]')!, 'New thing');
  await act(async () => ui.button('Adicionar').click());
  await act(async () => ui.button('Adicionar 1 item').click());
  assert.equal(saved[0][0].title, 'New thing'); assert.equal(saved[0][0].checkpointId, 'b');
 } finally {await ui.cleanup();}
});

test('item titles open the shared item editor and save through the existing item endpoint callback', async () => {
 const ui = await setup(); const saved: unknown[] = [];
 try {
  await ui.render(<CheckpointPlanner challenge={challenge} onSaveCheckpoints={noop} onAssign={noop} itemTools={{scope:'personal',onAdd:noop,onUpdate:async (id, value) => {saved.push({id,value});},onRemove:noop}} />);
  const open = [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((button) => button.textContent!.includes('Phase 1'))!;
  await act(async () => open.click());
  await act(async () => ui.button('One').click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="200"]')!, 'Edited item');
  await act(async () => ui.button('Salvar').click());
  assert.deepEqual(saved[0], {id:'one',value:{title:'Edited item'}});
 } finally {await ui.cleanup();}
});

test('closed challenges retain readable item details and expose no editing controls', async () => {
 const ui = await setup();
 try {
  await ui.render(<CheckpointPlanner challenge={{...challenge,status:'closed'}} onSaveCheckpoints={noop} onAssign={noop} />);
  assert.doesNotMatch(document.body.textContent!, /Adicionar etapa|Escolher itens/);
  const open = [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((button) => button.textContent!.includes('Phase 1'))!;
  await act(async () => open.click()); await act(async () => ui.button('One').click());
  assert.match(document.querySelector('dialog')!.textContent!, /Kept detail/);
  assert.equal(document.querySelector('dialog input'), null);
 } finally {await ui.cleanup();}
});

test('fields have a neutral required label without redundant headings or a response-name prompt', async () => {
 const ui = await setup();
 try {
  await ui.render(<AdminScreen {...adminProps()} />);
  assert.equal(document.querySelector('h2'),null);
  assert.doesNotMatch(document.body.textContent!, /Unnecessary name|＋ Resposta compartilhada/);
  const required = [...document.querySelectorAll('span')].find((span) => span.textContent === '· obrigatório')!;
  assert.equal(required.className, '');
  await act(async () => ui.button('Adicionar campo').click());
  assert.match(document.querySelector('dialog')!.textContent!, /Campo compartilhado/);
  assert.doesNotMatch(document.querySelector('dialog')!.textContent!, /Nome da resposta/);
 } finally {await ui.cleanup();}
});

test('the add-field modal creates a shared field without a second response name', async () => {
 const ui = await setup(); const shared: unknown[] = []; const own: unknown[] = [];
 try {
  await ui.render(<AdminScreen {...adminProps({onAddSharedResponse: async (value) => {shared.push(value);},onSaveFields: async (...value) => {own.push(value);}})} />);
  await act(async () => ui.button('Adicionar campo').click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="100"]')!, 'Verdict');
  const toggle = document.querySelector<HTMLButtonElement>('dialog button[role="switch"][aria-label="Campo compartilhado"]')!;
  await act(async () => toggle.click());
  await act(async () => ui.button('Adicionar campo').click());
  assert.equal(shared.length,1); assert.equal(own.length,0);
  assert.equal((shared[0] as {name:string}).name,'Verdict');
 } finally {await ui.cleanup();}
});

test('individual and shared fields stay visible together and new individual fields target the primary response', async () => {
 const ui = await setup(); const saved: unknown[][] = [];
 const value = {...challenge,entryTypes:[...challenge.entryTypes,{id:'shared',name:'Unnecessary shared title',answerScope:'shared',submissionMode:'item',fields:[{...field,id:'shared-field',label:'Shared verdict'}]}]} as ChallengeDetail;
 try {
  await ui.render(<AdminScreen {...adminProps({challenge:value,onSaveFields:async (...args) => {saved.push(args);}})} />);
  assert.match(document.body.textContent!,/Amount/);
  assert.match(document.body.textContent!,/Shared verdict/);
  assert.doesNotMatch(document.body.textContent!,/Unnecessary shared title/);
  assert.equal(document.querySelector('button[aria-pressed]'),null);
  await act(async () => ui.button('Ajustes de Shared verdict').click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="100"]')!,'Group verdict');
  await act(async () => ui.button('Salvar').click());
  assert.equal(saved[0][0],'shared');
  assert.equal((saved[0][1] as ChallengeField[])[0].id,'shared-field');
  await act(async () => ui.button('Adicionar campo').click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="100"]')!,'Individual note');
  await act(async () => ui.button('Adicionar campo').click());
  assert.equal(saved[1][0],'response'); assert.equal((saved[1][1] as unknown[]).length,2);
 } finally {await ui.cleanup();}
});

test('one response list keeps all four fields visible and edits preserve their original owners', async () => {
 const ui = await setup(); const saved: [string, ChallengeField[]][] = [];
 const workoutFields = [field,{...field,id:'reps',key:'reps',label:'Reps'},{...field,id:'sets',key:'sets',label:'Sets'}];
 const value = {...challenge,fields:workoutFields,entryTypes:[
  {id:'day',name:'Treino',purpose:'checkin',submissionMode:'daily',fields:[{id:'note',key:'note',label:'Como foi?',type:'text',required:false}]},
  {...challenge.entryTypes[0],name:'Desempenho',parentTypeId:'day',fields:workoutFields},
 ]} as ChallengeDetail;
 try {
  await ui.render(<AdminScreen {...adminProps({challenge:value,onSaveFields:async (id,fields) => {saved.push([id,fields]);}})} />);
  assert.deepEqual([...document.querySelectorAll('section ul li strong')].map((el) => el.textContent),['Amount','Reps','Sets','Como foi?']);
  assert.equal(document.querySelector('h2'),null);
  assert.doesNotMatch(document.body.textContent!,/Treino|Desempenho|Detalhes do check-in/);
  assert.equal(document.querySelector('button[aria-label="Ajustes do registro"]'),null);
  await act(async () => ui.button('Ajustes de Como foi?').click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="100"]')!,'Reflexão');
  await act(async () => ui.button('Salvar').click());
  assert.equal(saved[0][0],'day');
  assert.deepEqual(saved[0][1].map((field) => field.id),['note']);
  await act(async () => ui.button('Ajustes de Amount').click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="100"]')!,'Weight');
  await act(async () => ui.button('Salvar').click());
  assert.equal(saved[1][0],'response');
  assert.deepEqual(saved[1][1].map((field) => field.id),['answer','reps','sets']);
  assert.match(document.body.textContent!,/Weight/);
  assert.match(document.body.textContent!,/Reflexão/);
  assert.deepEqual(value.entryTypes[1].fields,workoutFields,'the challenge input is not mutated');
 } finally {await ui.cleanup();}
});

test('the multi-item log uses today’s answers for its title instead of a custom session name', async () => {
 const ui = await setup(); let saves = 0;
 const value = {...challenge,entryTypes:[
  {id:'day',name:'Custom workout title',purpose:'checkin',fields:[]},
  {...challenge.entryTypes[0],name:'Exercise records',parentTypeId:'day'},
 ]} as ChallengeDetail;
 try {
  await ui.render(<SessionLog challenge={value} spec={sessionSpecOf(value)!} entries={[]} userId="me" canEdit onSave={async () => {saves++;return {id:'unused',children:[]};}} />);
  await act(async () => ui.button('＋ Registrar as respostas de hoje').click());
  const dialog = document.querySelector('[role="dialog"]')!;
  assert.equal(dialog.querySelector('h2')!.textContent,'Respostas de hoje');
  assert.doesNotMatch(dialog.textContent!,/Custom workout title|Exercise records/);
  assert.equal(saves,0);
  await act(async () => ui.button('Pronto').click());
  assert.equal(document.querySelector('[role="dialog"]'),null);
 } finally {await ui.cleanup();}
});

test('workout field creation hides unavailable sharing and failed saves preserve the draft', async () => {
 const ui = await setup();
 const value = {...challenge,entryTypes:[{...challenge.entryTypes[0],parentTypeId:'day'}]} as ChallengeDetail;
 try {
  await ui.render(<AdminScreen {...adminProps({challenge:value,onSaveFields:async () => {throw new Error('Field save failed');}})} />);
  await act(async () => ui.button('Adicionar campo').click());
  assert.equal(document.querySelector('dialog button[role="switch"][aria-label="Campo compartilhado"]'),null);
  assert.doesNotMatch(document.querySelector('dialog')!.textContent!,/Campo compartilhado|listas respondidas uma vez por item|Check-ins diários mantêm/);
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[maxlength="100"]')!,'Keep this field');
  await act(async () => ui.button('Adicionar campo').click());
  assert.match(document.body.textContent!,/Field save failed/);
  assert.equal(document.querySelector<HTMLInputElement>('dialog input[maxlength="100"]')!.value,'Keep this field');
 } finally {await ui.cleanup();}
});

test('progress is omitted when the linked library has no eligible numeric property', async () => {
 const ui = await setup(); const toggles: unknown[] = [];
 try {
  await ui.render(<AdminScreen {...adminProps({onSetPageCount: async (value) => {toggles.push(value);}})} />);
  assert.equal(document.querySelector('button[role="switch"][aria-label="Progresso"]'),null);
  assert.doesNotMatch(document.body.textContent!,/Adicione primeiro uma propriedade numérica/);
  assert.deepEqual(toggles,[]);
 } finally {await ui.cleanup();}
});

test('progress is omitted for hidden numeric properties without removing existing goal data', async () => {
 const ui = await setup(); const toggles: unknown[] = [];
 const tracking = {id:'goal',semanticKey:'paginas_livro',purpose:'progress',isPrimary:false,fields:[{...field,config:{count:{goal:{from:'distance'},entry:'position'}}}]};
 const value = {...challenge,entryTypes:[...challenge.entryTypes,tracking]} as unknown as ChallengeDetail;
 globalThis.fetch = async () => new Response(JSON.stringify({properties:[{key:'number',attributeKey:'distance',storage:'attribute',type:'number',hidden:true,label:'Distance'}]}),{headers:{'content-type':'application/json'}});
 try {
  await ui.render(<AdminScreen {...adminProps({challenge:value,onSetPageCount:async (change) => {toggles.push(change);}})} />);
  assert.equal(document.querySelector('button[role="switch"][aria-label="Progresso"]'),null);
  assert.deepEqual(toggles,[]);
  assert.deepEqual(value.entryTypes.find((type) => type.id === 'goal')!.fields[0].config?.count?.goal,{from:'distance'});
 } finally {await ui.cleanup();}
});

test('an eligible numeric library property exposes progress off by default and requires a deliberate click', async () => {
 const ui = await setup(); const toggles: unknown[] = [];
 globalThis.fetch = async () => new Response(JSON.stringify({properties:[{key:'number',attributeKey:'distance',storage:'attribute',type:'number',hidden:false,label:'Distance'}]}),{headers:{'content-type':'application/json'}});
 try {
  await ui.render(<AdminScreen {...adminProps({onSetPageCount:async (value) => {toggles.push(value);}})} />);
  const toggle = document.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Progresso"]')!;
  assert.ok(toggle); assert.equal(toggle.getAttribute('aria-checked'),'false');
  assert.deepEqual(toggles,[]);
  await act(async () => toggle.click());
  assert.deepEqual(toggles,['distance']);
 } finally {await ui.cleanup();}
});
