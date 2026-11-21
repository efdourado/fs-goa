import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";

import { GroupScreen } from "../app/goa/screens/group";
import type { GroupInviteResult } from "../app/goa/types";
import { Toaster } from "../app/goa/ui";
import { withIntl } from "./helpers/intl";

function setup() {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const originalFormData = globalThis.FormData;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, FormData: dom.window.FormData,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLDialogElement.prototype.showModal = () => undefined;
  dom.window.HTMLDialogElement.prototype.close = () => undefined;
  const root = createRoot(document.getElementById("root")!);
  return {
    dom,
    root,
    cleanup: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      globalThis.FormData = originalFormData;
    },
  };
}

const noop = () => undefined;
const noopAsync = async () => undefined;
const pending = { id: "pending", name: "Outra", username: "outra", createdAt: "2026-11-20T12:00:00Z" };
const group = { id: "g", name: "Grupo", role: "owner", members: [{ id: "u", name: "Teste", username: "teste", role: "participant" }] } satisfies ComponentProps<typeof GroupScreen>["group"];

function groupScreen(props: Partial<ComponentProps<typeof GroupScreen>>) {
  return (
    <GroupScreen
      group={group} challenges={[]} challengeLimit={10} pendingRequests={[pending]}
      onBack={noop} onCreateChallenge={noop} onQuickCreate={noop} onOpenChallenge={noop} onOpenCatalog={noop}
      onCreateInvite={async () => ({ url: "http://localhost/invite" })}
      onInviteByUsername={async () => ({ groupId: group.id, status: "already_member", member: group.members[0] })}
      onCancelRequest={noopAsync} onUpdateGroup={noopAsync}
      {...props}
    />
  );
}

test("the group header uses at most three member circles alongside the invite button", async () => {
  const { root, cleanup } = setup();
  const members = Array.from({ length: 4 }, (_, index) => ({
    ...group.members[0],
    id: `member-${index}`,
    name: `Pessoa ${index}`,
  }));
  try {
    await act(async () => root.render(withIntl(groupScreen({ group: { ...group, members } }))));
    const invite = document.querySelector<HTMLButtonElement>('button[aria-label="Convidar pessoas"]');
    const stack = invite?.parentElement;
    assert.ok(stack);
    assert.equal(stack.children.length, 4);
    assert.equal(stack.querySelectorAll("span[title]").length, 2);
    assert.equal(invite.previousElementSibling?.textContent, "+2");
  } finally {
    await cleanup();
  }
});

test("rapid @-invite submits send once and closing the dialog does not replay feedback", async () => {
  const { dom, root, cleanup } = setup();
  const submissions: string[] = [];
  let finish!: (result: GroupInviteResult) => void;
  const invited = new Promise<GroupInviteResult>((resolve) => { finish = resolve; });
  try {
    await act(async () => root.render(withIntl(
      <>
        <Toaster />
        {groupScreen({ onInviteByUsername: (username) => { submissions.push(username); return invited; } })}
      </>,
    )));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Convidar pessoas"]')!.click());
    const input = document.querySelector<HTMLInputElement>('input[name="username"]')!;
    input.value = "@teste";
    const form = input.form!;
    await act(async () => {
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.deepEqual(submissions, ["@teste"]);
    await act(async () => finish({ groupId: "g", status: "requested", member: { id: "u", name: "Teste", username: "teste", role: "participant" } }));
    assert.equal(input.value, "");
    const toastCount = () => [...document.querySelectorAll('[role="status"]')].filter((toast) => toast.textContent?.includes("Convite enviado para @teste.")).length;
    assert.equal(toastCount(), 1);
    await act(async () => document.querySelector<HTMLButtonElement>('dialog button[aria-label="Fechar"]')!.click());
    assert.equal(toastCount(), 1);
  } finally {
    await cleanup();
  }
});

test("members and pending invitations each preview three rows and expand independently", async () => {
  const { root, cleanup } = setup();
  const members = Array.from({ length: 4 }, (_, index) => ({
    ...group.members[0], id: `member-${index}`, name: `Pessoa ${index + 1}`,
  }));
  const pendingRequests = Array.from({ length: 5 }, (_, index) => ({
    ...pending, id: `invite-${index}`, name: `Convidada ${index + 1}`,
  }));
  const showMore = (count: number) => [...document.querySelectorAll("button")].find((button) => button.textContent === `Mostrar mais (+${count})`);
  const names = () => [...document.querySelectorAll("li strong")].map((name) => name.textContent);
  try {
    await act(async () => root.render(withIntl(groupScreen({ group: { ...group, members }, pendingRequests }))));
    assert.deepEqual(names(), ["Pessoa 1", "Pessoa 2", "Pessoa 3", "Convidada 1", "Convidada 2", "Convidada 3"]);
    await act(async () => showMore(1)!.click());
    assert.ok(names().includes("Pessoa 4"));
    assert.ok(!names().includes("Convidada 4"));
    assert.equal(showMore(1), undefined);
    await act(async () => showMore(2)!.click());
    assert.ok(names().includes("Convidada 5"));
    assert.equal(showMore(2), undefined);
  } finally {
    await cleanup();
  }
});

test("role changes run directly while bans and cancellations confirm inside the dialog", async () => {
  const { root, cleanup } = setup();
  const calls: string[] = [];
  const findButton = (label: string, scope: ParentNode = document) => {
    const button = [...scope.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
    assert.ok(button, `button ${label} exists`);
    return button;
  };
  const handlers = {
    onSetMemberRole: async (id, role) => { calls.push(`role:${id}:${role}`); },
    onSetMemberBan: async (id, banned) => { calls.push(`ban:${id}:${banned}`); },
    onCancelRequest: async (id) => { calls.push(`cancel:${id}`); },
  } satisfies Partial<ComponentProps<typeof GroupScreen>>;
  try {
    await act(async () => root.render(withIntl(groupScreen(handlers))));

    const confirm = async (row: string, title: string, action: string, confirmLabel: string, expectedCall: string) => {
      const rowButton = findButton(row);
      assert.equal(rowButton.getAttribute("aria-haspopup"), "dialog");
      await act(async () => rowButton.click());
      const dialog = document.querySelector("dialog")!;
      assert.equal(dialog.querySelector("h2")?.textContent, title);
      const callCount = calls.length;
      await act(async () => findButton(action, dialog).click());
      assert.equal(calls.length, callCount);
      assert.equal(document.querySelector("dialog"), dialog);
      assert.equal(findButton(action, dialog).getAttribute("aria-expanded"), "true");
      await act(async () => findButton(confirmLabel, dialog).click());
      assert.equal(calls.at(-1), expectedCall);
      assert.equal(document.querySelector("dialog"), null);
    };

    assert.match(findButton("@teste").textContent ?? "", /Participante/);
    await act(async () => findButton("@teste").click());
    const memberDialog = document.querySelector("dialog")!;
    const promote = findButton("Tornar admin", memberDialog);
    assert.equal(findButton("Banir", memberDialog).nextElementSibling, promote);
    assert.equal(promote.hasAttribute("aria-expanded"), false);
    await act(async () => promote.click());
    assert.deepEqual(calls, ["role:u:admin"]);
    assert.equal(document.querySelector("dialog"), null);

    await act(async () => root.render(withIntl(groupScreen({
      ...handlers,
      group: { ...group, members: [{ ...group.members[0], role: "admin" }] },
    }))));
    await act(async () => findButton("@teste").click());
    const demote = findButton("Tornar participante", document.querySelector("dialog")!);
    assert.equal(demote.hasAttribute("aria-expanded"), false);
    await act(async () => demote.click());
    assert.deepEqual(calls, ["role:u:admin", "role:u:participant"]);
    assert.equal(document.querySelector("dialog"), null);
    await confirm("@teste", "Gerenciar Teste", "Banir", "Confirmar banimento", "ban:u:true");
    await confirm("@outra", "Convite para Outra", "Cancelar convite", "Confirmar cancelamento", "cancel:pending");

    await act(async () => root.render(withIntl(groupScreen({
      group: { ...group, role: "participant" },
    }))));
    const memberRow = [...document.querySelectorAll("li")].find((row) => row.textContent?.includes("@teste"));
    assert.ok(memberRow);
    assert.equal(memberRow.querySelector("button"), null);
    assert.doesNotMatch(document.body.textContent ?? "", /@outra/);
  } finally {
    await cleanup();
  }
});

test("the header shows an icon-only leave action for non-owners and confirms leaving", async () => {
  const { root, cleanup } = setup();
  let leaves = 0;
  const onLeaveGroup = async () => { leaves += 1; };
  const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  try {
    await act(async () => root.render(withIntl(groupScreen({ onDeleteGroup: noopAsync }))));
    assert.equal(button("Sair do grupo"), null);
    await act(async () => button("Editar grupo")!.click());
    const ownerDialog = document.querySelector("dialog")!;
    assert.ok(ownerDialog.querySelector("input"));
    const save = ownerDialog.querySelector("button[type='submit']");
    const remove = save?.parentElement?.querySelector<HTMLButtonElement>("button[type='button']");
    assert.ok(remove);
    assert.equal(remove.textContent, "Excluir");
    assert.equal(remove.nextElementSibling, save);
    await act(async () => remove.click());
    assert.equal(remove.getAttribute("aria-expanded"), "true");
    assert.match(ownerDialog.textContent ?? "", /Confirmar exclusão/);
    assert.doesNotMatch(ownerDialog.textContent ?? "", /Sair/);
    await act(async () => button("Fechar")!.click());

    await act(async () => root.render(withIntl(groupScreen({ group: { ...group, role: "admin" }, onLeaveGroup }))));
    const edit = button("Editar grupo");
    const leave = button("Sair do grupo");
    assert.ok(edit);
    assert.ok(leave);
    assert.equal(edit.nextElementSibling, leave);
    assert.equal(leave.textContent, "");
    assert.ok(leave.classList.contains("hover:text-[var(--danger)]"));
    assert.equal(leave.querySelector("svg")?.getAttribute("class"), edit.querySelector("svg")?.getAttribute("class"));
    await act(async () => edit.click());
    const adminDialog = document.querySelector("dialog")!;
    assert.ok(adminDialog.querySelector("input"));
    assert.ok(adminDialog.classList.contains("overflow-y-auto"));
    const saveBar = adminDialog.querySelector("button[type='submit']")?.parentElement;
    assert.ok(saveBar);
    assert.ok(saveBar.classList.contains("sticky"));
    assert.ok(saveBar.classList.contains("bottom-0"));
    assert.doesNotMatch(adminDialog.textContent ?? "", /Sair do grupo/);
    await act(async () => button("Fechar")!.click());

    await act(async () => root.render(withIntl(groupScreen({ group: { ...group, role: "participant" }, onLeaveGroup }))));
    assert.equal(button("Editar grupo"), null);
    await act(async () => button("Sair do grupo")!.click());
    const memberDialog = document.querySelector("dialog")!;
    assert.equal(memberDialog.querySelector("h2")?.textContent, "Sair do grupo?");
    assert.match(memberDialog.textContent ?? "", /Tudo seu neste grupo é apagado\./);
    assert.equal(leaves, 0);
    const confirm = [...memberDialog.querySelectorAll("button")].find((action) => action.textContent === "Confirmar saída");
    assert.ok(confirm);
    await act(async () => confirm.click());
    assert.equal(leaves, 1);
    assert.equal(document.querySelector("dialog"), null);
  } finally {
    await cleanup();
  }
});
