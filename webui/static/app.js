// 縦型AIアニメ制作 Web UI
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const CUTS = 6;
let characters = [];
let variant = "sns";
let dirty = false;

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3000);
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `エラー（${res.status}）`);
  return data;
}

const jsonOpts = (method, body) => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

// ---------- タブ ----------
$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.tab));
    if (btn.dataset.tab === "settings") loadStatus();
  })
);

// ---------- 1. キャラクター ----------
const form = $("#char-form");
const drop = $("#drop");
const fileInput = form.elements.image;

function showPreview(src) {
  const img = $("#drop-preview");
  img.src = src;
  img.hidden = false;
  $("#drop-text").hidden = true;
}
fileInput.addEventListener("change", () => fileInput.files[0] && showPreview(URL.createObjectURL(fileInput.files[0])));
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  showPreview(URL.createObjectURL(file));
});

function resetForm() {
  form.reset();
  form.elements.id.value = "";
  $("#drop-preview").hidden = true;
  $("#drop-text").hidden = false;
  $("#char-submit").textContent = "登録する";
  $("#char-cancel").hidden = true;
}
$("#char-cancel").addEventListener("click", resetForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = form.elements.id.value;
  if (!id && !fileInput.files.length) return toast("基準画像を選んでください");
  const body = new FormData();
  body.append("name", form.elements.name.value);
  body.append("prompt", form.elements.prompt.value);
  body.append("voice_aivis", form.elements.voice_aivis.value);
  body.append("voice_fish", form.elements.voice_fish.value);
  if (fileInput.files.length) body.append("image", fileInput.files[0]);
  try {
    await api(id ? `/api/characters/${id}` : "/api/characters", { method: id ? "PUT" : "POST", body });
    toast(id ? "更新しました" : "登録しました");
    resetForm();
    await loadCharacters();
  } catch (err) {
    toast(err.message);
  }
});

function editCharacter(c) {
  form.elements.id.value = c.id;
  form.elements.name.value = c.name;
  form.elements.prompt.value = c.prompt;
  form.elements.voice_aivis.value = c.voices?.aivis || "";
  form.elements.voice_fish.value = c.voices?.fish || "";
  showPreview(`/files/characters/${c.image}`);
  $("#char-submit").textContent = "更新する";
  $("#char-cancel").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteCharacter(c) {
  if (!confirm(`「${c.name}」を削除しますか？基準画像も消えます。`)) return;
  await api(`/api/characters/${c.id}`, { method: "DELETE" });
  toast("削除しました");
  await loadCharacters();
}

async function loadCharacters() {
  characters = await api("/api/characters");
  const list = $("#char-list");
  list.replaceChildren();
  if (!characters.length) list.innerHTML = '<p class="empty">まだキャラクターが登録されていません。</p>';
  for (const c of characters) {
    const card = document.createElement("div");
    card.className = "char-card card";
    card.innerHTML = `<img alt=""><div class="name"></div><div class="prompt"></div><div class="voice"></div>
      <div class="row"><button class="edit">編集</button><button class="danger del">削除</button></div>`;
    $("img", card).src = `/files/characters/${c.image}`;
    $(".name", card).textContent = c.name;
    $(".prompt", card).textContent = c.prompt || "（プロンプト未入力）";
    const v = c.voices || {};
    $(".voice", card).textContent = `声：Aivis ${v.aivis ? "設定済み" : "未設定"}／Fish ${v.fish ? "設定済み" : "未設定"}`;
    $(".edit", card).addEventListener("click", () => editCharacter(c));
    $(".del", card).addEventListener("click", () => deleteCharacter(c));
    list.append(card);
  }
  refreshCutCharacters();
}

// ---------- 2. 6カット分の入力 ----------
function buildCuts() {
  const wrap = $("#cuts");
  const tpl = $("#cut-template");
  for (let i = 0; i < CUTS; i++) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.n = i + 1;
    $(".cut-id", node).textContent = `C${String(i + 1).padStart(2, "0")}`;
    $$(".gen", node).forEach((btn) => btn.addEventListener("click", () => generate(i + 1, btn.dataset.kind, node)));
    wrap.append(node);
  }
}

// 各カットの「出るキャラ」と「話す人」の選択肢を、登録済みキャラに合わせて作り直す
function refreshCutCharacters() {
  $$(".cut").forEach((cut) => {
    const selected = new Set($$(".chip input:checked", cut).map((i) => i.value));
    const chips = $(".cut-chars", cut);
    chips.replaceChildren();
    for (const c of characters) {
      const chip = document.createElement("label");
      chip.className = "chip";
      chip.innerHTML = `<input type="checkbox"><img alt=""><span></span>`;
      const box = $("input", chip);
      box.value = c.id;
      box.checked = selected.has(c.id);
      chip.classList.toggle("on", box.checked);
      box.addEventListener("change", () => { chip.classList.toggle("on", box.checked); dirty = true; });
      $("img", chip).src = `/files/characters/${c.image}`;
      $("span", chip).textContent = c.name;
      chips.append(chip);
    }
    const sel = $(".speaker", cut);
    const current = sel.value;
    sel.replaceChildren(new Option("ナレーション・心の声など", ""));
    for (const c of characters) sel.append(new Option(c.name, c.id));
    sel.value = characters.some((c) => c.id === current) ? current : "";
  });
}

function fillEpisode(data) {
  $("#ep-title").value = data.title || "";
  $$(".cut").forEach((cut, i) => {
    const c = data.cuts[i] || {};
    $(".dialogue", cut).value = c.dialogue || "";
    $(".image_prompt", cut).value = c.image_prompt || "";
    $(".motion_prompt", cut).value = c.motion_prompt || "";
    $(".use_prev_ref", cut).checked = !!c.use_prev_ref;
    $$(".chip input", cut).forEach((box) => {
      box.checked = (c.characters || []).includes(box.value);
      box.closest(".chip").classList.toggle("on", box.checked);
    });
    $(".speaker", cut).value = characters.some((ch) => ch.id === c.speaker) ? c.speaker : "";
  });
}

function collectEpisode() {
  return {
    title: $("#ep-title").value,
    cuts: $$(".cut").map((cut) => ({
      dialogue: $(".dialogue", cut).value,
      speaker: $(".speaker", cut).value,
      image_prompt: $(".image_prompt", cut).value,
      motion_prompt: $(".motion_prompt", cut).value,
      use_prev_ref: $(".use_prev_ref", cut).checked,
      characters: $$(".chip input:checked", cut).map((b) => b.value),
    })),
  };
}

const epNumber = () => Math.max(1, Math.min(999, parseInt($("#ep-number").value, 10) || 1));
const epUrl = (v = variant) => `/api/episodes/${epNumber()}/${v}`;
const variantName = (v = variant) => (v === "sns" ? "SNS版" : "完全版");

async function loadEpisode() {
  try {
    fillEpisode(await api(epUrl()));
    $("#ep-status").textContent = `第${epNumber()}話・${variantName()}を読み込みました`;
    dirty = false;
    await loadMedia();
  } catch (err) {
    toast(err.message);
  }
}

async function saveEpisode(quiet = false) {
  const res = await api(epUrl(), jsonOpts("PUT", collectEpisode()));
  $("#ep-status").textContent = `保存しました（${res.path}）`;
  if (!quiet) toast("保存しました");
  dirty = false;
}

async function switchVariant(v) {
  if (v === variant) return;
  if (dirty && !confirm(`${variantName()}の入力が保存されていません。保存してから切り替えますか？（キャンセルで切り替えをやめる）`)) return;
  if (dirty) await saveEpisode(true);
  variant = v;
  $$(".variant").forEach((b) => b.classList.toggle("active", b.dataset.variant === v));
  await loadEpisode();
}
$$(".variant").forEach((b) => b.addEventListener("click", () => switchVariant(b.dataset.variant)));

$("#ep-copy").addEventListener("click", async () => {
  const other = variant === "sns" ? "full" : "sns";
  if (!confirm(`今の${variantName()}の入力内容を、${variantName(other)}に上書きコピーします。よろしいですか？`)) return;
  try {
    await api(epUrl(other), jsonOpts("PUT", collectEpisode()));
    toast(`${variantName(other)}にコピーしました`);
  } catch (err) {
    toast(err.message);
  }
});

$("#cuts").addEventListener("input", () => (dirty = true));
$("#ep-title").addEventListener("input", () => (dirty = true));
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
$("#ep-load").addEventListener("click", loadEpisode);
$("#ep-save").addEventListener("click", () => saveEpisode().catch((err) => toast(err.message)));
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s" && $("#episode").classList.contains("active")) {
    e.preventDefault();
    saveEpisode().catch((err) => toast(err.message));
  }
});

// ---------- 3. カットごとの生成とプレビュー ----------
function setPreview(cut, media) {
  const img = $(".pv-image img", cut);
  const video = $(".pv-video video", cut);
  const audio = $(".pv-voice", cut);
  img.hidden = !media.image;
  if (media.image) img.src = media.image;
  video.hidden = !media.video;
  if (media.video && video.getAttribute("src") !== media.video) video.src = media.video;
  audio.hidden = !media.voice;
  if (media.voice && audio.getAttribute("src") !== media.voice) audio.src = media.voice;
  $(".gen[data-kind=video]", cut).title = media.image ? "" : "先に静止画を生成してください";
}

async function loadMedia() {
  const data = await api(`${epUrl()}/media`);
  $$(".cut").forEach((cut, i) => setPreview(cut, data.cuts[i] || {}));
  for (const v of ["sns", "full"]) {
    // 書き出し結果はどちらの版を表示中でも見られるようにする
    const res = v === variant ? data : await api(`${epUrl(v)}/media`).catch(() => ({}));
    const fig = $(`.export-results figure[data-variant=${v}]`);
    const video = $("video", fig);
    const link = $("a", fig);
    video.hidden = link.hidden = !res.export;
    if (res.export) {
      video.src = res.export;
      link.href = res.export;
    }
  }
}

async function waitJob(job, onTick) {
  while (job.status === "running") {
    await new Promise((r) => setTimeout(r, 2000));
    job = await api(`/api/jobs/${job.id}`);
    onTick?.(job);
  }
  if (job.status === "error") throw new Error(job.error);
  return job;
}

const KIND_NAME = { image: "静止画", video: "動画", voice: "音声" };

async function generate(n, kind, cut) {
  const status = $(".job-status", cut);
  const buttons = $$(".gen", cut);
  buttons.forEach((b) => (b.disabled = true));
  const started = Date.now();
  try {
    await saveEpisode(true); // 入力中の内容で生成するため、先に保存する
    status.textContent = `${KIND_NAME[kind]}を生成中…`;
    const job = await api(`${epUrl()}/cuts/${n}/${kind}`, { method: "POST" });
    const done = await waitJob(job, () => {
      status.textContent = `${KIND_NAME[kind]}を生成中…（${Math.round((Date.now() - started) / 1000)}秒）`;
    });
    status.textContent = done.message;
    await loadMedia();
  } catch (err) {
    status.textContent = `失敗：${err.message}`;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ---------- 4. 書き出し ----------
$$(".export-btn").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const v = btn.dataset.variant;
    const status = $("#export-status");
    $$(".export-btn").forEach((b) => (b.disabled = true));
    const started = Date.now();
    try {
      if (dirty && v === variant) await saveEpisode(true);
      const job = await api(`${epUrl(v)}/export`, { method: "POST" });
      status.textContent = `${variantName(v)}を書き出し中…`;
      const done = await waitJob(job, () => {
        status.textContent = `${variantName(v)}を書き出し中…（${Math.round((Date.now() - started) / 1000)}秒）`;
      });
      status.textContent = done.message;
      await loadMedia();
    } catch (err) {
      status.textContent = `失敗：${err.message}`;
    } finally {
      $$(".export-btn").forEach((b) => (b.disabled = false));
    }
  })
);

// ---------- 設定 ----------
const sform = $("#settings-form");

async function loadSettings() {
  const s = await api("/api/settings");
  sform.elements.tts_provider.value = s.tts_provider;
  sform.elements.narrator_aivis.value = s.narrator_voice.aivis || "";
  sform.elements.narrator_fish.value = s.narrator_voice.fish || "";
  sform.elements.fish_model.value = s.fish_model || "";
  sform.elements.enable_safety_checker.checked = !!s.enable_safety_checker;
  sform.elements.video_resolution.value = s.video_resolution;
  sform.elements.image_mode.value = s.image_mode || "multi";
  sform.elements.model_image_multi.value = s.models.image_multi;
  sform.elements.model_image.value = s.models.image;
  sform.elements.model_image_t2i.value = s.models.image_t2i;
  sform.elements.model_video.value = s.models.video;
  sform.elements.font_path.value = s.font_path || "";
}

sform.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/settings", jsonOpts("PUT", {
      tts_provider: sform.elements.tts_provider.value,
      narrator_voice: { aivis: sform.elements.narrator_aivis.value, fish: sform.elements.narrator_fish.value },
      fish_model: sform.elements.fish_model.value || "s2-pro",
      enable_safety_checker: sform.elements.enable_safety_checker.checked,
      video_resolution: sform.elements.video_resolution.value,
      font_path: sform.elements.font_path.value,
      image_mode: sform.elements.image_mode.value,
      models: {
        image_multi: sform.elements.model_image_multi.value,
        image: sform.elements.model_image.value,
        image_t2i: sform.elements.model_image_t2i.value,
        video: sform.elements.model_video.value,
      },
    }));
    toast("設定を保存しました");
    loadStatus();
  } catch (err) {
    toast(err.message);
  }
});

const kform = $("#keys-form");
kform.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/keys", jsonOpts("PUT", {
      FAL_KEY: kform.elements.FAL_KEY.value,
      AIVIS_API_KEY: kform.elements.AIVIS_API_KEY.value,
      FISH_API_KEY: kform.elements.FISH_API_KEY.value,
    }));
    kform.reset();
    toast("キーを保存しました");
    await loadStatus();
  } catch (err) {
    toast(err.message);
  }
});

async function loadStatus() {
  const s = await api("/api/status");
  $("#fake-banner").hidden = !s.fake_mode;
  const fake = (ok) => (!ok && s.fake_mode ? "（動作確認モードなので不要）" : "");
  const items = [
    [`fal.ai（FAL_KEY）${fake(s.fal_key)}`, s.fal_key || s.fake_mode],
    [`Aivis Cloud API（AIVIS_API_KEY）${s.tts_provider === "aivis" ? "：使用中" : ""}${fake(s.tts_keys.aivis)}`,
      s.tts_keys.aivis || s.fake_mode],
    [`Fish Audio（FISH_API_KEY）${s.tts_provider === "fish" ? "：使用中" : ""}${fake(s.tts_keys.fish)}`,
      s.tts_keys.fish || s.fake_mode],
    ["FFmpeg", s.ffmpeg],
    [`字幕フォント${s.font ? `：${s.font}` : ""}`, !!s.font],
  ];
  $("#status-list").replaceChildren(...items.map(([label, ok]) => {
    const li = document.createElement("li");
    li.className = ok ? "ok" : "ng";
    li.textContent = `${ok ? "OK" : "未設定"}　${label}`;
    return li;
  }));
}

// ---------- 起動 ----------
buildCuts();
loadStatus();
loadSettings();
loadCharacters().then(loadEpisode);
