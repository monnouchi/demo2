import test from "node:test";
import assert from "node:assert/strict";
import {
  CARDS,
  STAKES,
  compare,
  initialState,
  resolveRound,
  matchResult,
  matchSummary,
  prepareRound,
  cpuPolicy,
  chooseCpu,
} from "../src/game.js";
function permutations(items) {
  return items.length
    ? items.flatMap((n, i) =>
        permutations(items.filter((_, j) => j !== i)).map((rest) => [
          n,
          ...rest,
        ]),
      )
    : [[]];
}
test("all 25 matchups: order, equality, and both reversal directions", () => {
  for (const a of CARDS)
    for (const b of CARDS) {
      const expected =
        a === b
          ? 0
          : a === 1 && b === 5
            ? 1
            : a === 5 && b === 1
              ? -1
              : Math.sign(a - b);
      assert.equal(compare(a, b), expected);
      assert.equal(compare(a, b) + compare(b, a), 0);
    }
  for (const n of [0, 6, null, "1", NaN])
    assert.throws(() => compare(n, 1), RangeError);
});
test("stakes, draw without carryover, late reversal, and immutable input", () => {
  const initial = initialState();
  const frozen = structuredClone(initial);
  let s = resolveRound(initial, 2, 2);
  assert.deepEqual(s.scores, [0, 0]);
  assert.deepEqual(initial, frozen);
  s = resolveRound(s, 3, 1);
  assert.deepEqual(s.scores, [1, 0]);
  s = resolveRound(s, 4, 3);
  assert.deepEqual(s.scores, [2, 0]);
  s = resolveRound(s, 1, 5);
  assert.deepEqual(s.scores, [4, 0]);
  assert.equal(s.history.at(-1).reversal, true);
  s = resolveRound(s, 5, 4);
  assert.deepEqual(s.scores, [6, 0]);
  assert.equal(matchResult(s), 1);
  assert.equal(matchResult(initial), null);
  assert.throws(() => resolveRound(s, 1, 1));
  assert.throws(() => resolveRound(resolveRound(initial, 1, 2), 1, 3));
});
test("all 14,400 complete match pairs conserve cards, scores, and symmetry", () => {
  const hands = permutations(CARDS);
  let draws = 0;
  for (const player of hands)
    for (const cpu of hands) {
      let state = initialState(),
        swapped = initialState();
      for (let r = 0; r < 5; r++) {
        state = resolveRound(state, player[r], cpu[r]);
        swapped = resolveRound(swapped, cpu[r], player[r]);
      }
      assert.deepEqual(state.player, []);
      assert.deepEqual(state.cpu, []);
      assert.ok(
        state.scores[0] + state.scores[1] <= STAKES.reduce((a, b) => a + b),
      );
      assert.deepEqual(state.scores, swapped.scores.toReversed());
      assert.equal(matchResult(state) + matchResult(swapped), 0);
      if (matchResult(state) === 0) draws++;
    }
  assert.ok(draws > 120, "Includes non-identical-order draws");
});
test("CPU commits once before selection and cannot inspect pending input", () => {
  const state = initialState();
  let calls = 0;
  const reveal = prepareRound(state, () => {
    calls++;
    return 0.42;
  });
  assert.equal(calls, 1);
  const expected = chooseCpu(state.cpu, state.player, 0, () => 0.42);
  for (const selected of CARDS) {
    const result = prepareRound(state, () => 0.42)(selected);
    assert.equal(result.history[0].cpuCard, expected);
  }
  state.cpu = [];
  state.player = []; // Commitment snapshots public state.
  assert.equal(reveal(1).history[0].cpuCard, expected);
  assert.equal(calls, 1);
  assert.throws(() => reveal(2), /Already revealed/);
});
test("invalid reveal does not consume commitment", () => {
  const reveal = prepareRound(initialState(), () => 0.1);
  assert.throws(() => reveal(7));
  assert.equal(reveal(3).history.length, 1);
});
test("CPU distributions are legal, normalized and mixed at every possible public hand state", () => {
  const subsets = Array.from({ length: 31 }, (_, mask) =>
    CARDS.filter((n) => (mask + 1) & (1 << (n - 1))),
  );
  for (const own of subsets)
    for (const opposing of subsets.filter((h) => h.length === own.length)) {
      const before = JSON.stringify([own, opposing]);
      const policy = cpuPolicy(own, opposing, 5 - own.length);
      assert.ok(Math.abs(policy.reduce((a, b) => a + b) - 1) < 1e-10);
      assert.ok(policy.every((p) => p > 0 && p <= 1));
      for (const rng of [0, 0.1, 0.5, 0.999999])
        assert.ok(
          own.includes(chooseCpu(own, opposing, 5 - own.length, () => rng)),
        );
      assert.equal(JSON.stringify([own, opposing]), before);
    }
  assert.throws(() => cpuPolicy([1, 1], [2, 3], 3));
  assert.throws(() => chooseCpu([1], [2], 4, () => 1));
});
test("one-card ending is forced, and all equal cards yields a match draw", () => {
  assert.equal(chooseCpu([1], [5], 4), 1);
  let s = initialState();
  for (const n of CARDS) s = resolveRound(s, n, n);
  assert.equal(matchResult(s), 0);
  assert.deepEqual(s.scores, [0, 0]);
  assert.throws(() => prepareRound(s));
});

test("recap distinguishes round wins from weighted match points", () => {
  const player = [1, 3, 4, 2, 5],
    cpu = [5, 2, 3, 4, 1];
  let state = initialState();
  assert.throws(() => matchSummary(state), /not finished/);
  player.forEach((card, i) => {
    state = resolveRound(state, card, cpu[i]);
  });
  assert.deepEqual(matchSummary(state), {
    counts: [3, 2, 0],
    lateScores: [0, 4],
  });
  assert.deepEqual(state.scores, [3, 4]);
  assert.equal(
    matchResult(state),
    -1,
    "Three round wins can still lose the match",
  );
  let draw = initialState();
  for (const card of CARDS) draw = resolveRound(draw, card, card);
  assert.deepEqual(matchSummary(draw), {
    counts: [0, 0, 5],
    lateScores: [0, 0],
  });
});
