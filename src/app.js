import {
  CARDS,
  STAKES,
  initialState,
  prepareRound,
  matchResult,
  matchSummary,
} from "./game.js";
const $ = (id) => document.getElementById(id);
const names = { 1: "刺客", 2: "双刃", 3: "騎士", 4: "女王", 5: "王冠" };
const marks = { 1: "✧", 2: "Ⅱ", 3: "♞", 4: "✥", 5: "♛" };
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let state,
  reveal,
  selected = null,
  phase,
  audio,
  soundOn = false;
try {
  soundOn = localStorage.getItem("last-trump-sound") === "true";
} catch {
  /* Storage may be unavailable in private contexts. */
}
function face(n) {
  return `<span class="card-corner">${n}<small>${marks[n]}</small></span><span class="card-sigil">${marks[n]}</span><span class="card-name">${names[n]}</span><span class="card-bottom">${n}</span>`;
}
const back = '<div class="back-pattern"><span>✦</span></div>';
function audioReady() {
  if (!soundOn) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume().catch(() => {});
  } catch {
    /* Visual feedback stays available without audio. */
  }
}
function tone(frequency, duration, delay = 0, type = "sine", gain = 0.07) {
  if (!soundOn || !audio || audio.state !== "running") return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  volume.gain.setValueAtTime(0, start);
  volume.gain.linearRampToValueAtTime(gain, start + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(volume);
  volume.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}
function cue(kind) {
  if (kind === "select") {
    tone(520, 0.09);
    tone(780, 0.08, 0.04);
  }
  if (kind === "charge") {
    [160, 220, 330].forEach((n, i) => tone(n, 0.18, i * 0.12, "triangle"));
  }
  if (kind === "impact") {
    tone(65, 0.3, 0, "triangle", 0.16);
    tone(880, 0.3, 0.04);
  }
  if (kind === "reverse")
    [440, 660, 880, 1320].forEach((n, i) => tone(n, 0.4, i * 0.09));
  if (kind === "victory")
    [392, 494, 587, 784].forEach((n, i) => tone(n, 0.65, i * 0.13));
  if (kind === "draw") [392, 523].forEach((n) => tone(n, 0.5));
  if (kind === "defeat")
    [330, 294, 220].forEach((n, i) => tone(n, 0.4, i * 0.15));
}
function updateSound() {
  $("sound").textContent = soundOn ? "音 ON" : "音 OFF";
  $("sound").setAttribute("aria-pressed", String(soundOn));
  $("sound").setAttribute(
    "aria-label",
    `音を${soundOn ? "オフ" : "オン"}にする`,
  );
}
$("sound").onclick = () => {
  soundOn = !soundOn;
  try {
    localStorage.setItem("last-trump-sound", String(soundOn));
  } catch {}
  updateSound();
  if (soundOn) {
    audioReady();
    cue("select");
  } else if (audio) audio.suspend().catch(() => {});
};
function message(kicker, title, detail) {
  $("message-kicker").textContent = kicker;
  $("message-title").textContent = title;
  $("message-detail").textContent = detail;
}
function action(label, disabled = false) {
  $("action").innerHTML =
    `<span>${label}</span><span aria-hidden="true">↗</span>`;
  $("action").disabled = disabled;
}
function setStage(id, n, extra = "") {
  const el = $(id);
  el.className = `stage-card ${n ? "face" : "back"} ${extra}`;
  el.innerHTML = n ? face(n) : back;
}
function renderPublic() {
  document.querySelector(".locked").textContent =
    phase === "choose" ? "◆ 選択済み" : "◆ 公開済み";
  $("player-score").textContent = state.scores[0];
  $("cpu-score").textContent = state.scores[1];
  $("cpu-hand").innerHTML = CARDS.map(
    (n) =>
      `<span class="mini-card ${state.cpu.includes(n) ? "" : "used"}" aria-label="${n}${state.cpu.includes(n) ? " 未使用" : " 使用済み"}">${n}<small>${marks[n]}</small></span>`,
  ).join("");
  $("hand-count").textContent = `${state.player.length} CARDS`;
  $("round-track").innerHTML = STAKES.map(
    (points, i) =>
      `<span class="${i === (phase === "choose" ? state.history.length : state.history.length - 1) ? "current" : ""} ${i < state.history.length ? "complete" : ""}"><i></i>${points} PT</span>`,
  ).join("");
  $("history").innerHTML = STAKES.map((_, i) => {
    const r = state.history[i];
    return `<li class="${r ? (r.result > 0 ? "won" : r.result < 0 ? "lost" : "tied") : ""}"><small>${String(i + 1).padStart(2, "0")}</small><span>${r ? `${r.playerCard} <em>/</em> ${r.cpuCard}` : "—"}</span><b>${r ? (r.result > 0 ? `+${r.points}点` : r.result < 0 ? `CPU+${r.points}` : "同札") : "未公開"}</b></li>`;
  }).join("");
}
function renderHand() {
  const finished = phase === "finished";
  $("hand-title").textContent = finished ? "5戦の振り返り" : "あなたの手札";
  $("hand-count").textContent = finished
    ? "MATCH RECAP"
    : `${state.player.length} CARDS`;
  if (finished) {
    const { counts, lateScores } = matchSummary(state);
    const playerReversal = state.history.some(
      (round) => round.reversal && round.result > 0,
    );
    const cpuReversal = state.history.some(
      (round) => round.reversal && round.result < 0,
    );
    const note =
      cpuReversal && matchResult(state) < 0
        ? "次は、相手の1が残っているか読もう。"
        : playerReversal
          ? "1の一撃、決まった。次はどう切る？"
          : lateScores[0] < lateScores[1]
            ? "次は、後半の2点を狙おう。"
            : "次は、出す順を変えてみよう。";
    $("hand-hint").textContent = "合計得点で決着";
    $("hand").innerHTML =
      `<div class="recap"><div class="recap-stats">${counts.map((n, i) => `<span>${n}<small>${["勝", "敗", "分"][i]}</small></span>`).join("")}</div><p>後半の得点　YOU ${lateScores[0]} : ${lateScores[1]} CPU</p><small>${note}</small></div>`;
    return;
  }
  $("hand-hint").textContent =
    phase === "choose"
      ? state.player.length === 1
        ? "最後の一枚を選択"
        : "タップで選択"
      : phase === "between"
        ? "次の戦へ進もう"
        : "公開中 · 操作ロック";
  $("hand").innerHTML = CARDS.map(
    (n) =>
      `<button class="playing-card ${state.player.includes(n) ? "" : "used"} ${selected === n ? "selected" : ""}" data-card="${n}" aria-label="${n} ${names[n]}${n === 1 ? "、5に勝つ" : ""}${!state.player.includes(n) ? " 使用済み" : ""}" aria-pressed="${selected === n}" ${phase !== "choose" || !state.player.includes(n) ? "disabled" : ""}>${face(n)}${n === 1 ? '<span class="special-note">5に勝つ</span>' : ""}</button>`,
  ).join("");
  $("hand")
    .querySelectorAll("button")
    .forEach(
      (button) =>
        (button.onclick = () => {
          if (phase !== "choose") return;
          selected = Number(button.dataset.card);
          audioReady();
          cue("select");
          renderHand();
          $("hand")
            .querySelector(`[data-card="${selected}"]`)
            .focus({ preventScroll: true });
          setStage("player-stage", null, "chosen");
          action(`${names[selected]} ${selected} を伏せて勝負`);
          message(
            "READY TO REVEAL",
            `${names[selected]}を、切る。`,
            "別の札に変更できます。勝負で同時公開。",
          );
        }),
    );
}
function beginRound() {
  selected = null;
  reveal = prepareRound(state); // CPU commitment occurs before player input becomes available.
  phase = "choose";
  $("arena").className = "arena";
  $("player-label").textContent = "YOU";
  $("cpu-label").textContent = "CPU";
  document.querySelector(".message").removeAttribute("data-result");
  $("impact").textContent = "";
  $("fx").replaceChildren();
  setStage("player-stage", null);
  setStage("cpu-stage", null);
  $("round-label").textContent =
    `ROUND ${String(state.history.length + 1).padStart(2, "0")} / 05`;
  $("stake").textContent =
    `${STAKES[state.history.length]} POINT${STAKES[state.history.length] > 1 ? "S" : ""}`;
  message(
    state.history.length === 4
      ? "FINAL ROUND"
      : state.history.length === 3
        ? "DOUBLE STAKES"
        : "THE CHOICE IS YOURS",
    state.history.length === 4
      ? "最後の一枚で、決着。"
      : state.history.length === 3
        ? "ここから、一勝が2点。"
        : "その一枚が、流れを変える。",
    state.history.length
      ? "公開された札を見て、相手の次の一手を読む。"
      : "1は5に勝つ。切り札の使いどきを読もう。",
  );
  renderPublic();
  renderHand();
  action("一枚選んでください", true);
}
function start() {
  state = initialState();
  beginRound();
}
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
function burst(reversal, win) {
  if (reduced.matches) return;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < (reversal ? 44 : 26); i++) {
    const p = document.createElement("i");
    const angle = (Math.PI * 2 * i) / (reversal ? 44 : 26);
    const distance = 65 + Math.random() * 140;
    p.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    p.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
    p.style.setProperty("--rotation", `${i * 31}deg`);
    p.style.setProperty("--delay", `${Math.random() * 0.12}s`);
    p.style.background = reversal ? "#ffe0a0" : win ? "#9effe2" : "#ffb5b0";
    fragment.append(p);
  }
  $("fx").replaceChildren(fragment);
}
async function battle() {
  if (phase !== "choose" || selected === null) return;
  phase = "animating";
  audioReady();
  renderHand();
  action("運命の、一瞬。", true);
  $("help").disabled = true;
  const next = reveal(selected);
  const round = next.history.at(-1);
  message("LOCKED IN", "せーの。", "互いの札は、もう変えられない。");
  $("arena").classList.add("charging");
  cue("charge");
  await wait(reduced.matches ? 150 : 600);
  $("arena").classList.remove("charging");
  setStage("player-stage", round.playerCard, "revealing");
  setStage("cpu-stage", round.cpuCard, "revealing");
  await wait(reduced.matches ? 100 : 280);
  $("arena").classList.add(
    "clash",
    round.reversal
      ? "reversal"
      : round.result > 0
        ? "win"
        : round.result < 0
          ? "loss"
          : "draw",
  );
  $("impact").textContent = round.reversal
    ? "逆転"
    : round.result > 0
      ? "勝利"
      : round.result < 0
        ? "惜敗"
        : "相打ち";
  cue(round.reversal ? "reverse" : "impact");
  burst(round.reversal, round.result > 0);
  state = next;
  selected = null;
  $("player-label").textContent =
    round.result > 0 ? `YOU +${round.points}点` : "YOU";
  $("cpu-label").textContent =
    round.result < 0 ? `CPU +${round.points}点` : "CPU";
  if (round.result) {
    $(round.result > 0 ? "player-stage" : "cpu-stage").classList.add(
      "round-winner",
    );
    $(round.result > 0 ? "cpu-stage" : "player-stage").classList.add(
      "round-loser",
    );
  }
  document.querySelector(".message").dataset.result =
    round.result > 0 ? "win" : round.result < 0 ? "loss" : "draw";
  renderPublic();
  renderHand();
  message(
    round.reversal
      ? "THE CROWN FALLS"
      : round.result > 0
        ? "ROUND WON"
        : round.result < 0
          ? "ROUND LOST"
          : "DRAW",
    round.reversal
      ? round.result > 0
        ? "刺客で、王冠を奪った。"
        : "王冠を、刺客に奪われた。"
      : round.result > 0
        ? "読みが、届いた。"
        : round.result < 0
          ? "次の一手で、取り返す。"
          : "同じ読み。その先へ。",
    round.result === 0
      ? "同じ札は0点。得点の持ち越しなし。"
      : `${round.result > 0 ? "あなた" : "CPU"}に ${round.points}点。${round.reversal ? "1は5に勝つ。" : `${Math.max(round.playerCard, round.cpuCard)}が${Math.min(round.playerCard, round.cpuCard)}に勝利。`}`,
  );
  await wait(reduced.matches ? 150 : 620);
  if (state.history.length === 5) {
    await wait(reduced.matches ? 150 : 550);
    const result = matchResult(state);
    phase = "finished";
    $("arena").classList.add(
      "finished",
      result > 0 ? "match-win" : result < 0 ? "match-loss" : "match-draw",
    );
    document.querySelector(".message").dataset.result =
      result > 0 ? "win" : result < 0 ? "loss" : "draw";
    $("impact").textContent =
      result > 0 ? "YOU WIN" : result < 0 ? "CPU WINS" : "DRAW";
    message(
      "DUEL COMPLETE",
      result > 0
        ? "最後に、笑うのはあなた。"
        : result < 0
          ? "次は、その一枚で勝つ。"
          : "互角の読み合い。",
      `${state.scores[0]} 対 ${state.scores[1]} ─ ${result > 0 ? "あなたの勝利" : result < 0 ? "CPUの勝利" : "引き分け"}。`,
    );
    cue(result > 0 ? "victory" : result < 0 ? "defeat" : "draw");
    if (result !== 0) burst(result > 0, result > 0);
    action("もう一度、勝負する");
  } else {
    phase = "between";
    action(
      `第${state.history.length + 1}戦へ${state.history.length === 3 ? " · ここから2点" : ""}`,
    );
  }
  renderHand();
  $("help").disabled = false;
}
$("action").onclick = () => {
  if (phase === "choose") battle();
  else if (phase === "between") beginRound();
  else if (phase === "finished") start();
};
$("help").onclick = () => $("rules").showModal();
$("close-rules").onclick = $("ready").onclick = () => $("rules").close();
document.addEventListener("visibilitychange", () => {
  if (document.hidden && audio) audio.suspend().catch(() => {});
  else if (soundOn && audio) audio.resume().catch(() => {});
});
updateSound();
start();
