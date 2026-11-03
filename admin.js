// Council admin: only Luke's account can change anything (enforced by the
// database's row-level security, not just by this page).
const ADMIN = "lukemaf@gmail.com";
const DEPTS = { art: "Art", world: "World", animation: "Animation", audio: "Audio", monsters: "Monsters", combat: "Combat", loot: "Loot", story: "Story", ui: "Menus & UI" };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayFmt = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const ago = t => { const s = (Date.now() - new Date(t).getTime()) / 1000; if (s < 3600) return Math.max(1, Math.floor(s / 60)) + " min ago"; if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago"; };
const cfg = window.COUNCIL_DB || {};
const db = window.supabase.createClient(cfg.url, cfg.key);
const S = { user: null, questions: [], votes: [], thoughts: [], likes: [], dept: "", open: {}, edit: null, form: null, busy: false };

function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); }
const isOpen = q => q.status === "open" && (!q.closes_at || new Date(q.closes_at) > new Date());
const tab = () => { const h = (location.hash || "#questions").slice(1); return ["questions", "new", "comments"].includes(h) ? h : "questions"; };
const isAdmin = () => S.user && (S.user.email || "").toLowerCase() === ADMIN;

async function load() {
  const [q, v, t, l] = await Promise.all([
    db.from("questions").select("*").order("sort"),
    db.from("votes").select("question,option"),
    db.from("thoughts").select("*").order("created_at", { ascending: false }).limit(5000),
    db.from("thought_likes").select("thought_id"),
  ]);
  if (q.error) { toast("Couldn't load questions: " + q.error.message); return; }
  S.questions = q.data; S.votes = v.data || []; S.thoughts = t.data || []; S.likes = l.data || [];
  render();
}
function results(q) {
  const c = {}; (q.options || []).forEach(o => c[o.id] = 0); let total = 0;
  for (const v of S.votes) if (v.question === q.id && v.option in c) { c[v.option]++; total++; }
  let top = null; for (const o of q.options || []) if (c[o.id] > 0 && (!top || c[o.id] > c[top.id])) top = o;
  return { c, total, top };
}

// ---------------------------------------------------------------- render
function render() {
  const keep = {}; document.querySelectorAll("#view textarea, #view input[type=text], #view input[type=date], #view select").forEach(el => { if (el.id) keep[el.id] = el.value; });
  $("#whoami").innerHTML = S.user ? `${esc(S.user.email)} · <button class="btn sm ghost" id="signout">Sign out</button>` : "";
  $("#atabs").hidden = !isAdmin();
  const v = $("#view");
  if (!S.user) { v.innerHTML = signIn(); return; }
  if (!isAdmin()) { v.innerHTML = `<div class="empty"><h2>This account can't manage the council</h2><p class="muted">You're signed in as ${esc(S.user.email)}. Only the game lead's account can make changes.</p><button class="btn" id="signout2">Sign out</button></div>`; return; }
  const t = tab();
  document.querySelectorAll("#atabs a").forEach(a => a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  $("#c-com").textContent = S.thoughts.length || "";
  v.innerHTML = t === "new" ? qForm(S.form || blank()) : t === "comments" ? comments() : questionsView();
  for (const id in keep) { const el = document.getElementById(id); if (el && id !== "f-dept") el.value = keep[id]; }
}

function signIn() {
  return `<form class="card signin" id="signinForm">
    <h2>Sign in</h2>
    <p class="muted">Enter your email and we'll send you a sign-in link. Open it on this device. Only the game lead's account can make changes.</p>
    <div class="field"><label class="label" for="si-email">Email</label><input type="text" id="si-email" inputmode="email" autocomplete="email" required></div>
    <button class="btn primary" type="submit">Email me a sign-in link</button>
  </form>`;
}

function questionsView() {
  const d = S.dept;
  let h = `<div class="filters"><button data-dept="" aria-pressed="${!d}">All</button>${Object.entries(DEPTS).map(([k, n]) => `<button data-dept="${k}" style="--dc:var(--d-${k})" aria-pressed="${d === k}">${n}</button>`).join("")}</div>`;
  const qs = S.questions.filter(q => !d || q.dept === d).sort((a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || (a.sort ?? 0) - (b.sort ?? 0));
  if (!qs.length) return h + `<div class="empty"><h2>No questions here</h2><a class="btn primary" href="#new">Post a question</a></div>`;
  return h + `<div class="list">` + qs.map(adminCard).join("") + `</div>`;
}

function adminCard(q) {
  const { c, total, top } = results(q); const open = isOpen(q);
  const nThoughts = S.thoughts.filter(t => t.question === q.id).length;
  const panel = S.open[q.id] || "";
  const status = open ? `Open · closes ${q.closes_at ? dayFmt(q.closes_at) : "never"}` : (q.status === "open" ? `Deadline passed ${dayFmt(q.closes_at)}` : "Closed");
  return `<article class="adm-q" style="--dc:var(--d-${q.dept})">
    <div class="meta"><span class="chip" style="--dc:var(--d-${q.dept})">${esc(DEPTS[q.dept] || q.dept)}</span><span class="pill ${open ? "open" : q.built && q.built.text ? "plan" : ""}">${q.built && q.built.text ? "Built" : esc(status)}</span><span class="small muted"><span class="mono">${total}</span> votes · ${nThoughts} comments</span></div>
    <h2>${esc(q.text)}</h2>
    ${(q.options || []).length ? `<div class="res">${q.options.map(o => { const n = c[o.id] || 0, p = total ? Math.round(100 * n / total) : 0; return `<div class="r ${top && top.id === o.id ? "win" : ""}"><span>${esc(o.label)}</span><span class="mono small" style="text-align:right">${n} · ${p}%</span><span class="bar"><i style="width:${p}%"></i></span></div>`; }).join("")}</div>` : `<p class="small muted">Open question (no choices)</p>`}
    ${q.plan ? `<div class="plan"><span class="label">Plan</span><p>${esc(q.plan)}</p></div>` : ""}
    ${q.built && q.built.text ? `<div class="plan"><span class="label">Built ${q.built.at ? dayFmt(q.built.at) : ""}</span>${q.built.image ? `<img src="${esc(q.built.image)}" alt="" style="max-height:200px;border-radius:6px;width:auto">` : ""}<p>${esc(q.built.text)}</p></div>` : ""}
    <div class="acts">
      <button class="btn sm" data-a="edit" data-q="${q.id}">Edit</button>
      ${open ? `<button class="btn sm" data-a="close" data-q="${q.id}">Close now</button><button class="btn sm ghost" data-a="extend" data-q="${q.id}">+7 days</button>` : `<button class="btn sm" data-a="reopen" data-q="${q.id}">Reopen for 7 days</button>`}
      <button class="btn sm" data-a="panel" data-p="plan" data-q="${q.id}">${q.plan ? "Edit plan" : "Write plan"}</button>
      <button class="btn sm ${q.built && q.built.text ? "" : "primary"}" data-a="panel" data-p="built" data-q="${q.id}">${q.built && q.built.text ? "Edit what was built" : "Mark as built"}</button>
      <a class="btn sm ghost" href="#comments" data-a="cfor" data-q="${q.id}">Comments</a>
      <button class="btn sm ghost" data-a="del" data-q="${q.id}">Delete</button>
    </div>
    ${panel === "plan" ? `<div class="sub"><label class="label" for="plan-${q.id}">What we'll build (shown on the question)</label><textarea id="plan-${q.id}">${esc(q.plan || "")}</textarea><div class="acts"><button class="btn sm primary" data-a="savePlan" data-q="${q.id}">Save plan</button><button class="btn sm ghost" data-a="panel" data-p="" data-q="${q.id}">Cancel</button></div></div>` : ""}
    ${panel === "built" ? `<div class="sub"><p class="small muted">This shows on the public "Built" tab next to the winning answer${top ? ` (“${esc(top.label)}”)` : ""}.</p>
      <label class="label" for="built-${q.id}">What it became in the game</label><textarea id="built-${q.id}" placeholder="The Hollow Stag now haunts The Grave Groves: it charges through trees…">${esc((q.built && q.built.text) || "")}</textarea>
      <label class="label" for="bimg-${q.id}">Picture (optional)</label><input type="file" id="bimg-${q.id}" accept="image/*">
      <div class="acts"><button class="btn sm primary" data-a="saveBuilt" data-q="${q.id}">Save</button>${q.built && q.built.text ? `<button class="btn sm ghost" data-a="clearBuilt" data-q="${q.id}">Remove from Built</button>` : ""}<button class="btn sm ghost" data-a="panel" data-p="" data-q="${q.id}">Cancel</button></div></div>` : ""}
  </article>`;
}

function blank() { return { id: "", dept: S.dept || "art", text: "", detail: "", days: "14", options: [{ id: "o0", label: "", image: "" }, { id: "o1", label: "", image: "" }, { id: "o2", label: "", image: "" }] }; }
function qForm(f) {
  return `<form class="card" id="qForm">
    <h2>${f.id ? "Edit question" : "New question"}</h2>
    <div class="field"><label class="label" for="f-dept">Category</label><select id="f-dept">${Object.entries(DEPTS).map(([k, n]) => `<option value="${k}" ${k === f.dept ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="field"><label class="label" for="f-text">Question</label><input type="text" id="f-text" maxlength="160" required value="${esc(f.text)}"></div>
    <div class="field"><label class="label" for="f-detail">Context (optional): what the game has now</label><textarea id="f-detail" maxlength="800">${esc(f.detail)}</textarea></div>
    <div class="field"><label class="label" for="f-days">Deadline</label><select id="f-days">${[["3", "3 days"], ["7", "1 week"], ["14", "2 weeks"], ["30", "1 month"], ["0", "No deadline"], ["keep", "Keep current deadline"]].filter(o => f.id || o[0] !== "keep").map(o => `<option value="${o[0]}" ${String(f.days) === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select></div>
    <div class="field"><span class="label">Choices (leave all empty for an open question)</span>
      ${f.options.map((o, i) => `<div class="optedit"><input type="text" id="f-o${i}" maxlength="80" placeholder="Choice ${i + 1}" value="${esc(o.label)}" aria-label="Choice ${i + 1}">
        ${o.image ? `<img src="${esc(o.image)}" alt="">` : `<span></span>`}<input type="file" id="f-oi${i}" accept="image/*" aria-label="Picture for choice ${i + 1}" style="max-width:200px"></div>`).join("")}
      ${f.options.length < 6 ? `<button type="button" class="btn sm ghost" data-a="addOpt" style="justify-self:start">Add a choice</button>` : ""}
      ${f.id ? `<p class="small muted">Changing a choice's wording keeps its votes. Removing a choice removes it from the results.</p>` : ""}</div>
    <div class="acts"><button class="btn primary" type="submit">${f.id ? "Save changes" : "Post question"}</button><button class="btn ghost" type="button" data-a="cancelForm">Cancel</button></div>
  </form>`;
}

function comments() {
  const only = S.commentsFor;
  const likeN = {}; for (const l of S.likes) likeN[l.thought_id] = (likeN[l.thought_id] || 0) + 1;
  const list = S.thoughts.filter(t => !only || t.question === only);
  const qText = id => (S.questions.find(q => q.id === id) || {}).text || id;
  let h = only ? `<p class="small" style="margin-bottom:10px">Showing comments on “${esc(qText(only))}” · <button class="btn sm ghost" data-a="allComments">Show all</button></p>` : `<p class="status-line" style="margin-bottom:10px">Newest first. Hidden comments disappear from the public page but stay here.</p>`;
  if (!list.length) return h + `<div class="empty"><h2>No comments yet</h2></div>`;
  return h + list.map(t => `<div class="cm ${t.hidden ? "hid" : ""}"><span class="small muted">${esc(qText(t.question))} · ${ago(t.created_at)} · ▲ ${likeN[t.id] || 0}${t.hidden ? " · hidden" : ""}</span><p>${esc(t.body)}</p>
    <div class="acts"><button class="btn sm" data-a="${t.hidden ? "unhide" : "hide"}" data-t="${t.id}">${t.hidden ? "Show again" : "Hide"}</button><button class="btn sm ghost" data-a="delc" data-t="${t.id}">Delete</button></div></div>`).join("");
}

// ---------------------------------------------------------------- actions
async function upd(id, patch, msg) {
  const r = await db.from("questions").update(patch).eq("id", id).select();
  if (r.error || !r.data || !r.data.length) { toast("That didn't save" + (r.error ? ": " + r.error.message : ". Are you signed in as the game lead?")); return false; }
  toast(msg || "Saved."); await load(); return true;
}
async function upload(file) {
  const path = `${Date.now().toString(36)}-${file.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
  const r = await db.storage.from("council").upload(path, file, { cacheControl: "31536000", upsert: false });
  if (r.error) { toast("Picture didn't upload: " + r.error.message); return ""; }
  return db.storage.from("council").getPublicUrl(path).data.publicUrl;
}
function readForm() {
  const f = S.form || blank();
  return { ...f, dept: $("#f-dept").value, text: $("#f-text").value, detail: $("#f-detail").value, days: $("#f-days").value,
    options: f.options.map((o, i) => ({ ...o, label: ($("#f-o" + i) || {}).value || "" })) };
}

document.addEventListener("click", async ev => {
  if (ev.target.id === "signout" || ev.target.id === "signout2") { await db.auth.signOut(); S.user = null; render(); return; }
  const fb = ev.target.closest("[data-dept]"); if (fb) { S.dept = fb.dataset.dept; render(); return; }
  const b = ev.target.closest("[data-a]"); if (!b) return;
  const a = b.dataset.a, q = S.questions.find(x => x.id === b.dataset.q);
  if (a === "addOpt") { S.form = readForm(); S.form.options.push({ id: "o" + Date.now().toString(36), label: "", image: "" }); render(); return; }
  if (a === "cancelForm") { S.form = null; location.hash = "#questions"; render(); return; }
  if (a === "allComments") { S.commentsFor = null; render(); return; }
  if (a === "hide" || a === "unhide") { const r = await db.from("thoughts").update({ hidden: a === "hide" }).eq("id", +b.dataset.t); if (r.error) toast(r.error.message); else { toast(a === "hide" ? "Hidden from the public page." : "Visible again."); load(); } return; }
  if (a === "delc") { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Press again to delete"; return; } const r = await db.from("thoughts").delete().eq("id", +b.dataset.t); if (r.error) toast(r.error.message); else { toast("Comment deleted."); load(); } return; }
  if (!q) return;
  if (a === "cfor") { S.commentsFor = q.id; return; }
  if (a === "panel") { S.open[q.id] = b.dataset.p; render(); return; }
  if (a === "edit") {
    S.form = { id: q.id, dept: q.dept, text: q.text, detail: q.detail || "", days: "keep", options: (q.options || []).map(o => ({ ...o })) };
    while (S.form.options.length < 2) S.form.options.push({ id: "o" + Date.now().toString(36) + S.form.options.length, label: "", image: "" });
    location.hash = "#new"; render(); window.scrollTo(0, 0); return;
  }
  if (a === "close") return upd(q.id, { status: "closed", closes_at: new Date().toISOString() }, "Closed. Voting has stopped.");
  if (a === "extend") return upd(q.id, { closes_at: new Date(Math.max(Date.now(), new Date(q.closes_at || Date.now()).getTime()) + 7 * 86400000).toISOString() }, "Deadline moved back a week.");
  if (a === "reopen") return upd(q.id, { status: "open", closes_at: new Date(Date.now() + 7 * 86400000).toISOString() }, "Reopened for 7 days.");
  if (a === "savePlan") { if (await upd(q.id, { plan: $("#plan-" + q.id).value.trim() }, "Plan saved.")) S.open[q.id] = ""; render(); return; }
  if (a === "saveBuilt") {
    const text = $("#built-" + q.id).value.trim(); if (!text) return toast("Write what it became first.");
    b.disabled = true; const file = $("#bimg-" + q.id).files[0];
    const image = file ? await upload(file) : ((q.built && q.built.image) || "");
    if (await upd(q.id, { built: { text, image, at: (q.built && q.built.at) || new Date().toISOString() }, status: "closed" }, "It's on the Built tab now.")) S.open[q.id] = "";
    render(); return;
  }
  if (a === "clearBuilt") { await upd(q.id, { built: null }, "Removed from the Built tab."); return; }
  if (a === "del") {
    if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Press again to delete it and its votes"; return; }
    await db.from("votes").delete().eq("question", q.id);
    const r = await db.from("questions").delete().eq("id", q.id).select();
    if (r.error || !r.data.length) toast("Couldn't delete it."); else { toast("Question deleted."); load(); }
  }
});

document.addEventListener("submit", async ev => {
  ev.preventDefault();
  if (ev.target.id === "signinForm") {
    const email = $("#si-email").value.trim();
    const r = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    if (r.error) toast("Couldn't send the link: " + r.error.message); else { $("#view").innerHTML = `<div class="empty"><h2>Check your email</h2><p class="muted">We sent a sign-in link to ${esc(email)}. Open it on this device and you'll land back here, signed in.</p></div>`; }
    return;
  }
  if (ev.target.id !== "qForm" || S.busy) return;
  const f = readForm(); const btn = ev.target.querySelector("button[type=submit]");
  if (!f.text.trim()) return toast("Write the question first.");
  S.busy = true; btn.disabled = true; btn.textContent = "Saving…";
  const options = [];
  for (let i = 0; i < f.options.length; i++) {
    const o = f.options[i]; if (!o.label.trim()) continue;
    const file = ($("#f-oi" + i) || {}).files?.[0];
    options.push({ id: o.id || "o" + i, label: o.label.trim().slice(0, 80), image: file ? await upload(file) : (o.image || "") });
  }
  const row = { dept: f.dept, text: f.text.trim(), detail: f.detail.trim(), options };
  if (f.days !== "keep") row.closes_at = f.days === "0" ? null : new Date(Date.now() + (+f.days) * 86400000).toISOString();
  let r;
  if (f.id) r = await db.from("questions").update(row).eq("id", f.id).select();
  else r = await db.from("questions").insert({ ...row, id: f.dept + "-" + Date.now().toString(36), status: "open", sort: Math.max(0, ...S.questions.map(q => q.sort || 0)) + 1 }).select();
  S.busy = false; btn.disabled = false; btn.textContent = f.id ? "Save changes" : "Post question";
  if (r.error || !r.data || !r.data.length) return toast("That didn't save" + (r.error ? ": " + r.error.message : "."));
  toast(f.id ? "Question updated." : "Question posted. It's live on the council."); S.form = null; S.dept = f.dept; location.hash = "#questions"; await load();
});

window.addEventListener("hashchange", () => { if (tab() === "new" && !S.form) S.form = blank(); render(); });
db.auth.onAuthStateChange((_e, session) => { const was = S.user && S.user.id; S.user = session ? session.user : null; if ((S.user && S.user.id) !== was) { render(); if (isAdmin()) load(); } });
(async () => { const { data } = await db.auth.getSession(); S.user = data.session ? data.session.user : null; render(); if (isAdmin()) load(); })();
