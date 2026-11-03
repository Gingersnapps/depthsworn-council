// Depthsworn Council: public voting page. Questions, votes, thoughts and likes
// live in Supabase (no login; one vote per browser). questions.js is only a
// fallback if the database can't be reached.
const DEPTS = { art: "Art", world: "World", animation: "Animation", audio: "Audio", monsters: "Monsters", combat: "Combat", loot: "Loot", story: "Story", ui: "Menus & UI" };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = t => { if (!t) return ""; const s = (Date.now() - new Date(t).getTime()) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago"; if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago"; };
const dayFmt = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
function left(t) {
  const s = (new Date(t).getTime() - Date.now()) / 1000;
  if (s <= 0) return "closed";
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min left";
  if (s < 86400) return Math.round(s / 3600) + " h left";
  const d = Math.round(s / 86400); return d + (d === 1 ? " day left" : " days left");
}

function deviceId() {
  try { let d = localStorage.getItem("council-device"); if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, ""); localStorage.setItem("council-device", d); } return d; }
  catch (e) { return (window.__dev = window.__dev || String(Math.random()).slice(2) + String(Date.now())); }
}
const ME = deviceId();
const S = { questions: [], votes: [], thoughts: [], likes: [], loaded: false, offline: false };
const cfg = window.COUNCIL_DB || {};
const db = cfg.url && cfg.key && window.supabase ? window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false } }) : null;

// --- the design brief: everyone reads and acknowledges it before answering
const ACK = "council-brief-v1";
let ackMem = false;
function acked() { try { return localStorage.getItem(ACK) === "1" || ackMem; } catch (e) { return ackMem; } }
function showBrief() {
  if (document.getElementById("briefModal")) return;
  const m = document.createElement("div");
  m.className = "modal"; m.id = "briefModal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", "Design brief");
  m.innerHTML = `<div class="sheet"><div class="bar2"><b>Read this first</b><span class="small muted">Scroll to the bottom to continue</span></div><iframe src="brief.html?embed=1" title="Depthsworn design brief"></iframe></div>`;
  document.body.appendChild(m); document.body.classList.add("locked");
}
function hideBrief() { const m = document.getElementById("briefModal"); if (m) m.remove(); document.body.classList.remove("locked"); }
window.addEventListener("message", ev => {
  if (ev.origin !== location.origin || !ev.data || ev.data.type !== "brief-ack") return;
  ackMem = true; try { localStorage.setItem(ACK, "1"); } catch (e) {}
  hideBrief(); toast("Welcome to the council.");
});

function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function tab() { const h = (location.hash || "#art").slice(1); return DEPTS[h] || h === "built" ? h : "art"; }
const isOpen = q => q.status === "open" && (!q.closes_at || new Date(q.closes_at) > new Date());

function counts(q) {
  const c = {}; (q.options || []).forEach(o => c[o.id] = 0); let total = 0, mine;
  for (const v of S.votes) if (v.question === q.id) { if (v.option in c) { c[v.option]++; total++; } if (v.device === ME) mine = v.option; }
  const likeN = {}, myLikes = new Set();
  for (const l of S.likes) { likeN[l.thought_id] = (likeN[l.thought_id] || 0) + 1; if (l.device === ME) myLikes.add(l.thought_id); }
  const thoughts = S.thoughts.filter(t => t.question === q.id).map(t => ({ ...t, likes: likeN[t.id] || 0, liked: myLikes.has(t.id) }))
    .sort((a, b) => b.likes - a.likes || new Date(b.created_at) - new Date(a.created_at));
  let top = null; for (const o of q.options || []) if (c[o.id] > 0 && (!top || c[o.id] > c[top.id])) top = o;
  return { c, total, mine, thoughts, top };
}

function render() {
  const keep = {}; let focus = null;
  document.querySelectorAll("#view textarea").forEach(el => { keep[el.id] = el.value; if (el === document.activeElement) focus = el.id; });
  const t = tab();
  document.querySelectorAll("nav.tabs a").forEach(a => a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  for (const d in DEPTS) { const el = $("#c-" + d); if (el) el.textContent = S.questions.filter(q => q.dept === d && isOpen(q)).length || ""; }
  const cb = $("#c-built"); if (cb) cb.textContent = S.questions.filter(q => q.built && q.built.text).length || "";
  let h = "";
  if (!db) h += `<p class="status-line" style="margin-bottom:12px">Voting isn't connected yet. You can read the questions; answers open soon.</p>`;
  else if (S.offline) h += `<p class="status-line" style="margin-bottom:12px">Can't reach the council right now. Results may be out of date.</p>`;
  if (!S.loaded) { $("#view").innerHTML = h + `<p class="status-line">Loading the council…</p>`; return; }
  if (t === "built") h += builtView();
  else {
    const qs = S.questions.filter(q => q.dept === t).sort((a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || (a.sort ?? 0) - (b.sort ?? 0));
    if (!qs.length) h += `<div class="empty"><h2>No ${DEPTS[t]} questions yet</h2><p class="muted">Check the other tabs, or come back soon.</p></div>`;
    h += `<div class="list">` + qs.map(card).join("") + `</div>`;
  }
  $("#view").innerHTML = h;
  for (const id in keep) { const el = document.getElementById(id); if (el) { el.value = keep[id]; if (id === focus) el.focus(); } }
}

function thoughtList(q, thoughts, open) {
  if (!thoughts.length) return "";
  return `<details class="thoughts" ${!open || thoughts.length <= 3 ? "open" : ""}><summary>What people said (${thoughts.length}) · best first</summary>${thoughts.map(x => `<div class="thought">
    <div class="trow"><span class="small muted">${x.device === ME ? "You · " : ""}${ago(x.created_at)}</span>
    <button class="like ${x.liked ? "on" : ""}" data-like="${x.id}" aria-pressed="${x.liked}" aria-label="${x.liked ? "Remove your upvote" : "Upvote this comment"}" ${db ? "" : "disabled"}>▲ <span class="mono">${x.likes}</span></button></div>
    <p>${esc(x.body)}</p></div>`).join("")}</details>`;
}

function card(q) {
  const { c, total, mine, thoughts } = counts(q);
  const open = isOpen(q); const show = mine || !open;
  const choices = (q.options || []).length ? `<div class="choices">${q.options.map(o => { const n = c[o.id] || 0, pct = total ? Math.round(100 * n / total) : 0;
    return `<button class="choice ${mine === o.id ? "mine" : ""}" data-q="${esc(q.id)}" data-o="${esc(o.id)}" ${open && db ? "" : "disabled"}>
      ${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy">` : ""}
      <span class="top"><span>${esc(o.label)}</span>${show ? `<span class="mono small">${pct}%</span>` : ""}</span>
      ${show ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ""}</button>`; }).join("")}</div>` : "";
  const when = q.closes_at ? (open ? `<span class="deadline ${new Date(q.closes_at) - Date.now() < 86400000 ? "soon" : ""}">${left(q.closes_at)} · closes ${dayFmt(q.closes_at)}</span>` : (new Date(q.closes_at) < new Date() ? `<span class="small muted">closed ${dayFmt(q.closes_at)}</span>` : "")) : "";
  return `<article class="q" style="--dc:var(--d-${q.dept})">
    <div class="meta"><span class="pill ${open ? "open" : q.built && q.built.text ? "plan" : ""}">${open ? "Open" : q.built && q.built.text ? "Built" : q.plan ? "Being built" : "Closed"}</span>${when}<span class="small muted"><span class="mono">${total}</span> answered${thoughts.length ? ` · ${thoughts.length} thoughts` : ""}${open && !mine && (q.options || []).length ? " · results show after you answer" : ""}</span></div>
    <h2>${esc(q.text)}</h2>
    ${q.detail ? `<p class="muted">${esc(q.detail)}</p>` : ""}
    ${choices}
    ${open && db ? `<form class="answer" data-q="${esc(q.id)}"><textarea id="t-${esc(q.id)}" aria-label="Your thoughts" maxlength="1000" placeholder="${(q.options || []).length ? "Why? Or an idea none of these cover…" : "Your answer…"}"></textarea><button class="btn" type="submit">Send</button></form>` : ""}
    ${thoughtList(q, thoughts, open)}
    ${q.plan ? `<div class="plan"><span class="label">What we'll build</span><p>${esc(q.plan)}</p></div>` : ""}
    ${q.built && q.built.text ? `<a class="small" href="#built">See what this became →</a>` : ""}
  </article>`;
}

function builtView() {
  const done = S.questions.filter(q => q.built && q.built.text).sort((a, b) => new Date(b.built.at || 0) - new Date(a.built.at || 0));
  let h = `<p class="status-line" style="margin-bottom:14px">Every vote that's made it into the game: what you chose, and what it became.</p>`;
  if (!done.length) return h + `<div class="empty"><h2>Nothing built from the votes yet</h2><p class="muted">The first questions close on ${S.questions.length ? dayFmt(S.questions.map(q => q.closes_at).filter(Boolean).sort()[0] || Date.now()) : "soon"}. When their winners are in the game, they'll show up here with pictures.</p><a class="btn" href="#art">Answer the open questions</a></div>`;
  return h + `<div class="list">` + done.map(q => { const { total, top } = counts(q);
    return `<article class="q built" style="--dc:var(--d-${q.dept})">
      <div class="meta"><span class="pill plan">Built</span><span class="small muted">${esc(DEPTS[q.dept])} · ${q.built.at ? dayFmt(q.built.at) : ""}</span></div>
      <p class="small muted">The council asked: ${esc(q.text)}</p>
      <h2>${top ? `You chose: ${esc(top.label)}` : "Your answers decided this"}</h2>
      <p class="small muted"><span class="mono">${total}</span> people answered</p>
      ${q.built.image ? `<img src="${esc(q.built.image)}" alt="What was built" loading="lazy">` : ""}
      <div class="plan"><span class="label">What it became</span><p>${esc(q.built.text)}</p></div>
    </article>`; }).join("") + `</div>`;
}

async function load() {
  if (!db) {
    S.questions = (window.COUNCIL_QUESTIONS || []).filter(q => DEPTS[q.dept]); S.loaded = true; return render();
  }
  try {
    const [q, v, t, l] = await Promise.all([
      db.from("questions").select("*").order("sort"),
      db.from("votes").select("question,device,option"),
      db.from("thoughts").select("id,question,device,body,created_at").order("created_at", { ascending: false }).limit(3000),
      db.from("thought_likes").select("thought_id,device"),
    ]);
    if (q.error || v.error || t.error || l.error) throw q.error || v.error || t.error || l.error;
    S.questions = q.data.filter(x => DEPTS[x.dept]); S.votes = v.data; S.thoughts = t.data; S.likes = l.data; S.offline = false;
  } catch (e) {
    S.offline = true;
    if (!S.questions.length) S.questions = (window.COUNCIL_QUESTIONS || []).filter(q => DEPTS[q.dept]);
  }
  S.loaded = true; render();
}

document.addEventListener("click", async ev => {
  const lk = ev.target.closest("[data-like]");
  if (lk && db) {
    if (!acked()) return showBrief();
    const id = +lk.dataset.like; const had = S.likes.some(l => l.thought_id === id && l.device === ME);
    if (had) S.likes = S.likes.filter(l => !(l.thought_id === id && l.device === ME)); else S.likes.push({ thought_id: id, device: ME });
    render();
    const r = had ? await db.from("thought_likes").delete().eq("thought_id", id).eq("device", ME) : await db.from("thought_likes").insert({ thought_id: id, device: ME });
    if (r.error) { toast("That didn't save. Try again."); load(); }
    return;
  }
  const b = ev.target.closest(".choice"); if (!b || !db) return;
  if (!acked()) return showBrief();
  const qq = S.questions.find(x => x.id === b.dataset.q); if (!qq || !isOpen(qq)) return toast("This question has closed.");
  const q = b.dataset.q, o = b.dataset.o;
  const prev = S.votes.find(v => v.question === q && v.device === ME);
  if (prev) prev.option = o; else S.votes.push({ question: q, device: ME, option: o });
  render();
  const r = await db.from("votes").upsert({ question: q, device: ME, option: o }, { onConflict: "question,device" });
  if (r.error) { toast("Your answer didn't save. The question may have just closed."); load(); } else toast("Answer saved.");
});
document.addEventListener("submit", async ev => {
  ev.preventDefault(); const f = ev.target; if (!f.classList.contains("answer") || !db) return;
  if (!acked()) return showBrief();
  const ta = f.querySelector("textarea"); const body = ta.value.trim().slice(0, 1000); if (!body) return;
  const btn = f.querySelector("button"); btn.disabled = true;
  const r = await db.from("thoughts").insert({ question: f.dataset.q, device: ME, body });
  btn.disabled = false;
  if (r.error) return toast("That didn't send. The question may have closed.");
  ta.value = ""; toast("Thanks, your thoughts are in."); load();
});
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
render(); load();
if (!acked()) showBrief();
setInterval(() => { if (!document.hidden) load(); }, 20000);
