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
} from "./game.js?v=2026.10.02-4";
const $ = (id) => document.getElementById(id);
const RELEASE = "2026.10.02-4";
const htmlRelease = document.documentElement.dataset.release || "旧版";
const cssRelease =
  getComputedStyle(document.documentElement)
    .getPropertyValue("--release")
    .trim()
    .replaceAll('"', "") || "旧版";
$("build-version").textContent =
  htmlRelease === RELEASE && cssRelease === RELEASE
    ? `読込版 ${RELEASE}（HTML・JS・CSS一致）`
    : `版の不一致：HTML ${htmlRelease} / JS ${RELEASE} / CSS ${cssRelease}`;

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
  $("crown-record").hidden = campaign.clears === 0;
  $("crown-record").textContent = `♛ 五人制覇 ${campaign.clears}回`;
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
const activeVoices = new Set();
function silence() {
  for (const oscillator of activeVoices) {
    try {
      oscillator.stop();
    } catch {}
  }
  activeVoices.clear();
}
function tone(
  frequency,
  duration,
  delay = 0,
  type = "sine",
  gain = 0.07,
  endFrequency = frequency,
  attack = 0.012,
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
  volume.gain.linearRampToValueAtTime(gain, start + attack);
  volume.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(volume);
  volume.connect(audio.destination);
  activeVoices.add(oscillator);
  oscillator.onended = () => {
    activeVoices.delete(oscillator);
    oscillator.disconnect();
    volume.disconnect();
  };
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}
function cue(kind) {
  if (kind === "champion") {
    // One finale replaces both normal victory and the perfect-match cue.
    [392, 523, 659, 784, 1046].forEach((n, i) =>
      tone(n, 0.32, i * 0.115, "triangle", 0.045),
    );
    [523, 659, 784].forEach((n) => tone(n, 0.55, 0.58, "sine", 0.025));
  }
  if (kind === "select") {
    tone(520, 0.09);
    tone(780, 0.08, 0.04);
  }
  if (kind === "charge") {
    [160, 220, 330].forEach((n, i) => tone(n, 0.18, i * 0.12, "triangle"));
  }
  if (kind === "victory" || kind === "perfect") {
    const notes =
      kind === "perfect" ? [392, 494, 784, 1175] : [392, 494, 587, 784];
    notes.forEach((n, i) => tone(n, 0.5, i * 0.11, "sine", 0.055));
  }
  if (kind === "draw" || kind === "mirror") {
    // A level, unresolved pair; mirror adds a quiet echo, not a victory fanfare.
    [440, 622].forEach((n) => tone(n, 0.26, 0, "sine", 0.04));
    if (kind === "mirror")
      [440, 622].forEach((n) => tone(n, 0.2, 0.3, "sine", 0.025));
  }
  if (kind === "defeat")
    [220, 165, 110].forEach((n, i) =>
      tone(n, 0.25, i * 0.11, "triangle", 0.055),
    );
}
function roundCue(round) {
  if (!round.result) {
    // Fast attack and inharmonic partials make a short metal collision.
    // Combined peak gain stays below the old impact's 0.23; no volume boost.
    tone(170, 0.085, 0, "triangle", 0.055, 80, 0.002);
    [1450, 2183, 3311].forEach((n, i) =>
      tone(n, 0.11 + i * 0.02, 0, "sine", 0.035 - i * 0.006, n * 0.91, 0.001),
    );
    return;
  }
  const won = round.result > 0;
  // The player's outcome comes first, before the winning card's texture.
  if (won) {
    tone(660, 0.1, 0, "sine", 0.065);
    tone(880, 0.12, 0.065, "sine", 0.055);
  } else {
    tone(220, 0.12, 0, "triangle", 0.07, 150, 0.004);
    tone(130, 0.15, 0.065, "triangle", 0.06, 65, 0.004);
  }
  const n = won ? round.playerCard : round.cpuCard;
  let voice = 0;
  const texture = (
    frequency,
    duration,
    delay = 0,
    type = "sine",
    gain = 0.035,
    end = frequency,
  ) => {
    // CPU textures retain card rhythm but descend in a darker register.
    const low = (280 + n * 11) / (1 + voice++ * 0.18);
    tone(
      won ? frequency : low,
      duration,
      0.16 + delay,
      won ? type : "triangle",
      gain * (won ? 1 : 0.85),
      won ? end : low * 0.7,
      0.003,
    );
  };
  if (n === 1) {
    texture(1200, 0.12, 0, "sawtooth", 0.035, 120);
    texture(100, 0.15, 0.06, "triangle", 0.07, 45);
  }
  if (n === 2) {
    texture(950, 0.08, 0, "sawtooth", 0.03, 220);
    texture(1400, 0.11, 0.08, "sawtooth", 0.03, 180);
  }
  if (n === 3) {
    texture(75, 0.16, 0, "triangle", 0.07, 40);
    [487, 733, 1097].forEach((f) => texture(f, 0.17, 0.01, "sine", 0.025));
  }
  if (n === 4) [523, 659, 1046].forEach((f, i) => texture(f, 0.17, i * 0.035));
  if (n === 5) {
    texture(98, 0.17, 0, "triangle", 0.06);
    [392, 494, 587, 784].forEach((f, i) =>
      texture(f, 0.15, 0.025 + i * 0.025, "triangle", 0.025),
    );
  }
  if (round.reversal) {
    // A second blade marks the exception. CPU reversal never gets bright chimes.
    texture(1600, 0.12, 0.09, "sawtooth", 0.025, 130);
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
  } else if (audio) {
    silence();
    audio.suspend().catch(() => {});
  }
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
function showCompletion(fresh = false) {
  document.querySelector(".app").classList.add("campaign-complete");
  document.querySelector(".app").classList.remove("intro", "choosing");
  $("completion").hidden = false;
  $("opponent-name").textContent = "五人制覇 · 終幕";
  $("completion").classList.toggle("celebrate", fresh);
  $("completion-score").textContent = fresh
    ? `大将との最終戦　${state.scores[0]} 対 ${state.scores[1]}点で勝利`
    : "五人すべてに勝利した記録が残っています。";
  $("completion-count").textContent = `♛ × ${campaign.clears}`;
  $("completion-record").textContent = $("record").textContent;
  action("もう一度遊ぶ（任意）");
  $("completion-title").focus({ preventScroll: true });
}
function start() {
  $("completion").hidden = true;
  document.querySelector(".app").classList.remove("campaign-complete");
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
    tone(180, 0.18, 0, "triangle", 0.05, round.result > 0 ? 540 : 70);
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
  roundCue(round);
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
    // Let the final round audio finish even when visual motion is reduced.
    await wait(reduced.matches ? 300 : 550);
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
    cue(
      campaign.completed
        ? "champion"
        : sweep === "perfect"
          ? "perfect"
          : sweep === "mirror"
            ? "mirror"
            : result > 0
              ? "victory"
              : result < 0
                ? "defeat"
                : "draw",
    );
    if (result !== 0) burst(result > 0, result > 0);
    action(
      campaign.completed
        ? "もう一度遊ぶ（任意）"
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
  if (campaign.completed) showCompletion(true);
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
  showCompletion();
} else {
  start();
  $("rules").showModal();
  $("rules").scrollTop = 0;
}
