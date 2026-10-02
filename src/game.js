/** Pure rules. Positive result means the first card wins. */
export const CARDS = Object.freeze([1, 2, 3, 4, 5]);
export const STAKES = Object.freeze([1, 1, 1, 2, 2]);
function card(value) {
  if (!CARDS.includes(value)) throw new RangeError("Invalid card");
}
export function compare(a, b) {
  card(a);
  card(b);
  if (a === b) return 0;
  if (a === 1 && b === 5) return 1;
  if (a === 5 && b === 1) return -1;
  return Math.sign(a - b);
}
export const without = (hand, used) => hand.filter((value) => value !== used);
export function initialState() {
  return { player: [...CARDS], cpu: [...CARDS], history: [], scores: [0, 0] };
}
export function resolveRound(state, playerCard, cpuCard) {
  const round = state.history.length;
  if (
    round >= 5 ||
    !state.player.includes(playerCard) ||
    !state.cpu.includes(cpuCard)
  )
    throw new RangeError("Illegal move");
  const result = compare(playerCard, cpuCard);
  const points = STAKES[round];
  const scores = [...state.scores];
  if (result) scores[result > 0 ? 0 : 1] += points;
  return {
    player: without(state.player, playerCard),
    cpu: without(state.cpu, cpuCard),
    scores,
    history: [
      ...state.history,
      {
        playerCard,
        cpuCard,
        result,
        points,
        reversal:
          playerCard !== cpuCard &&
          [playerCard, cpuCard].includes(1) &&
          [playerCard, cpuCard].includes(5),
      },
    ],
  };
}
export function matchResult(state) {
  if (state.history.length !== 5) return null;
  return Math.sign(state.scores[0] - state.scores[1]);
}

// Expectimax against uniformly distributed remaining opposing cards. Evaluates
// all future public hand states; temperature avoids a deterministic script.
// Neither this function nor its caller receives a player's pending selection.
const values = new Map();
function future(own, opposing, round) {
  if (!own.length) return 0;
  const key = `${own.join("")}/${opposing.join("")}/${round}`;
  if (!values.has(key))
    values.set(key, Math.max(...moveValues(own, opposing, round)));
  return values.get(key);
}
export function moveValues(own, opposing, round) {
  return own.map(
    (a) =>
      opposing.reduce(
        (sum, b) =>
          sum +
          STAKES[round] * compare(a, b) +
          future(without(own, a), without(opposing, b), round + 1),
        0,
      ) / opposing.length,
  );
}
export function cpuPolicy(own, opposing, round) {
  if (
    !own.length ||
    own.length !== opposing.length ||
    round !== 5 - own.length ||
    new Set(own).size !== own.length ||
    new Set(opposing).size !== opposing.length
  )
    throw new RangeError("Invalid public hands");
  own.forEach(card);
  opposing.forEach(card);
  const scores = moveValues(own, opposing, round);
  const maximum = Math.max(...scores);
  const weights = scores.map((score) => Math.exp((score - maximum) / 0.7));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((weight) => 0.15 / own.length + (0.85 * weight) / total);
}
export function chooseCpu(own, opposing, round, rng = Math.random) {
  const distribution = cpuPolicy(own, opposing, round);
  let roll = rng();
  if (!(roll >= 0 && roll < 1)) throw new RangeError("Invalid random value");
  for (let i = 0; i < own.length; i++) {
    roll -= distribution[i];
    if (roll < 0) return own[i];
  }
  return own.at(-1);
}
// Commit before rendering the input UI. Closure exposes only legal reveal;
// repeated reveals fail, and the hidden CPU move never depends on playerCard.
export function prepareRound(state, rng = Math.random) {
  if (state.history.length >= 5) throw new RangeError("Match finished");
  const snapshot = structuredClone(state);
  const committed = chooseCpu(
    snapshot.cpu,
    snapshot.player,
    snapshot.history.length,
    rng,
  );
  let revealed = false;
  return (playerCard) => {
    if (revealed) throw new Error("Already revealed");
    const next = resolveRound(snapshot, playerCard, committed);
    revealed = true;
    return next;
  };
}
