// 縦型AIアニメ制作 Web UI
const $ = (sel, root = document) => root.querySelector(sel);
const CUTS = 6;
let characters = [];

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2500);
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `エラー（${res.status}）`);
  return data;
}

// ---------- タブ ----------
document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.tab));
  })
);

// ---------- 1. キャラクター ----------
const form = $("#char-form");
const drop = $("#drop");
const fileInput = form.elements.image;

function showPreview(file) {
  const img = $("#drop-preview");
  if (file) {
    img.src = URL.createObjectURL(file);
    img.hidden = false;
    $("#drop-text").hidden = true;
  }
}
fileInput.addEventListener("change", () => showPreview(fileInput.files[0]));
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
  showPreview(file);
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
  const img = $("#drop-preview");
  img.src = `/files/characters/${c.image}`;
  img.hidden = false;
  $("#drop-text").hidden = true;
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
  if (!characters.length) {
    list.innerHTML = '<p class="empty">まだキャラクターが登録されていません。</p>';
  }
  for (const c of characters) {
    const card = document.createElement("div");
    card.className = "char-card card";
    card.innerHTML = `<img alt=""><div class="name"></div><div class="prompt"></div>
      <div class="row"><button class="edit">編集</button><button class="danger del">削除</button></div>`;
    $("img", card).src = `/files/characters/${c.image}`;
    $(".name", card).textContent = c.name;
    $(".prompt", card).textContent = c.prompt || "（プロンプト未入力）";
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
    $(".cut-id", node).textContent = `C${String(i + 1).padStart(2, "0")}`;
    wrap.append(node);
  }
}

// 各カットの「出るキャラ」と「話す人」の選択肢を、登録済みキャラに合わせて作り直す
function refreshCutCharacters() {
  document.querySelectorAll(".cut").forEach((cut) => {
    const selected = new Set([...cut.querySelectorAll(".chip input:checked")].map((i) => i.value));
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
      box.addEventListener("change", () => chip.classList.toggle("on", box.checked));
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
  document.querySelectorAll(".cut").forEach((cut, i) => {
    const c = data.cuts[i] || {};
    $(".dialogue", cut).value = c.dialogue || "";
    $(".image_prompt", cut).value = c.image_prompt || "";
    $(".motion_prompt", cut).value = c.motion_prompt || "";
    cut.querySelectorAll(".chip input").forEach((box) => {
      box.checked = (c.characters || []).includes(box.value);
      box.closest(".chip").classList.toggle("on", box.checked);
    });
    $(".speaker", cut).value = characters.some((ch) => ch.id === c.speaker) ? c.speaker : "";
  });
}

function collectEpisode() {
  return {
    title: $("#ep-title").value,
    cuts: [...document.querySelectorAll(".cut")].map((cut) => ({
      dialogue: $(".dialogue", cut).value,
      speaker: $(".speaker", cut).value,
      image_prompt: $(".image_prompt", cut).value,
      motion_prompt: $(".motion_prompt", cut).value,
      characters: [...cut.querySelectorAll(".chip input:checked")].map((b) => b.value),
    })),
  };
}

function epNumber() {
  return Math.max(1, Math.min(999, parseInt($("#ep-number").value, 10) || 1));
}

async function loadEpisode() {
  try {
    fillEpisode(await api(`/api/episodes/${epNumber()}`));
    $("#ep-status").textContent = `第${epNumber()}話を読み込みました`;
    dirty = false;
  } catch (err) {
    toast(err.message);
  }
}

async function saveEpisode() {
  try {
    const res = await api(`/api/episodes/${epNumber()}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(collectEpisode()),
    });
    $("#ep-status").textContent = `保存しました（${res.path}）`;
    toast("保存しました");
    dirty = false;
  } catch (err) {
    toast(err.message);
  }
}

let dirty = false;
$("#cuts").addEventListener("input", () => (dirty = true));
$("#ep-title").addEventListener("input", () => (dirty = true));
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
$("#ep-load").addEventListener("click", loadEpisode);
$("#ep-save").addEventListener("click", saveEpisode);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s" && $("#episode").classList.contains("active")) {
    e.preventDefault();
    saveEpisode();
  }
});

// ---------- 起動 ----------
buildCuts();
loadCharacters().then(loadEpisode);
