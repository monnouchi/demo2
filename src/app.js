import {
  CARDS,
  STAKES,
  initialState,
  prepareRound,
  matchResult,
  matchSummary,
  sweepKind,
  OPPONENTS,
  initialCampaign,
  readCampaign,
  finishCampaignMatch,
  nextCircuit,
} from "./game.js";
const $ = (id) => document.getElementById(id);
const names = { 1: "刺客", 2: "双刃", 3: "騎士", 4: "女王", 5: "王冠" };
const marks = { 1: "✧", 2: "Ⅱ", 3: "♞", 4: "✥", 5: "♛" };
let campaign = initialCampaign();
try {
  campaign = readCampaign(localStorage.getItem("last-trump-campaign"));
} catch {}
let matchStage = campaign.stage;
function saveCampaign() {
  try {
    localStorage.setItem("last-trump-campaign", JSON.stringify(campaign));
  } catch {}
}
function renderCampaign() {
  $("opponent-name").textContent =
    `対戦相手 ${matchStage + 1}/5：${OPPONENTS[matchStage].name}`;
  $("opponent-name").title = OPPONENTS[matchStage].strategy;
  $("opponent-guide").textContent =
    `${OPPONENTS[matchStage].name}：${OPPONENTS[matchStage].strategy}`;
  $("record").textContent =
    `通算${campaign.wins + campaign.losses + campaign.draws}試合 · ${campaign.wins}勝 ${campaign.losses}敗 ${campaign.draws}分`;
}
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let state,
  reveal,
  selected = null,
  phase,
  selectedAt = 0,
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
function tone(
  frequency,
  duration,
  delay = 0,
  type = "sine",
  gain = 0.07,
  endFrequency = frequency,
) {
  if (!soundOn || !audio || audio.state !== "running") return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(
    endFrequency,
    start + duration,
  );
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
  if (kind === "reverse") {
    tone(1600, 0.14, 0, "sawtooth", 0.05, 130);
    tone(85, 0.38, 0.06, "triangle", 0.16, 38);
    [660, 990, 1320].forEach((n, i) =>
      tone(n, 0.32, 0.1 + i * 0.045, "sine", 0.045),
    );
  }
  if (kind === "victory")
    [392, 494, 587, 784].forEach((n, i) => tone(n, 0.65, i * 0.13));
  if (kind === "draw") [392, 523].forEach((n) => tone(n, 0.5));
  if (kind === "defeat")
    [330, 294, 220].forEach((n, i) => tone(n, 0.4, i * 0.15));
}
function cardCue(n) {
  if (n === 1) {
    tone(1200, 0.16, 0, "sawtooth", 0.04, 120);
    tone(100, 0.22, 0.07, "triangle", 0.1, 45);
  }
  if (n === 2) {
    tone(950, 0.1, 0, "sawtooth", 0.045, 220);
    tone(1400, 0.14, 0.11, "sawtooth", 0.045, 180);
  }
  if (n === 3) {
    tone(75, 0.25, 0, "triangle", 0.14, 40);
    [487, 733, 1097].forEach((n) => tone(n, 0.3, 0.015, "sine", 0.035));
  }
  if (n === 4)
    [523, 659, 1046].forEach((n, i) => tone(n, 0.42, i * 0.055, "sine", 0.055));
  if (n === 5) {
    tone(98, 0.3, 0, "triangle", 0.1);
    [392, 494, 587, 784].forEach((n, i) =>
      tone(n, 0.4, 0.04 + i * 0.04, "triangle", 0.04),
    );
  }
}
function cardEffect(round) {
  const n = round.result > 0 ? round.playerCard : round.cpuCard;
  const effect = $("card-effect");
  effect.className = `card-effect card-${n} ${round.result > 0 ? "effect-player" : "effect-cpu"} ${round.reversal ? "assassination" : ""}`;
  if (reduced.matches || round.result === 0) {
    effect.replaceChildren();
    return;
  }
  effect.innerHTML = `<span class="effect-symbol">${marks[n]}</span><i class="strike strike-one"></i><i class="strike strike-two"></i><i class="shock-ring"></i><i class="regal-rays"></i>`;
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
    `<span>${label}</span><span aria-hidden="true">→</span>`;
  $("action").disabled = disabled;
}
function setStage(id, n, extra = "") {
  const el = $(id);
  el.className = `stage-card ${n ? "face" : "back"} ${extra}`;
  el.innerHTML = n ? face(n) : back;
}
function renderPublic() {
  document.querySelector(".locked").textContent = "薄い札は使用済み";
  $("player-score").textContent = state.scores[0];
  $("cpu-score").textContent = state.scores[1];
  $("cpu-hand").innerHTML = CARDS.map(
    (n) =>
      `<span class="mini-card ${state.cpu.includes(n) ? "" : "used"}" aria-label="${n}${state.cpu.includes(n) ? " 未使用" : " 使用済み"}">${n}<small>${marks[n]}</small></span>`,
  ).join("");
  $("hand-count").textContent = `${state.player.length} CARDS`;
  $("round-track").innerHTML = STAKES.map(
    (points, i) =>
      `<span class="${i === (phase === "choose" ? state.history.length : state.history.length - 1) ? "current" : ""} ${i < state.history.length ? "complete" : ""}"><i></i>${points}点</span>`,
  ).join("");
  $("history").innerHTML = STAKES.map((_, i) => {
    const r = state.history[i];
    return `<li class="${r ? (r.result > 0 ? "won" : r.result < 0 ? "lost" : "tied") : ""}"><small>${String(i + 1).padStart(2, "0")}</small><span>${r ? `${r.playerCard} <em>/</em> ${r.cpuCard}` : "—"}</span><b>${r ? (r.result > 0 ? `+${r.points}点` : r.result < 0 ? `CPU+${r.points}` : "同札") : "未公開"}</b></li>`;
  }).join("");
}
function renderHand() {
  const finished = phase === "finished";
  $("hand-title").textContent = finished ? "合計点の内訳" : "あなたの手札";
  $("hand-count").textContent = finished
    ? ""
    : state.history.length === 0
      ? ""
      : `${state.player.length} CARDS`;
  if (finished) {
    const { counts } = matchSummary(state);
    const sums = [1, -1].map(
      (result) =>
        state.history
          .filter((r) => r.result === result)
          .map((r) => r.points)
          .join(" + ") || "0",
    );
    $("hand-hint").textContent = "勝ち数ではなく合計点";
    $("hand").innerHTML =
      `<div class="recap"><div class="recap-score">あなた <strong>${state.scores[0]}点</strong><span>対</span>CPU <strong>${state.scores[1]}点</strong></div><p>あなた ${sums[0]} = ${state.scores[0]}点 ／ CPU ${sums[1]} = ${state.scores[1]}点</p><small>参考：${counts[0]}勝 ${counts[1]}敗 ${counts[2]}分</small></div>`;
    $("history-title").textContent = "各ラウンドの得点";
    $("history-key").textContent = "あなた / CPU";
    $("history").classList.add("score-history");
    $("history").innerHTML = state.history
      .map(
        (r, i) =>
          `<li class="${r.result > 0 ? "won" : r.result < 0 ? "lost" : "tied"}"><small>${i + 1}R・${r.points}点</small><span>${r.result > 0 ? r.points : 0} <em>/</em> ${r.result < 0 ? r.points : 0}</span><b>${r.result > 0 ? "あなた得点" : r.result < 0 ? "CPU得点" : "双方0点"}</b></li>`,
      )
      .join("");
    return;
  }
  $("hand-hint").textContent =
    phase === "choose"
      ? state.player.length === 1
        ? "最後の一枚を選択"
        : selected !== null
          ? "同じ札をもう一度タップ ↓"
          : "タップで選択"
      : phase === "between"
        ? "下のボタンで次のラウンドへ ↓"
        : "公開中 · 操作ロック";
  $("hand").innerHTML = CARDS.map(
    (n) =>
      `<button class="playing-card ${state.player.includes(n) ? "" : "used"} ${selected === n ? "selected" : ""}" data-card="${n}" aria-label="${n} ${names[n]}${n === 1 ? "、5に勝つ" : ""}${!state.player.includes(n) ? " 使用済み" : ""}${selected === n ? "、選択中。もう一度タップで勝負" : ""}" aria-pressed="${selected === n}" ${phase !== "choose" || !state.player.includes(n) ? "disabled" : ""}>${face(n)}${selected === n ? '<span class="confirm-note">もう一度<br>タップで勝負</span>' : ""}${n === 1 ? '<span class="special-note">5に勝つ</span>' : ""}</button>`,
  ).join("");
  $("hand")
    .querySelectorAll("button")
    .forEach(
      (button) =>
        (button.onclick = () => {
          if (phase !== "choose") return;
          const tapped = Number(button.dataset.card);
          if (selected === tapped) {
            // Ignore a double-tap / duplicate click from the selection gesture.
            if (performance.now() - selectedAt >= 450) battle();
            return;
          }
          selected = tapped;
          selectedAt = performance.now();
          audioReady();
          cue("select");
          renderHand();
          $("hand")
            .querySelector(`[data-card="${selected}"]`)
            .focus({ preventScroll: true });
          setStage("player-stage", null, "chosen");
          action(`この札で勝負 · ${names[selected]} ${selected}`);
          message(
            "② 選んだ札をもう一度タップ",
            `選択済み：${names[selected]} ${selected}`,
            "同じ札をもう一度タップで勝負。別の札なら選び直し。",
          );
        }),
    );
}
function beginRound() {
  selected = null;
  reveal = prepareRound(state, Math.random, matchStage); // CPU commitment occurs before player input becomes available.
  phase = "choose";
  document.querySelector(".app").classList.add("choosing");
  document
    .querySelector(".app")
    .classList.toggle("intro", state.history.length === 0);
  $("history-title").textContent = "公開された札";
  $("history-key").textContent = "あなた / CPU";
  $("history").classList.remove("score-history");
  $("arena").className = "arena";
  $("player-label").textContent = "YOU";
  $("cpu-label").textContent = "CPU";
  document.querySelector(".message").removeAttribute("data-result");
  $("impact").textContent = "";
  $("fx").replaceChildren();
  $("card-effect").replaceChildren();
  $("card-effect").className = "card-effect";
  setStage("player-stage", null);
  setStage("cpu-stage", null);
  $("round-label").textContent = `ラウンド ${state.history.length + 1} / 5`;
  $("stake").textContent =
    `${STAKES[state.history.length]} POINT${STAKES[state.history.length] > 1 ? "S" : ""}`;
  message(
    `第${state.history.length + 1}ラウンド / 5 · 勝つと${STAKES[state.history.length]}点`,
    "下のカードを1枚タップ。",
    "選んだ札をもう一度タップすると勝負します。",
  );
  renderPublic();
  renderHand();
  action("一枚選んでください", true);
  if (state.history.length === 4) {
    selected = state.player[0];
    battle();
  }
}
function start() {
  if (campaign.completed) {
    campaign = nextCircuit(campaign);
    saveCampaign();
  }
  matchStage = campaign.stage;
  renderCampaign();
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
    p.style.background = reversal ? "#b97812" : win ? "#168357" : "#c83f61";
    fragment.append(p);
  }
  $("fx").replaceChildren(fragment);
}
async function battle() {
  if (phase !== "choose" || selected === null) return;
  phase = "animating";
  document.querySelector(".app").classList.remove("intro", "choosing");
  audioReady();
  renderHand();
  action("公開中…", true);
  $("help").disabled = true;
  const next = reveal(selected);
  const round = next.history.at(-1);
  message(
    state.history.length === 4 ? "第5ラウンド · 自動決着" : "両者の札を確定",
    state.history.length === 4
      ? "残った1枚で決着します。"
      : "同時に公開します。",
    state.history.length === 4
      ? "両者とも残り1枚なので、選択は不要です。"
      : "結果が出るまでお待ちください。",
  );
  $("arena").classList.add("charging");
  cue("charge");
  await wait(reduced.matches ? 150 : 600);
  $("arena").classList.remove("charging");
  setStage("player-stage", round.playerCard, "revealing");
  setStage("cpu-stage", round.cpuCard, "revealing");
  await wait(reduced.matches ? 100 : 280);
  if (round.reversal && !reduced.matches) {
    $("arena").classList.add("reversal-hold");
    tone(180, 0.18, 0, "triangle", 0.07, 540);
    await wait(200);
    $("arena").classList.remove("reversal-hold");
  }
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
  if (round.reversal) cue("reverse");
  else if (round.result)
    cardCue(round.result > 0 ? round.playerCard : round.cpuCard);
  else cue("impact");
  cardEffect(round);
  if (round.result) burst(round.reversal, round.result > 0);
  if (round.reversal && !reduced.matches) await wait(100);
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
    `第${state.history.length}ラウンドの結果`,
    round.result === 0
      ? "同じ札なので、双方0点。"
      : `${round.result > 0 ? "あなた" : "CPU"}が${round.points}点を獲得。`,
    round.reversal
      ? "1は5に勝ちます。"
      : round.result === 0
        ? "得点の持ち越しはありません。"
        : `${Math.max(round.playerCard, round.cpuCard)}が${Math.min(round.playerCard, round.cpuCard)}に勝ちました。`,
  );
  await wait(reduced.matches ? 150 : 620);
  if (state.history.length === 5) {
    await wait(reduced.matches ? 150 : 550);
    const result = matchResult(state);
    const sweep = sweepKind(state);
    phase = "finished";
    campaign = finishCampaignMatch(campaign, result);
    saveCampaign();
    renderCampaign();
    $("arena").classList.add(
      "finished",
      result > 0 ? "match-win" : result < 0 ? "match-loss" : "match-draw",
    );
    document.querySelector(".message").dataset.result =
      result > 0 ? "win" : result < 0 ? "loss" : "draw";
    if (sweep) $("arena").classList.add(`sweep-${sweep}`);
    $("impact").textContent =
      sweep === "perfect"
        ? "完全勝利"
        : sweep === "swept"
          ? "全敗・再挑戦へ"
          : sweep === "mirror"
            ? "鏡合わせ"
            : result > 0
              ? "YOU WIN"
              : result < 0
                ? "CPU WINS"
                : "DRAW";
    message(
      campaign.completed
        ? "5人勝ち抜き達成"
        : `${OPPONENTS[matchStage].name}との試合結果`,
      `${state.scores[0]} 対 ${state.scores[1]}点 ─ ${result > 0 ? "あなたの勝利" : result < 0 ? "CPUの勝利" : "引き分け"}`,
      campaign.completed
        ? "大将に勝利。5人全員に勝ちました。"
        : result > 0
          ? `次は${OPPONENTS[campaign.stage].name}との5ラウンドです。`
          : `${OPPONENTS[matchStage].name}から再挑戦できます。`,
    );
    cue(result > 0 ? "victory" : result < 0 ? "defeat" : "draw");
    if (sweep === "perfect") tone(1175, 0.7, 0.24, "sine", 0.05);
    if (sweep === "mirror") {
      tone(659, 0.45, 0.16, "sine", 0.04);
      tone(523, 0.45, 0.32, "sine", 0.04);
    }
    if (result !== 0) burst(result > 0, result > 0);
    action(
      campaign.completed
        ? "先鋒からもう一周する"
        : result > 0
          ? `次の相手・${OPPONENTS[campaign.stage].name}に挑む`
          : `${OPPONENTS[matchStage].name}に再挑戦する`,
    );
  } else {
    phase = "between";
    action(
      state.history.length === 4
        ? "残り1枚で最終決着を見る"
        : `第${state.history.length + 1}ラウンドを始める`,
    );
    if (state.history.length === 4)
      $("message-detail").textContent =
        "次は残り1枚同士。ボタンで自動決着へ進みます。";
  }
  renderHand();
  $("help").disabled = false;
}
$("action").onclick = () => {
  if (phase === "choose") battle();
  else if (phase === "between") beginRound();
  else if (phase === "finished" || phase === "completed") {
    $("hand").hidden = false;
    start();
  }
};
$("help").onclick = () => {
  $("ready").innerHTML = "閉じて戻る <span>→</span>";
  $("rules").showModal();
  $("rules").scrollTop = 0;
};
$("close-rules").onclick = $("ready").onclick = () => $("rules").close();
document.addEventListener("visibilitychange", () => {
  if (document.hidden && audio) audio.suspend().catch(() => {});
  else if (soundOn && audio) audio.resume().catch(() => {});
});
updateSound();
if (campaign.completed) {
  renderCampaign();
  phase = "completed";
  document.querySelector(".app").classList.add("intro");
  message(
    "5人勝ち抜き達成",
    "前回、大将に勝利しました。",
    "通算戦績を引き継いで、先鋒からもう一周できます。",
  );
  $("hand").hidden = true;
  action("先鋒からもう一周する");
} else start();
$("rules").showModal();
$("rules").scrollTop = 0;
