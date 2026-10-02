import {
  CARDS,
  OPPONENTS,
  initialState,
  resolveRound,
  chooseCpu,
  compare,
  matchResult,
} from "../src/game.js";
let seed = 20261002;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const strategies = {
  random: (s) => s.player[Math.floor(rng() * s.player.length)],
  ascending: (s) => s.player[0],
  descending: (s) => s.player.at(-1),
  save_crown: (s) => [2, 3, 4, 1, 5].find((n) => s.player.includes(n)),
  public_greedy: (s) =>
    s.player.reduce((best, n) => {
      const score = (c) => s.cpu.reduce((sum, opp) => sum + compare(c, opp), 0);
      return score(n) > score(best) ? n : best;
    }, s.player[0]),
};
const games = 20000;
console.log(
  "Player W/D/L %, seed 20261002, 20,000 games per opponent / strategy",
);
for (const [level, opponent] of OPPONENTS.entries()) {
  for (const [name, strategy] of Object.entries(strategies)) {
    const outcomes = [0, 0, 0];
    let margin = 0;
    for (let g = 0; g < games; g++) {
      let s = initialState();
      for (let r = 0; r < 5; r++) {
        const cpu = chooseCpu(s.cpu, s.player, r, rng, level);
        const player = strategy(s); // Only public state, never the committed CPU card.
        s = resolveRound(s, player, cpu);
      }
      const result = matchResult(s);
      outcomes[result > 0 ? 0 : result === 0 ? 1 : 2]++;
      margin += s.scores[0] - s.scores[1];
    }
    console.log(
      `${opponent.name}\t${name}\t${outcomes.map((n) => ((n / games) * 100).toFixed(2)).join("\t")}\tmargin ${(margin / games).toFixed(3)}`,
    );
  }
}
