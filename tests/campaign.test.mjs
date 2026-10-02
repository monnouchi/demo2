import test from "node:test";
import assert from "node:assert/strict";
import {
  CARDS,
  OPPONENTS,
  initialState,
  resolveRound,
  prepareRound,
  cpuPolicy,
  chooseCpu,
  initialCampaign,
  readCampaign,
  finishCampaignMatch,
  nextCircuit,
  sweepKind,
} from "../src/game.js";
const permutations = (a) =>
  a.length
    ? a.flatMap((n, i) =>
        permutations(a.filter((_, j) => i !== j)).map((rest) => [n, ...rest]),
      )
    : [[]];
test("practice opponent follows its disclosed sequence for all player orders", () => {
  for (const order of permutations(CARDS)) {
    let s = initialState();
    for (const [i, p] of order.entries()) {
      s = prepareRound(s, () => 0.42, 0)(p);
      assert.equal(s.history[i].cpuCard, [5, 4, 2, 1, 3][i]);
    }
  }
});
test("every opponent commits before input, samples once, and cannot change its move", () => {
  for (let level = 0; level < 5; level++) {
    const s = initialState();
    let calls = 0;
    const reveal = prepareRound(
      s,
      () => {
        calls++;
        return 0.43;
      },
      level,
    );
    assert.equal(calls, 1);
    const c = reveal(1).history[0].cpuCard;
    for (const p of CARDS)
      assert.equal(prepareRound(s, () => 0.43, level)(p).history[0].cpuCard, c);
    assert.throws(() => reveal(2), /Already revealed/);
    assert.equal(calls, 1);
  }
});
test("all 5 policies are normalized and legal in every public hand state", () => {
  const subsets = Array.from({ length: 31 }, (_, mask) =>
    CARDS.filter((n) => (mask + 1) & (1 << (n - 1))),
  );
  for (let level = 0; level < 5; level++)
    for (const own of subsets)
      for (const other of subsets.filter((h) => h.length === own.length)) {
        const policy = cpuPolicy(own, other, 5 - own.length, level);
        assert.ok(policy.every((p) => p >= 0 && p <= 1));
        assert.ok(Math.abs(policy.reduce((a, b) => a + b) - 1) < 1e-10);
        for (const roll of [0, 0.43, 0.999999])
          assert.ok(
            own.includes(
              chooseCpu(own, other, 5 - own.length, () => roll, level),
            ),
          );
      }
  for (const level of [-1, 5, 1.5])
    assert.throws(() => cpuPolicy([...CARDS], [...CARDS], 0, level));
  assert.equal(OPPONENTS.length, 5);
});
test("wins advance, losses and draws retry, fifth win clears, next circuit keeps stats", () => {
  let c = initialCampaign();
  const original = structuredClone(c);
  c = finishCampaignMatch(c, -1);
  c = finishCampaignMatch(c, 0);
  assert.equal(c.stage, 0);
  assert.equal(c.losses, 1);
  assert.equal(c.draws, 1);
  for (let stage = 0; stage < 5; stage++) {
    assert.equal(c.stage, stage);
    c = finishCampaignMatch(c, 1);
    assert.equal(c.wins, stage + 1);
  }
  assert.equal(c.completed, true);
  assert.equal(c.clears, 1);
  assert.equal(c.stage, 4);
  assert.throws(() => finishCampaignMatch(c, 1));
  assert.deepEqual(initialCampaign(), original);
  assert.deepEqual(readCampaign(JSON.stringify(c)), c);
  c = nextCircuit(c);
  assert.deepEqual(c, {
    version: 1,
    stage: 0,
    wins: 5,
    losses: 1,
    draws: 1,
    clears: 1,
    completed: false,
  });
  assert.deepEqual(readCampaign(JSON.stringify(c)), c);
});
test("invalid or inconsistent saved progress resets safely", () => {
  for (const value of [
    null,
    "{",
    "[]",
    "null",
    JSON.stringify({ ...initialCampaign(), stage: 4 }),
    JSON.stringify({ ...initialCampaign(), wins: -1 }),
    JSON.stringify({ ...initialCampaign(), completed: true }),
    JSON.stringify({ ...initialCampaign(), version: 2 }),
  ])
    assert.deepEqual(readCampaign(value), initialCampaign());
  assert.throws(() => finishCampaignMatch(initialCampaign(), null));
  assert.throws(() => nextCircuit(initialCampaign()));
});
test("for a fixed player order, each five-round sweep has exactly one of 120 opposing orders", () => {
  const counts = { perfect: 0, swept: 0, mirror: 0 };
  for (const cpu of permutations(CARDS)) {
    let s = initialState();
    CARDS.forEach((p, i) => {
      s = resolveRound(s, p, cpu[i]);
    });
    const kind = sweepKind(s);
    if (kind) counts[kind]++;
    if (kind === "perfect") assert.deepEqual(s.scores, [7, 0]);
    if (kind === "swept") assert.deepEqual(s.scores, [0, 7]);
    if (kind === "mirror") assert.deepEqual(s.scores, [0, 0]);
  }
  assert.deepEqual(counts, { perfect: 1, swept: 1, mirror: 1 });
});
