// Enumerate all CPU paths, weighted by the actual policy, against fixed 1→2→3→4→5.
// No simulation seed and no unpublished player input enter the CPU policy.
import {
  OPPONENTS,
  initialState,
  cpuPolicy,
  resolveRound,
  matchResult,
} from "../src/game.js";
for (let level = 0; level < OPPONENTS.length; level++) {
  const totals = [0, 0, 0];
  let paths = 0;
  function walk(state, probability) {
    if (state.history.length === 5) {
      const result = matchResult(state);
      totals[result > 0 ? 0 : result === 0 ? 1 : 2] += probability;
      paths++;
      return;
    }
    const policy = cpuPolicy(
      state.cpu,
      state.player,
      state.history.length,
      level,
    );
    state.cpu.forEach((cpu, i) => {
      if (policy[i])
        walk(
          resolveRound(state, state.player[0], cpu),
          probability * policy[i],
        );
    });
  }
  walk(initialState(), 1);
  console.log(
    JSON.stringify({
      opponent: OPPONENTS[level].name,
      player: "1→2→3→4→5",
      win: totals[0],
      draw: totals[1],
      loss: totals[2],
      notLose: totals[0] + totals[1],
      paths,
    }),
  );
}
