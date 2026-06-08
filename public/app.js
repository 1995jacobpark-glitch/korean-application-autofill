const state = {
  profile: null,
  template: null,
  draft: null,
};

const $ = (selector) => document.querySelector(selector);

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

function setPill(selector, text, mode = "") {
  const el = $(selector);
  if (!el) return;
  el.textContent = text;
  el.className = `pill ${mode}`.trim();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = [data.error, data.detail].filter(Boolean).join("\n\n");
    throw new Error(message || "요청 실패");
  }
  return data;
}

function renderSummary(target, items) {
  const host = $(target);
  host.innerHTML = "";
  for (const [label, value] of items) {
    const div = document.createElement("div");
    div.className = "summary-item";
    div.innerHTML = "<span></span><strong></strong>";
    div.querySelector("span").textContent = label;
    div.querySelector("strong").textContent = value || "비어 있음";
    host.appendChild(div);
  }
}

function renderProfile(profile) {
  renderSummary("#profileSummary", [
    ["성명", profile.person?.nameKo],
    ["휴대폰", profile.person?.mobile],
    ["이메일", profile.person?.email],
    ["현 직장", profile.work?.company],
    ["학력", `${profile.education?.length || 0}건`],
    ["자격증", `${profile.licenses?.length || 0}건`],
  ]);
  $("#profileJson").value = JSON.stringify(profile, null, 2);
  const missing = profile.missing?.length || 0;
  setPill("#profilePill", missing ? `누락 ${missing}` : "완료", missing ? "warn" : "ok");
}

function renderTemplate(template) {
  renderSummary("#templateSummary", [
    ["문서", template.title],
    ["기관", template.agency],
    ["모집분야", template.recruitFields?.join(", ")],
    ["접수", template.deadline],
    ["이메일", template.submitEmail],
    ["서식", `${template.forms?.length || 0}개`],
  ]);
  const docs = $("#requiredDocs");
  docs.innerHTML = "";
  for (const doc of template.requiredDocuments || []) {
    const div = document.createElement("div");
    div.textContent = doc;
    docs.appendChild(div);
  }
  setPill("#templatePill", "분석 완료", "ok");
}

function valueToText(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function textToValue(text, type) {
  if (type === "checkbox") {
    return ["true", "동의", "동의함", "yes", "y"].includes(text.trim().toLowerCase());
  }
  if (type === "table") {
    try {
      return JSON.parse(text);
    } catch {
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    }
  }
  return text;
}

function updateDraftFromInputs() {
  if (!state.draft) return;
  for (const item of state.draft.values || []) {
    const valueInput = document.querySelector(`[data-id="${item.id}"]`);
    const statusInput = document.querySelector(`[data-status-for="${item.id}"]`);
    if (valueInput) item.value = textToValue(valueInput.value, valueInput.dataset.type);
    if (statusInput) item.status = statusInput.value;
  }
}

function renderDraft(draft) {
  const rows = $("#draftRows");
  rows.innerHTML = "";
  for (const item of draft.values || []) {
    const tr = document.createElement("tr");
    const valueCell = document.createElement("td");
    const useSelect = item.type === "choice" && item.options?.length;
    const input = useSelect
      ? document.createElement("select")
      : document.createElement(item.type === "text" || item.type === "date" || item.type === "checkbox" ? "input" : "textarea");

    if (useSelect) {
      for (const option of item.options) {
        const opt = document.createElement("option");
        opt.value = option;
        opt.textContent = option;
        input.appendChild(opt);
      }
      input.value = item.value || item.options[0] || "";
    } else {
      input.value = valueToText(item.value);
    }
    input.dataset.id = item.id;
    input.dataset.type = item.type;
    input.addEventListener("change", updateDraftFromInputs);
    valueCell.appendChild(input);

    const status = document.createElement("select");
    for (const option of ["confirmed", "needs_review", "empty"]) {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      status.appendChild(opt);
    }
    status.value = item.status || "needs_review";
    status.dataset.statusFor = item.id;
    status.addEventListener("change", updateDraftFromInputs);

    tr.innerHTML = `<td><strong>${item.label}</strong><br><small>${item.profileField}</small></td>`;
    tr.appendChild(valueCell);
    const statusCell = document.createElement("td");
    statusCell.appendChild(status);
    tr.appendChild(statusCell);
    const conf = document.createElement("td");
    conf.textContent = typeof item.confidence === "number" ? item.confidence.toFixed(2) : "";
    tr.appendChild(conf);
    rows.appendChild(tr);
  }
  $("#generateBtn").disabled = false;
}

async function init() {
  try {
    const health = await fetchJson("/api/health");
    setText("#systemStatus", health.hwpWorker ? `HWP worker OK · v${health.version || ""}` : "Windows HWP worker 필요");
  } catch (error) {
    setText("#systemStatus", error.message);
  }
}

async function showDiagnostics() {
  try {
    const data = await fetchJson("/api/diagnostics");
    const text = JSON.stringify(data, null, 2);
    setText("#outputMessage", text);
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setText("#systemStatus", "진단 정보 복사 완료");
    }
  } catch (error) {
    setText("#outputMessage", error.message);
  }
}

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setPill("#profilePill", "추출 중", "warn");
  try {
    const data = await fetchJson("/api/profile/extract", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    state.profile = data.profile;
    renderProfile(state.profile);
  } catch (error) {
    setPill("#profilePill", error.message, "warn");
  }
});

$("#templateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setPill("#templatePill", "분석 중", "warn");
  try {
    const data = await fetchJson("/api/template/analyze", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    state.template = data.template;
    renderTemplate(state.template);
  } catch (error) {
    setPill("#templatePill", error.message, "warn");
  }
});

$("#buildDraftBtn").addEventListener("click", async () => {
  try {
    state.profile = JSON.parse($("#profileJson").value);
    if (!state.profile || !state.template) throw new Error("프로필과 양식 분석이 필요합니다.");
    const data = await fetchJson("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: state.profile, template: state.template }),
    });
    state.draft = data.draft;
    renderDraft(state.draft);
    setText("#outputMessage", "중간값 확인 후 HWP 생성 가능");
  } catch (error) {
    setText("#outputMessage", error.message);
  }
});

$("#generateBtn").addEventListener("click", async () => {
  updateDraftFromInputs();
  $("#generateBtn").disabled = true;
  setText("#outputMessage", "HWP 생성 중");
  try {
    const data = await fetchJson("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: state.profile,
        template: state.template,
        draft: state.draft,
      }),
    });
    $("#outputMessage").innerHTML = `<a class="download-link" href="${data.downloadUrl}">${data.outputName}</a>`;
  } catch (error) {
    setText("#outputMessage", error.message);
    $("#generateBtn").disabled = false;
  }
});

$("#resetBtn").addEventListener("click", () => {
  state.profile = null;
  state.template = null;
  state.draft = null;
  $("#profileForm").reset();
  $("#templateForm").reset();
  $("#profileJson").value = "";
  $("#profileSummary").innerHTML = "";
  $("#templateSummary").innerHTML = "";
  $("#requiredDocs").innerHTML = "";
  $("#draftRows").innerHTML = '<tr><td colspan="4" class="empty">아직 생성된 중간값이 없습니다.</td></tr>';
  $("#generateBtn").disabled = true;
  setPill("#profilePill", "대기");
  setPill("#templatePill", "대기");
  setText("#outputMessage", "생성 대기");
});

$("#diagnosticBtn").addEventListener("click", showDiagnostics);

init();
