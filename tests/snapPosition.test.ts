import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSnapPosition, type Rect } from "../src/windows/snapPosition.ts";

// A 1512×982 primary screen at the origin (logical px, MacBook-ish).
const primary: Rect = { x: 0, y: 0, width: 1512, height: 982 };
// A 1920×1080 external screen to the right of the primary.
const external: Rect = { x: 1512, y: 0, width: 1920, height: 1080 };

const avatar: Rect = { x: 600, y: 500, width: 170, height: 170 };
const chat = { width: 360, height: 480 };
const bubble = { width: 260, height: 120 };

test("snaps to the right of the avatar, bottoms aligned", () => {
  const pos = computeSnapPosition(avatar, chat, primary, "right");
  assert.equal(pos.x, avatar.x + avatar.width + 12);
  assert.equal(pos.y, avatar.y + avatar.height - chat.height);
});

test("snaps above the avatar, horizontally centered", () => {
  const pos = computeSnapPosition(avatar, bubble, primary, "top");
  assert.equal(pos.x, avatar.x + Math.round((avatar.width - bubble.width) / 2));
  assert.equal(pos.y, avatar.y - bubble.height - 12);
});

test("flips to the left when the right edge would overflow", () => {
  const nearRight: Rect = { ...avatar, x: primary.width - 200 };
  const pos = computeSnapPosition(nearRight, chat, primary, "right");
  assert.equal(pos.x, nearRight.x - chat.width - 12);
});

test("flips below when the top edge would overflow", () => {
  const nearTop: Rect = { ...avatar, y: 40 };
  const pos = computeSnapPosition(nearTop, bubble, primary, "top");
  assert.equal(pos.y, nearTop.y + nearTop.height + 12);
});

test("clamps into a monitor whose origin is not (0,0)", () => {
  // Avatar near the right edge of the external screen: flipping left keeps
  // the chat inside, and the result never crosses the monitor's left bound.
  const onExternal: Rect = { ...avatar, x: external.x + external.width - 180 };
  const pos = computeSnapPosition(onExternal, chat, external, "right");
  assert.equal(pos.x, onExternal.x - chat.width - 12);
  assert.ok(pos.x >= external.x);
  assert.ok(pos.x + chat.width <= external.x + external.width);
});

test("clamps within monitors at negative coordinates", () => {
  // External screen arranged to the LEFT of the primary → negative x space.
  const left: Rect = { x: -1920, y: 0, width: 1920, height: 1080 };
  const nearLeftEdge: Rect = { ...avatar, x: left.x + 10, y: 40 };
  const pos = computeSnapPosition(nearLeftEdge, bubble, left, "top");
  // Flipped below (too close to the top), clamped to the monitor's left edge.
  assert.equal(pos.y, nearLeftEdge.y + nearLeftEdge.height + 12);
  assert.ok(pos.x >= left.x);
  assert.ok(pos.x + bubble.width <= left.x + left.width);
});

test("no monitor → raw snap spot, unclamped", () => {
  const pos = computeSnapPosition(avatar, chat, null, "right");
  assert.equal(pos.x, avatar.x + avatar.width + 12);
  assert.equal(pos.y, avatar.y + avatar.height - chat.height);
});
