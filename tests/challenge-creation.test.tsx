import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import GoaApp from "../app/GoaApp";
import { clearCache } from "../app/goa/cache";
import { CatalogRow } from "../app/goa/catalog-views";
import { CreateChallengeScreen } from "../app/goa/screens/create-challenge";
import { CheckpointPlanner } from "../app/goa/checkpoint-planner";
import { DashboardScreen } from "../app/goa/screens/dashboard";
import { QuickCreateScreen } from "../app/goa/screens/quick-create";
import { challengeRecording } from "../app/goa/challenge-creation";
import { challengeRequestBody } from "../app/goa/challenge-request";
import type { ChallengeDraftForm } from "../app/goa/challenge-draft";
import { DEFAULT_LIMITS } from "../app/goa/types";
import type { ChallengeDetail, CheckpointInput, ChallengeCreationInput } from "../app/goa/types";
import { withIntl } from "./helpers/intl";

const library = { id: "library", kind: "custom_items", label: "My items", source: "custom" as const };
const columns = [{ key: "amount", label: "Amount", type: "number" as const, required: true, config: { unit: "m" } }, { key: "note", label: "Details", type: "text" as const, required: false }];
const item = { key: "item", title: "First item", libraryId: library.id, libraryKind: library.kind, author: "", year: "", pages: "", runtimeMinutes: "", mainGenre: "", extra: {}, attributes: {} };
async function setup() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const previousFetch = globalThis.fetch;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, requestAnimationFrame: (callback: () => void) => { callback(); return 0; }, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof dom.window.matchMedia;
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.endsWith('/shelf')) return Response.json({ libraries: [], counts: {}, items: [] });
    if (path.endsWith('/libraries')) return Response.json({ libraries: [library] });
    return Response.json({ properties: [{ key: "title", label: "Name", type: "text", storage: "native", hidden: false, position: 0, canHide: false }] });
  };
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById('root')!);
  const button = (label: string) => {
    const found = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === label || (node.getAttribute('aria-pressed') !== null && node.querySelector('strong')?.textContent === label) || node.getAttribute('aria-label') === label);
    assert.ok(found, `button ${label} exists`); return found;
  };
  const libraryOption = (name: string) => {
    const option = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((node) => node.getAttribute('aria-label') === name);
    assert.ok(option, `library choice ${name} exists`);
    return option;
  };
  const fill = async (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  return { root, button, libraryOption, fill, cleanup: async () => { await act(async () => root.unmount()); dom.window.close(); globalThis.fetch = previousFetch; } };
}
function draft(linked: boolean, dated: boolean): ChallengeDraftForm {
  return { sheetMode: true, libraryEnabled: linked, dated, step: 1, structure: linked ? 'list' : 'daily', title: 'Anything tracker', description: '', ruleSections: [], showOptional: false, scheduleMode: 'none', startsOn: '', endsOn: '', fields: columns, answerScope: 'individual', recordingMode: linked && dated ? 'session' : 'single', sessionName: '', sharedEditPolicy: 'members_fill_admin_corrects', fieldsTouched: true, expectation: false, cineItems: linked ? [item] : [], participantIds: [], pickedKind: linked ? library.kind : null };
}

function assertDisabled(button: HTMLButtonElement, disabled: boolean) {
  assert.equal(button.disabled, disabled);
}

for (const flow of ['manual', 'guided'] as const) {
  test(`changing language keeps the ${flow} challenge and its current step`, async () => {
    const ui = await setup();
    try {
      clearCache();
      const fetchFixture = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (input === '/api/bootstrap') return Response.json({ user: { id: 'me', name: 'Me', username: 'me' } });
        if (input === '/api/templates') return Response.json({ templates: [] });
        return fetchFixture(input, init);
      };
      await act(async () => ui.root.render(withIntl(<GoaApp />)));
      await act(async () => ui.button('Começar').click());
      const mode = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((button) =>
        button.querySelector('strong')?.textContent === (flow === 'manual' ? 'Manual' : 'Conversa'));
      assert.ok(mode);
      await act(async () => mode.click());
      const personal = [...document.querySelectorAll<HTMLButtonElement>('main button')].find((button) =>
        (button.querySelector('strong')?.textContent ?? button.textContent?.trim()) === 'Pessoal');
      assert.ok(personal);
      await act(async () => personal.click());
      const title = document.querySelector<HTMLInputElement>('input[maxlength="140"]')!;
      await ui.fill(title, 'Reading journal');
      await act(async () => ui.button('Check-in diário').click());
      await act(async () => ui.button('Continuar').click());
      const url = window.location.href;
      const main = document.querySelector('main');

      const settings = document.querySelector<HTMLButtonElement>(
        `${flow === 'manual' ? 'header' : 'main'} button[aria-label="Preferências"]`,
      );
      assert.ok(settings);
      await act(async () => settings.click());
      await act(async () => ui.button('EN').click());
      await act(async () => {
        await import('../messages/en.json');
      });

      assert.equal(window.location.href, url);
      assert.equal(document.querySelector('main'), main);
      assert.equal(document.documentElement.lang, 'en');
      assert.match(document.cookie, /goa-locale=en/);
      assert.equal(ui.button('Create draft').disabled, false);
      if (flow === 'manual') {
        assert.equal(document.querySelector('[aria-current="step"]')?.textContent, 'Response');
        await act(async () => ui.button('Challenge').click());
        assert.equal(document.querySelector<HTMLInputElement>('input[maxlength="140"]')?.value, 'Reading journal');
      } else {
        assert.match(main?.textContent ?? '', /Reading journal · Daily check-in/);
        assert.match(main?.textContent ?? '', /What do you want to record\?/);
      }
    } finally { await ui.cleanup(); }
  });
}

async function addItem(ui: Awaited<ReturnType<typeof setup>>) {
  await act(async () => ui.button('Adicionar itens').click());
  await ui.fill(document.querySelector<HTMLInputElement>('dialog input[placeholder="Digite um título ou cole uma lista"]')!, 'Any item');
  await act(async () => ui.button('Adicionar 1 item').click());
}
for (const [linked, dated] of [[false, true], [true, true], [true, false]]) {
  test(`manual: library=${linked}, daily=${dated} preserves configured questions and request mode`, async () => {
    const ui = await setup();
    try {
      const saved: ChallengeCreationInput[] = [];
      await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal initialDraft={draft(linked, dated)} onBack={() => undefined} onCreate={async (input) => { saved.push(input); }} />)));
      assert.doesNotMatch(document.body.textContent!, /planilha|colunas|Uma sessão com vários itens|Vincular linhas/i);
      if (linked) {
        await act(async () => ui.libraryOption('My items').click());
        assertDisabled(ui.button('Continuar'), true);
        await act(async () => ui.libraryOption('My items').click());
      }
      assertDisabled(ui.button('Continuar'), false);
      await act(async () => ui.button('Continuar').click());
      if (linked) {
        assert.match(document.body.textContent!, /First item/);
        await act(async () => ui.button('Continuar').click());
      }
      for (const column of columns) assert.match(document.body.textContent!, new RegExp(column.label));
      assert.equal(document.querySelector('table'), null, 'no spreadsheet preview');
      assertDisabled(ui.button('Criar rascunho'), false);
      await act(async () => ui.button('Criar rascunho').click());
      assert.equal(saved.length, 1);
      assert.deepEqual(saved[0].fields.map((field) => [field.key, field.label, field.required]), columns.map((field) => [field.key, field.label, field.required]));
      assert.equal(saved[0].recipe, linked ? 'custom' : 'habit');
      assert.equal(saved[0].recordingMode, linked ? dated ? 'session' : 'single' : undefined);
      if (linked && dated) assert.equal(challengeRequestBody(saved[0]).includeSessionNote, false);
    } finally { await ui.cleanup(); }
  });
}

test('manual defaults to List; Continue unlocks only after name and library are provided', async () => {
  const ui = await setup();
  try {
    await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal onBack={() => undefined} onCreate={async () => undefined} />)));
    assert.equal(ui.button('Lista').getAttribute('aria-pressed'), 'true');
    assert.doesNotMatch(document.body.textContent ?? '', /Complete a lista no seu ritmo/);
    assertDisabled(ui.button('Continuar'), true);
    await ui.fill(document.querySelector<HTMLInputElement>('input[maxlength="140"]')!, 'A challenge');
    assertDisabled(ui.button('Continuar'), true);
    await act(async () => ui.libraryOption('My items').closest('label')!.click());
    assert.equal(document.querySelector('dialog'), null);
    assertDisabled(ui.button('Continuar'), false);
    await act(async () => ui.libraryOption('My items').closest('label')!.click());
    assert.equal(ui.libraryOption('My items').checked, false);
    assert.equal(document.querySelector('dialog'), null);
    assertDisabled(ui.button('Continuar'), true);
    await act(async () => ui.libraryOption('My items').click());
    assertDisabled(ui.button('Continuar'), false);
    await ui.fill(document.querySelector<HTMLInputElement>('input[maxlength="140"]')!, '');
    assertDisabled(ui.button('Continuar'), true);
    await act(async () => ui.button('Check-in diário').click());
    assert.match(document.body.textContent!, /Usar uma biblioteca/);
  } finally { await ui.cleanup(); }
});

test('creating a library requires a nonblank name', async () => {
  const ui = await setup();
  try {
    const fetchFixture = globalThis.fetch;
    const names: string[] = [];
    globalThis.fetch = async (input, init) => {
      if (input === '/api/personal/catalog/libraries' && init?.method === 'POST') {
        const { label } = JSON.parse(String(init.body));
        names.push(label);
        return Response.json({ ...library, label });
      }
      return fetchFixture(input, init);
    };
    await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal onBack={() => undefined} onCreate={async () => undefined} />)));
    await act(async () => ui.button('＋Biblioteca').click());
    const create = ui.button('Criar biblioteca');
    const input = document.querySelector<HTMLInputElement>('dialog input')!;
    assertDisabled(create, true);
    await ui.fill(input, '   ');
    assertDisabled(create, true);
    await ui.fill(input, 'Reading');
    assertDisabled(create, false);
    await ui.fill(input, '');
    assertDisabled(create, true);
    await ui.fill(input, '  Reading  ');
    await act(async () => create.click());
    assert.deepEqual(names, ['Reading']);
  } finally { await ui.cleanup(); }
});

test('editing a library from manual creation preserves the draft and the selected library', async () => {
  const ui = await setup();
  try {
    const cover = { coverTopProperty: null, coverBadgeHidden: false };
    let otherLibrary = { ...library, ...cover, id: 'other', kind: 'lib_other', label: 'Other items', position: 1 };
    let libraryReads = 0;
    const renamedProperties: string[] = [];
    const fetchFixture = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (input === '/api/personal/catalog/libraries') {
        libraryReads += 1;
        return Response.json({ libraries: [{ ...library, ...cover, position: 0 }, otherLibrary] });
      }
      if (input === '/api/catalog/libraries/other' && init?.method === 'PATCH') {
        const { label } = JSON.parse(String(init.body));
        otherLibrary = { ...otherLibrary, label };
        return Response.json(otherLibrary);
      }
      if (input === '/api/catalog/libraries/other/properties/title' && init?.method === 'PATCH') {
        renamedProperties.push(JSON.parse(String(init.body)).label);
        return Response.json({});
      }
      return fetchFixture(input, init);
    };
    await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal onBack={() => undefined} onCreate={async () => undefined} />)));
    assert.equal(libraryReads, 1);
    const title = document.querySelector<HTMLInputElement>('input[maxlength="140"]')!;
    await ui.fill(title, 'Reading journal');
    await act(async () => ui.libraryOption('My items').click());
    await act(async () => ui.libraryOption('Other items').click());
    assert.equal(ui.libraryOption('My items').checked, false);
    assert.equal(ui.libraryOption('Other items').checked, true);
    assert.equal(document.querySelector('dialog'), null);
    await act(async () => ui.libraryOption('My items').click());
    const otherName = ui.button('Other items');
    assert.equal(otherName.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(ui.libraryOption('Other items').closest('label')?.nextElementSibling, otherName);
    await act(async () => otherName.click());
    assert.equal(document.querySelector('dialog h2')?.textContent, 'Other items');
    assert.doesNotMatch(document.querySelector('dialog')?.textContent ?? '', /Clique para renomear|Capas|No topo da capa|Nota na capa/);
    await act(async () => ui.button('Name').click());
    const saveProperty = ui.button('Salvar');
    assert.equal(saveProperty.textContent, '');
    assert.ok(saveProperty.querySelector('svg[aria-hidden="true"]'));
    await ui.fill(saveProperty.closest('form')!.querySelector('input')!, 'Item name');
    await act(async () => saveProperty.click());
    assert.deepEqual(renamedProperties, ['Item name']);
    const name = document.querySelector<HTMLInputElement>('dialog input[aria-label="Nome"]')!;
    await act(async () => name.focus());
    await ui.fill(name, 'Renamed items');
    await act(async () => name.blur());
    await act(async () => ui.button('Fechar').click());
    assert.equal(otherLibrary.label, 'Renamed items');
    assert.equal(libraryReads, 3);
    assert.equal(ui.libraryOption('Renamed items').checked, false);
    assert.equal(ui.libraryOption('My items').checked, true);
    assert.equal(title.value, 'Reading journal');
    assertDisabled(ui.button('Continuar'), false);
  } finally { await ui.cleanup(); }
});

test('manual creation can delete the selected library through the catalogue confirmation', async () => {
  const ui = await setup();
  try {
    const mainLibrary = { ...library, position: 0, coverTopProperty: null, coverBadgeHidden: false };
    const fetchFixture = globalThis.fetch;
    const deletions: string[] = [];
    globalThis.fetch = async (input, init) => {
      if (input === '/api/personal/catalog/libraries') return Response.json({ libraries: deletions.length ? [] : [mainLibrary] });
      if (input === '/api/personal/catalog/shelf') return Response.json({ counts: { [library.kind]: 2 } });
      if (input === '/api/catalog/libraries/library?deleteItems=1' && init?.method === 'DELETE') {
        deletions.push(input);
        return Response.json({ deleted: true, id: library.id });
      }
      return fetchFixture(input, init);
    };
    await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal onBack={() => undefined} onCreate={async () => undefined} />)));
    const title = document.querySelector<HTMLInputElement>('input[maxlength="140"]')!;
    await ui.fill(title, 'Reading journal');
    await act(async () => ui.libraryOption('My items').click());
    await act(async () => ui.button('My items').click());
    await act(async () => ui.button('Excluir').click());
    assert.match(document.querySelector('dialog')?.textContent ?? '', /Os 2 itens vão para a lixeira junto/);
    assert.deepEqual(deletions, []);
    await act(async () => ui.button('Confirmar exclusão').click());
    assert.equal(deletions.length, 1);
    assert.equal(document.querySelector('dialog'), null);
    assert.equal(document.querySelector('input[aria-label="My items"]'), null);
    assert.equal(title.value, 'Reading journal');
    assertDisabled(ui.button('Continuar'), true);
  } finally { await ui.cleanup(); }
});

test('switching between list, daily and optional library keeps questions and selected items', async () => {
  const ui = await setup();
  try {
    const saved: ChallengeCreationInput[] = [];
    await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal initialDraft={draft(true, false)} onBack={() => undefined} onCreate={async (input) => { saved.push(input); }} />)));
    await act(async () => ui.button('Check-in diário').click());
    await act(async () => ui.button('Usar uma biblioteca').click());
    await act(async () => ui.button('Usar uma biblioteca').click());
    await act(async () => ui.button('Continuar').click());
    await act(async () => ui.button('Continuar').click());
    assert.match(document.body.textContent!, /um ou vários itens/);
    await act(async () => ui.button('Criar rascunho').click());
    assert.deepEqual(saved[0].fields.map((field) => field.label), columns.map((field) => field.label));
    assert.equal(saved[0].recordingMode, 'session');
    assert.equal(saved[0].items[0].title, item.title);
  } finally { await ui.cleanup(); }
});

for (const mode of ['list', 'daily', 'daily-library'] as const) {
  test(`guided ${mode}: basics, items when applicable, questions, create`, async () => {
    const ui = await setup();
    try {
      const saved: ChallengeCreationInput[] = [];
      await act(async () => ui.root.render(withIntl(<QuickCreateScreen currentUserId="me" groups={[]} into="personal" onBack={() => undefined} onCreateGroup={async () => null} onSubmit={async (_target, input) => { saved.push(input); }} />)));
      assertDisabled(ui.button('Continuar'), true);
      await ui.fill(document.querySelector<HTMLInputElement>('input[aria-label="Nome do desafio"]')!, 'My challenge');
      if (mode !== 'list') await act(async () => ui.button('Check-in diário').click());
      if (mode === 'daily-library') await act(async () => ui.button('Usar uma biblioteca').click());
      if (mode !== 'daily') await act(async () => ui.button('My items').click());
      assertDisabled(ui.button('Continuar'), false);
      await act(async () => ui.button('Continuar').click());
      if (mode !== 'daily') {
        assertDisabled(ui.button('Continuar'), true);
        await addItem(ui);
        assertDisabled(ui.button('Continuar'), false);
        await act(async () => ui.button('Continuar').click());
      }
      assert.equal(document.querySelector('table'), null);
      const fieldName = [...document.querySelectorAll('input')].find((input) => input.value === 'Sua resposta')!;
      await ui.fill(fieldName, '');
      assertDisabled(ui.button('Criar rascunho'), true);
      await ui.fill(fieldName, 'My measure');
      assertDisabled(ui.button('Criar rascunho'), false);
      await act(async () => ui.button('Criar rascunho').click());
      assert.equal(saved.length, 1);
      assert.equal(saved[0].fields[0].label, 'My measure');
      assert.equal(saved[0].recipe, mode === 'daily' ? 'habit' : 'custom');
      assert.equal(saved[0].recordingMode, mode === 'daily' ? undefined : mode === 'list' ? 'single' : 'session');
      assert.equal(saved[0].items.length, mode === 'daily' ? 0 : 1);
    } finally { await ui.cleanup(); }
  });
}

test('guided deadline is independent of recording mode and validates the date range', async () => {
  const ui = await setup();
  try {
    const saved: ChallengeCreationInput[] = [];
    await act(async () => ui.root.render(withIntl(<QuickCreateScreen currentUserId="me" groups={[]} into="personal" onBack={() => undefined} onCreateGroup={async () => null} onSubmit={async (_target, input) => { saved.push(input); }} />)));
    await ui.fill(document.querySelector<HTMLInputElement>('input[aria-label="Nome do desafio"]')!, 'Daily with deadline');
    await act(async () => ui.button('Check-in diário').click());
    await act(async () => ui.button('Com prazo').click());
    assertDisabled(ui.button('Continuar'), true);
    const dates = [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    await ui.fill(dates[0], '2027-01-10'); await ui.fill(dates[1], '2027-01-01');
    assertDisabled(ui.button('Continuar'), true);
    await ui.fill(dates[1], '2027-02-01');
    assertDisabled(ui.button('Continuar'), false);
    await act(async () => ui.button('Continuar').click());
    await act(async () => ui.button('Criar rascunho').click());
    assert.equal(saved[0].startsOn, '2027-01-10');
    assert.equal(saved[0].endsOn, '2027-02-01');
    assert.equal(saved[0].recipe, 'habit');
  } finally { await ui.cleanup(); }
});

test('library subject does not infer a rating, goal or automatic note', () => {
  for (const kind of ['film', 'book', 'unrelated_items']) {
    const linked = { ...library, kind };
    assert.equal(challengeRecording(linked, false, 'Response', 'Entry').recipe, 'custom');
    const daily = challengeRecording(linked, true, 'Response', 'Entry');
    assert.equal(daily.recordingMode, 'session');
    assert.equal(daily.includeSessionNote, false);
  }
});

test('manual lists retain a shared group response', async () => {
  const ui = await setup();
  try {
    const saved: ChallengeCreationInput[] = [];
    const shared = draft(true, false); shared.answerScope = 'shared';
    await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal initialDraft={shared} onBack={() => undefined} onCreate={async (input) => { saved.push(input); }} />)));
    await act(async () => ui.button('Continuar').click());
    await act(async () => ui.button('Continuar').click());
    assert.match(document.body.textContent!, /Resposta compartilhada/);
    await act(async () => ui.button('Criar rascunho').click());
    assert.equal(saved[0].answerScope, 'shared');
  } finally { await ui.cleanup(); }
});

test('dashboard group creation unlocks only for a nonblank name', async () => {
  const ui = await setup();
  try {
    const names: string[] = [];
    const noop = () => undefined;
    await act(async () => ui.root.render(withIntl(
      <DashboardScreen
        user={{ id: 'me', name: 'Me', username: 'me' }}
        groups={[{ id: 'existing', name: 'Existing group', role: 'participant' }]}
        challenges={[]}
        personalWorkspaceId={null}
        limits={DEFAULT_LIMITS}
        csrfToken=""
        onOpenGroup={noop}
        onOpenChallenge={noop}
        onOpenAdmin={noop}
        onCreateGroup={async (name) => { names.push(name); }}
        onQuickCreate={noop}
        onQuickCreatePersonal={noop}
        onCreatePersonalChallenge={noop}
        onCreateManually={async () => undefined}
        onOpenTemplate={noop}
        onOpenPersonalCatalog={noop}
      />,
    )));
    await act(async () => ui.button('+Novo grupo').click());
    const input = document.querySelector<HTMLInputElement>('dialog input[name="name"]')!;
    const create = ui.button('Criar');
    assertDisabled(create, true);
    await ui.fill(input, '   ');
    assertDisabled(create, true);
    await ui.fill(input, 'Our group');
    assertDisabled(create, false);
    await ui.fill(input, '');
    assertDisabled(create, true);
    await ui.fill(input, '  Our group  ');
    await act(async () => create.click());
    assert.deepEqual(names, ['Our group']);
  } finally { await ui.cleanup(); }
});

test('catalogue property lines scroll only when the text overflows', async () => {
  const ui = await setup();
  try {
    await act(async () => ui.root.render(withIntl(<CatalogRow title="Solaris" meta={['Stanisław Lem', '1961', '204']} />)));
    const line = document.querySelector<HTMLElement>('.catalog-property-line')!;
    const text = line.firstElementChild as HTMLElement;
    let scrollWidth = 100;
    Object.defineProperties(text, { clientWidth: { value: 100 }, scrollWidth: { get: () => scrollWidth } });
    const row = line.closest('.flex')!;
    await act(async () => row.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true })));
    assert.equal(text.hasAttribute('data-scrolling'), false);
    await act(async () => row.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true })));
    scrollWidth = 240;
    await act(async () => row.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true })));
    assert.equal(text.style.getPropertyValue('--property-distance'), '-140px');
    await act(async () => row.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true })));
    assert.equal(text.hasAttribute('data-scrolling'), false);
    await act(async () => line.focus());
    assert.equal(text.hasAttribute('data-scrolling'), true);
    await act(async () => line.blur());
    assert.equal(text.hasAttribute('data-scrolling'), false);
  } finally { await ui.cleanup(); }
});

test('the catalogue title stays on the list and its settings button keeps item editing available', async () => {
  const ui = await setup();
  try {
    clearCache();
    window.history.replaceState(null, '', '/catalog');
    const fetchFixture = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (input === '/api/bootstrap') return Response.json({ user: { id: 'me', name: 'Me', username: 'me' } });
      if (input === '/api/personal/catalog') return Response.json({ items: [{ id: 'item', kind: library.kind, title: 'Solaris', year: 1961 }] });
      return fetchFixture(input, init);
    };
    await act(async () => ui.root.render(withIntl(<GoaApp />)));
    const title = [...document.querySelectorAll('strong')].find((node) => node.textContent === 'Solaris');
    assert.ok(title);
    await act(async () => title.click());
    assert.equal(window.location.pathname, '/catalog');
    assert.equal(document.querySelector('dialog'), null);
    await act(async () => ui.button('Editar item: Solaris').click());
    assert.ok(document.querySelector('dialog input[value="Solaris"]'));
    assert.equal(window.location.pathname, '/catalog');
  } finally { await ui.cleanup(); }
});

test('dashboard renders long challenge shelves in batches and still reaches the last card', async () => {
  const ui = await setup();
  try {
    clearCache();
    const fetchFixture = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (input === '/api/bootstrap') return Response.json({
        user: { id: 'me', name: 'Me', username: 'me' },
        groups: [{ id: 'group', name: 'Group', role: 'participant' }],
        challenges: Array.from({ length: 50 }, (_, index) => ({
          id: `c${index}`, groupId: 'group', title: `Challenge ${index + 1}`, status: 'active',
        })),
      });
      return fetchFixture(input, init);
    };
    await act(async () => ui.root.render(withIntl(<GoaApp />)));
    assert.equal(document.querySelectorAll('article').length, 24);
    await act(async () => ui.button('+ 24 mais').click());
    assert.equal(document.querySelectorAll('article').length, 48);
    await act(async () => ui.button('+ 2 mais').click());
    assert.equal(document.querySelectorAll('article').length, 50);
    assert.ok(ui.button('Challenge 50'));
  } finally { await ui.cleanup(); }
});

test('guided new-group flow retains its destination', async () => {
  const ui = await setup();
  try {
    const targets: Array<{groupId: string} | {personal: true}> = [];
    await act(async () => ui.root.render(withIntl(<QuickCreateScreen currentUserId="me" groups={[]} onBack={() => undefined} onCreateGroup={async () => 'new-group'} onSubmit={async (target) => { targets.push(target); }} />)));
    await act(async () => ui.button('＋ Grupo').click());
    await ui.fill(document.querySelector<HTMLInputElement>('input[aria-label="Nome do grupo"]')!, 'Our group');
    assertDisabled(ui.button('Criar grupo'), false);
    await act(async () => ui.button('Criar grupo').click());
    await ui.fill(document.querySelector<HTMLInputElement>('input[aria-label="Nome do desafio"]')!, 'Group challenge');
    await act(async () => ui.button('Check-in diário').click());
    await act(async () => ui.button('Continuar').click());
    await act(async () => ui.button('Criar rascunho').click());
    assert.deepEqual(targets, [{groupId: 'new-group'}]);
  } finally { await ui.cleanup(); }
});

test('an older progress draft preserves its configured goal and recipe', async () => {
  const ui = await setup();
  try {
    const saved: ChallengeCreationInput[] = [];
    const old = draft(true, true); delete old.sheetMode; delete old.libraryEnabled; delete old.dated;
    old.structure = 'progress';
    old.fields = [{key: 'amount', label: 'Amount', type: 'number', required: true, config: {count: {goal: {value: 42}, entry: 'amount', showDates: true}}}];
    await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal initialDraft={old} onBack={() => undefined} onCreate={async (input) => { saved.push(input); }} />)));
    assert.equal(ui.libraryOption('My items').checked, true);
    await act(async () => ui.button('Check-in diário').click());
    await act(async () => ui.button('Continuar').click());
    await act(async () => ui.button('Continuar').click());
    await act(async () => ui.button('Criar rascunho').click());
    assert.equal(saved[0].recipe, 'progress');
    assert.deepEqual(saved[0].fields[0].config?.count?.goal, {value: 42});
  } finally { await ui.cleanup(); }
});

test('saved drafts resume the questions step after navigation is reordered', async () => {
  const ui = await setup();
  try {
    const old = draft(true, false); old.step = 2;
    await act(async () => ui.root.render(withIntl(<CreateChallengeScreen personal initialDraft={old} onBack={() => undefined} onCreate={async () => undefined} />)));
    assert.match(document.querySelector('section')!.textContent!, /Amount/);
    assertDisabled(ui.button('Criar rascunho'), false);
  } finally { await ui.cleanup(); }
});

for (const deadline of [false, true]) {
  test(`stages are ordered groups; dates offered only with a deadline=${deadline}`, async () => {
    const ui = await setup();
    try {
      const saved: CheckpointInput[][] = [];
      const challenge = {id: 'c', status: 'draft', endsOn: deadline ? '2027-02-01' : null, checkpoints: [], items: [{id: 'i', title: 'A movie', position: 0}]} as unknown as ChallengeDetail;
      await act(async () => ui.root.render(withIntl(<CheckpointPlanner challenge={challenge} onSaveCheckpoints={async (input) => { saved.push(input); }} onAssign={async () => undefined} />)));
      await act(async () => ui.button('Adicionar etapa').click());
      assert.equal(document.querySelectorAll('input[type="date"]').length, deadline ? 2 : 0);
      await ui.fill(document.querySelector<HTMLInputElement>('input[maxlength="160"]')!, 'Horror movies');
      await act(async () => ui.button('Salvar').click());
      assert.equal(saved[0][0].title, 'Horror movies');
      assert.equal(saved[0][0].startsAt, null);
      assert.equal(saved[0][0].dueAt, null);
    } finally { await ui.cleanup(); }
  });
}

test('a stage with historical dates keeps them editable even if the challenge deadline was removed', async () => {
  const ui = await setup();
  try {
    const saved: CheckpointInput[][] = [];
    const challenge = {id: 'c', status: 'draft', endsOn: null, checkpoints: [{id: 'cp', title: 'Original', kind: 'session', opensAt: '2027-01-10T00:00:00Z', dueAt: '2027-01-20T00:00:00Z', position: 0}], items: [{id: 'i', title: 'A movie', checkpointId: 'cp', position: 0}]} as unknown as ChallengeDetail;
    await act(async () => ui.root.render(withIntl(<CheckpointPlanner challenge={challenge} onSaveCheckpoints={async (input) => { saved.push(input); }} onAssign={async () => undefined} />)));
    const open = document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
    await act(async () => open.click());
    await act(async () => ui.button('Configurações da etapa: Original').click());
    const dates = [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    assert.deepEqual(dates.map((field) => field.value), ['2027-01-10', '2027-01-20']);
    await ui.fill(document.querySelector<HTMLInputElement>('input[maxlength="160"]')!, 'Renamed');
    await act(async () => ui.button('Salvar').click());
    assert.equal(saved[0][0].startsAt, '2027-01-10T00:00:00Z');
    assert.equal(saved[0][0].dueAt, '2027-01-20T00:00:00Z');
  } finally { await ui.cleanup(); }
});
