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

    await act(async () => root.render(withIntl(groupScreen({
      group: { ...group, role: "admin" },
      onLeaveGroup: async () => { calls.push("leave"); },
    }))));
    const leaveButton = findButton("Sair");
    assert.equal(leaveButton.textContent, "Sair");
    await act(async () => leaveButton.click());
    const leaveDialog = document.querySelector("dialog")!;
    assert.match(leaveDialog.textContent ?? "", /Sair do grupo\?/);
    assert.equal(calls.includes("leave"), false);
    await act(async () => findButton("Sair do grupo", leaveDialog).click());
    assert.equal(calls.at(-1), "leave");
  } finally {
    await cleanup();
  }
});
