import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { type BackLookup, backTargetFor, isSameView } from "../app/goa/navigation";
import type { Screen } from "../app/goa/types";

const lookup = (overrides: Partial<BackLookup> = {}): BackLookup => ({
  loggedIn: true,
  groupName: (id) => (id === "g1" ? "Copa 2026" : null),
  challenge: (id) => (id === "c1" ? { groupId: "g1", personal: false } : id === "solo" ? { groupId: null, personal: true } : null),
  ...overrides,
});

describe("Back goes up the hierarchy, never to wherever you were", () => {
  test("Manage → its challenge → its group → Home, so settings and challenge can't bounce", () => {
    const manage: Screen = { kind: "admin", challengeId: "c1", tab: "metrics" };
    const first = backTargetFor(manage, lookup())!;
    assert.deepEqual(first.screen, { kind: "challenge", challengeId: "c1", tab: "results" });
    assert.deepEqual(first.label, { kind: "challenge" });
    const second = backTargetFor(first.screen, lookup())!;
    assert.deepEqual(second.screen, { kind: "group", groupId: "g1" });
    assert.deepEqual(second.label, { kind: "named", name: "Copa 2026" });
    const third = backTargetFor(second.screen, lookup())!;
    assert.deepEqual(third.screen, { kind: "dashboard" });
    assert.deepEqual(third.label, { kind: "home" });
    assert.equal(backTargetFor(third.screen, lookup()), null, "Home is the top");
  });

  test("a personal challenge goes straight up to Home, where the person's own challenges live", () => {
    const up = backTargetFor({ kind: "challenge", challengeId: "solo", tab: "today" }, lookup())!;
    assert.deepEqual(up.screen, { kind: "dashboard" });
    assert.deepEqual(up.label, { kind: "home" });
  });

  test("a challenge or group that can't be found falls back to Home instead of a dead screen", () => {
    assert.deepEqual(backTargetFor({ kind: "challenge", challengeId: "gone", tab: "results" }, lookup())!.screen, { kind: "dashboard" });
    assert.deepEqual(backTargetFor({ kind: "group-catalog", groupId: "gone" }, lookup())!.screen, { kind: "dashboard" });
    assert.deepEqual(backTargetFor({ kind: "create-challenge", groupId: "gone" }, lookup())!.label, { kind: "home" });
  });

  test("catalogue, trash and the creation wizard return to their own owner", () => {
    assert.deepEqual(backTargetFor({ kind: "group-catalog", groupId: "g1" }, lookup())!.screen, { kind: "group", groupId: "g1" });
    assert.deepEqual(backTargetFor({ kind: "catalog-item", groupId: "g1", itemId: "i" }, lookup())!.screen, { kind: "group-catalog", groupId: "g1" });
    assert.deepEqual(backTargetFor({ kind: "group-trash", groupId: "g1" }, lookup())!.screen, { kind: "group", groupId: "g1" });
    assert.deepEqual(backTargetFor({ kind: "create-challenge", groupId: "g1" }, lookup())!.label, { kind: "named", name: "Copa 2026" });
    assert.deepEqual(backTargetFor({ kind: "personal-catalog-item", itemId: "i" }, lookup())!.screen, { kind: "personal-catalog" });
    assert.deepEqual(backTargetFor({ kind: "personal-catalog" }, lookup())!.screen, { kind: "dashboard" });
    assert.deepEqual(backTargetFor({ kind: "create-personal-challenge" }, lookup())!.screen, { kind: "dashboard" });
  });

  test("the chat starts from Home or a group, and Back returns to whichever it was opened from", () => {
    assert.deepEqual(backTargetFor({ kind: "quick-create" }, lookup())!.screen, { kind: "dashboard" });
    assert.deepEqual(backTargetFor({ kind: "quick-create", into: { groupId: "g1" } }, lookup())!.screen, { kind: "group", groupId: "g1" });
    assert.deepEqual(backTargetFor({ kind: "quick-create", into: { groupId: "g1" } }, lookup())!.label, { kind: "named", name: "Copa 2026" });
    assert.deepEqual(backTargetFor({ kind: "quick-create", into: "personal" }, lookup())!.label, { kind: "home" });
  });

  test("the personal bin is opened from the account page, so Back returns there", () => {
    assert.deepEqual(backTargetFor({ kind: "personal-trash" }, lookup()), { screen: { kind: "account" }, label: { kind: "account" } });
  });

  test("account, about, templates and invites go Home when signed in, and to sign-in when not", () => {
    for (const screen of [{ kind: "account" }, { kind: "about" }, { kind: "templates" }, { kind: "invite", token: "t" }] as Screen[]) {
      assert.deepEqual(backTargetFor(screen, lookup())!.screen, { kind: "dashboard" }, screen.kind);
    }
    for (const screen of [{ kind: "about" }, { kind: "templates" }, { kind: "invite", token: "t" }] as Screen[]) {
      const out = backTargetFor(screen, lookup({ loggedIn: false }))!;
      assert.deepEqual(out.screen, { kind: "auth", mode: "login" }, screen.kind);
      assert.deepEqual(out.label, { kind: "signIn" });
    }
    assert.deepEqual(backTargetFor({ kind: "template", challengeId: "c" }, lookup())!.screen, { kind: "templates" });
  });

  test("the same view is recognised across a tab change, so Back can pop instead of stacking a duplicate", () => {
    assert.equal(isSameView({ kind: "challenge", challengeId: "c1", tab: "today" }, { kind: "challenge", challengeId: "c1", tab: "results" }), true);
    assert.equal(isSameView({ kind: "challenge", challengeId: "c1", tab: "today" }, { kind: "challenge", challengeId: "c2", tab: "today" }), false);
  });
});
