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
export const OPPONENTS = Object.freeze([
  Object.freeze({
    name: "先鋒",
    strategy: "練習相手：5→4→2→1→3の順で出す",
    share: 0,
    temperature: 0.7,
  }),
  Object.freeze({
    name: "次鋒",
    strategy: "残り札から自由に選ぶ",
    share: 0,
    temperature: 0.7,
  }),
  Object.freeze({
    name: "中堅",
    strategy: "ときどき後半へ温存する",
    share: 0.35,
    temperature: 0.7,
  }),
  Object.freeze({
    name: "副将",
    strategy: "後半の得点も考えて選ぶ",
    share: 0.7,
    temperature: 0.7,
  }),
  Object.freeze({
    name: "大将",
    strategy: "温存を重視して選ぶ",
    share: 0.95,
    temperature: 0.35,
  }),
]);
export function cpuPolicy(own, opposing, round, level = 3) {
  if (!Number.isInteger(level) || !OPPONENTS[level])
    throw new RangeError("Invalid opponent");
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
  if (level === 0) {
    // A disclosed practice pattern, fixed independently of the player's moves.
    const next = [5, 4, 2, 1, 3].find((n) => own.includes(n));
    return own.map((n) => (n === next ? 1 : 0));
  }
  if (level === 1) return own.map(() => 1 / own.length);
  const opponent = OPPONENTS[level];
  const scores = moveValues(own, opposing, round);
  const maximum = Math.max(...scores);
  const weights = scores.map((score) =>
    Math.exp((score - maximum) / opponent.temperature),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(
    (weight) =>
      (1 - opponent.share) / own.length + (opponent.share * weight) / total,
  );
}
export function chooseCpu(own, opposing, round, rng = Math.random, level = 3) {
  const distribution = cpuPolicy(own, opposing, round, level);
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
export function prepareRound(state, rng = Math.random, level = 3) {
  if (state.history.length >= 5) throw new RangeError("Match finished");
  const snapshot = structuredClone(state);
  const committed = chooseCpu(
    snapshot.cpu,
    snapshot.player,
    snapshot.history.length,
    rng,
    level,
  );
  let revealed = false;
  return (playerCard) => {
    if (revealed) throw new Error("Already revealed");
    const next = resolveRound(snapshot, playerCard, committed);
    revealed = true;
    return next;
  };
}

/** Display a completed match without mistaking round wins for weighted points. */
export function matchSummary(state) {
  if (state.history.length !== 5) throw new RangeError("Match not finished");
  const counts = [0, 0, 0]; // Player wins, losses, equal cards.
  const lateScores = [0, 0];
  for (const [index, round] of state.history.entries()) {
    counts[round.result > 0 ? 0 : round.result < 0 ? 1 : 2]++;
    if (index >= 3 && round.result)
      lateScores[round.result > 0 ? 0 : 1] += round.points;
  }
  return { counts, lateScores };
}

export function initialCampaign() {
  return {
    version: 1,
    stage: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    clears: 0,
    completed: false,
  };
}
export function readCampaign(raw) {
  try {
    const c = JSON.parse(raw);
    if (
      !c ||
      c.version !== 1 ||
      !Number.isInteger(c.stage) ||
      c.stage < 0 ||
      c.stage > 4 ||
      typeof c.completed !== "boolean" ||
      (c.completed && c.stage !== 4)
    )
      return initialCampaign();
    for (const key of ["wins", "losses", "draws", "clears"])
      if (!Number.isSafeInteger(c[key]) || c[key] < 0 || c[key] > 100000000)
        return initialCampaign();
    if (c.wins !== c.clears * 5 + (c.completed ? 0 : c.stage))
      return initialCampaign();
    return {
      version: 1,
      stage: c.stage,
      wins: c.wins,
      losses: c.losses,
      draws: c.draws,
      clears: c.clears,
      completed: c.completed,
    };
  } catch {
    return initialCampaign();
  }
}
export function finishCampaignMatch(campaign, result) {
  if (campaign.completed || ![-1, 0, 1].includes(result))
    throw new RangeError("Invalid campaign result");
  const next = { ...campaign };
  next[result > 0 ? "wins" : result < 0 ? "losses" : "draws"]++;
  if (result > 0) {
    if (next.stage < 4) next.stage++;
    else {
      next.completed = true;
      next.clears++;
    }
  }
  return next;
}
export function nextCircuit(campaign) {
  if (!campaign.completed) throw new RangeError("Circuit not finished");
  return { ...campaign, stage: 0, completed: false };
}

export function sweepKind(state) {
  const { counts } = matchSummary(state);
  return counts[0] === 5
    ? "perfect"
    : counts[1] === 5
      ? "swept"
      : counts[2] === 5
        ? "mirror"
        : null;
}
