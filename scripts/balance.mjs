import {
  CARDS,
  STAKES,
  initialState,
  resolveRound,
  chooseCpu,
  cpuPolicy,
  compare,
  without,
  matchResult,
} from "../src/game.js";
let seed = 20261002;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const sample = (hand, random = rng) => hand[Math.floor(random() * hand.length)];
// Exact expected final match outcome against the public CPU distribution.
// This best response knows the policy but not its sampled hidden card.
const memo = new Map();
function bestResponse(player, cpu, round, delta) {
  if (!player.length) return { value: Math.sign(delta) };
  const key = `${player.join("")}/${cpu.join("")}/${delta}`;
  if (memo.has(key)) return memo.get(key);
  const policy = cpuPolicy(cpu, player, round);
  const scores = player.map((p) =>
    cpu.reduce(
      (sum, c, i) =>
        sum +
        policy[i] *
          bestResponse(
            without(player, p),
            without(cpu, c),
            round + 1,
            delta + STAKES[round] * compare(p, c),
          ).value,
      0,
    ),
  );
  const value = Math.max(...scores);
  const result = { value, card: player[scores.indexOf(value)] };
  memo.set(key, result);
  return result;
}
const strategies = {
  random: (s) => sample(s.player),
  ascending: (s) => s.player[0],
  descending: (s) => s.player.at(-1),
  save_crown: (s) => [2, 3, 4, 1, 5].find((n) => s.player.includes(n)),
  mirror_cpu_policy: (s) => chooseCpu(s.player, s.cpu, s.history.length, rng),
  informed_best_response: (s) =>
    bestResponse(s.player, s.cpu, s.history.length, s.scores[0] - s.scores[1])
      .card,
};
console.log(
  "Seed 20261002; 20,000 games / strategy; W/D/L are PLAYER results.",
);
console.log(
  "Initial CPU policy:",
  cpuPolicy([...CARDS], [...CARDS], 0)
    .map((p) => `${(p * 100).toFixed(1)}%`)
    .join(", "),
);
for (const [name, strategy] of Object.entries(strategies)) {
  let wins = 0,
    draws = 0,
    losses = 0,
    margin = 0,
    lateSwings = 0;
  for (let game = 0; game < 20000; game++) {
    let state = initialState(),
      early;
    for (let round = 0; round < 5; round++) {
      const cpu = chooseCpu(state.cpu, state.player, round, rng); // Commit first.
      const player = strategy(state);
      state = resolveRound(state, player, cpu);
      if (round === 2) early = Math.sign(state.scores[0] - state.scores[1]);
    }
    const result = matchResult(state);
    if (result > 0) wins++;
    else if (result < 0) losses++;
    else draws++;
    if (early !== 0 && result === -early) lateSwings++;
    margin += state.scores[0] - state.scores[1];
  }
  console.log(
    `${name.padEnd(24)} W ${(wins / 200).toFixed(2)}% D ${(draws / 200).toFixed(2)}% L ${(losses / 200).toFixed(2)}%; margin ${(margin / 20000).toFixed(3)}; late lead reversals ${(lateSwings / 200).toFixed(2)}%`,
  );
}
console.log(
  "Exact informed best response expected W−L:",
  bestResponse([...CARDS], [...CARDS], 0, 0).value.toFixed(5),
);
