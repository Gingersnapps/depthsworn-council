// Depthsworn Council: public voting page. Questions come from questions.js;
// votes and thoughts are stored in Supabase (one vote per browser, no login).
const DEPTS = { art: "Art", world: "World", animation: "Animation", audio: "Audio", monsters: "Monsters", combat: "Combat", loot: "Loot", story: "Story", ui: "Menus & UI" };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = t => { if (!t) return ""; const s = (Date.now() - new Date(t).getTime()) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago"; if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago"; };
const QS = (window.COUNCIL_QUESTIONS || []).filter(q => DEPTS[q.dept]);

function deviceId() {
  try { let d = localStorage.getItem("council-device"); if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, ""); localStorage.setItem("council-device", d); } return d; }
  catch (e) { return (window.__dev = window.__dev || String(Math.random()).slice(2) + String(Date.now())); }
}
const ME = deviceId();
const S = { votes: [], thoughts: [], loaded: false, offline: false };
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
function tab() { const h = (location.hash || "#art").slice(1); return DEPTS[h] ? h : "art"; }
function counts(q) {
  const c = {}; (q.options || []).forEach(o => c[o.id] = 0); let total = 0, mine;
  for (const v of S.votes) if (v.question === q.id) { if (v.option in c) { c[v.option]++; total++; } if (v.device === ME) mine = v.option; }
  const thoughts = S.thoughts.filter(t => t.question === q.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { c, total, mine, thoughts };
}

function render() {
  const keep = {}; let focus = null;
  document.querySelectorAll("#view textarea").forEach(el => { keep[el.id] = el.value; if (el === document.activeElement) focus = el.id; });
  const t = tab();
  document.querySelectorAll("nav.tabs a").forEach(a => a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  for (const d in DEPTS) { const el = $("#c-" + d); if (el) el.textContent = QS.filter(q => q.dept === d && q.status === "open").length || ""; }
  const qs = QS.filter(q => q.dept === t).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1));
  let h = "";
  if (!db) h += `<p class="status-line" style="margin-bottom:12px">Voting isn't connected yet. You can read the questions; answers open soon.</p>`;
  else if (S.offline) h += `<p class="status-line" style="margin-bottom:12px">Can't reach the council right now. Results may be out of date.</p>`;
  if (!qs.length) h += `<div class="empty"><h2>No ${DEPTS[t]} questions yet</h2><p class="muted">Check the other tabs, or come back soon.</p></div>`;
  h += `<div class="list">` + qs.map(card).join("") + `</div>`;
  $("#view").innerHTML = h;
  for (const id in keep) { const el = document.getElementById(id); if (el) { el.value = keep[id]; if (id === focus) el.focus(); } }
}

function card(q) {
  const { c, total, mine, thoughts } = counts(q);
  const open = q.status === "open"; const show = mine || !open;
  const choices = (q.options || []).length ? `<div class="choices">${q.options.map(o => { const n = c[o.id] || 0, pct = total ? Math.round(100 * n / total) : 0;
    return `<button class="choice ${mine === o.id ? "mine" : ""}" data-q="${esc(q.id)}" data-o="${esc(o.id)}" ${open && db ? "" : "disabled"}>
      <span class="top"><span>${esc(o.label)}</span>${show ? `<span class="mono small">${pct}%</span>` : ""}</span>
      ${show ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ""}</button>`; }).join("")}</div>` : "";
  return `<article class="q" style="--dc:var(--d-${q.dept})">
    <div class="meta"><span class="pill ${open ? "open" : q.plan ? "plan" : ""}">${open ? "Open" : q.plan ? "Being built" : "Closed"}</span><span class="small muted"><span class="mono">${total}</span> answered${thoughts.length ? ` · ${thoughts.length} thoughts` : ""}${open && !mine && (q.options || []).length ? " · results show after you answer" : ""}</span></div>
    <h2>${esc(q.text)}</h2>
    ${q.detail ? `<p class="muted">${esc(q.detail)}</p>` : ""}
    ${choices}
    ${open && db ? `<form class="answer" data-q="${esc(q.id)}"><textarea id="t-${esc(q.id)}" aria-label="Your thoughts" maxlength="1000" placeholder="${(q.options || []).length ? "Why? Or an idea none of these cover…" : "Your answer…"}"></textarea><button class="btn" type="submit">Send</button></form>` : ""}
    ${thoughts.length ? `<details class="thoughts" ${!open ? "open" : ""}><summary>What people said (${thoughts.length})</summary>${thoughts.map(x => `<div class="thought"><span class="small muted">${x.device === ME ? "You · " : ""}${ago(x.created_at)}</span><p>${esc(x.body)}</p></div>`).join("")}</details>` : ""}
    ${q.plan ? `<div class="plan"><span class="label">What we'll build</span><p>${esc(q.plan)}</p></div>` : ""}
  </article>`;
}

async function load() {
  if (!db) { S.loaded = true; return render(); }
  try {
    const [v, t] = await Promise.all([db.from("votes").select("question,device,option"), db.from("thoughts").select("id,question,device,body,created_at").order("created_at", { ascending: false }).limit(2000)]);
    if (v.error || t.error) throw v.error || t.error;
    S.votes = v.data; S.thoughts = t.data; S.offline = false;
  } catch (e) { S.offline = true; }
  S.loaded = true; render();
}

document.addEventListener("click", async ev => {
  const b = ev.target.closest(".choice"); if (!b || !db) return;
  if (!acked()) return showBrief();
  const q = b.dataset.q, o = b.dataset.o;
  const prev = S.votes.find(v => v.question === q && v.device === ME);
  if (prev) prev.option = o; else S.votes.push({ question: q, device: ME, option: o });
  render();
  const r = await db.from("votes").upsert({ question: q, device: ME, option: o }, { onConflict: "question,device" });
  if (r.error) { toast("Your answer didn't save. Try again."); load(); } else toast("Answer saved.");
});
document.addEventListener("submit", async ev => {
  ev.preventDefault(); const f = ev.target; if (!f.classList.contains("answer") || !db) return;
  if (!acked()) return showBrief();
  const ta = f.querySelector("textarea"); const body = ta.value.trim().slice(0, 1000); if (!body) return;
  const btn = f.querySelector("button"); btn.disabled = true;
  const r = await db.from("thoughts").insert({ question: f.dataset.q, device: ME, body });
  btn.disabled = false;
  if (r.error) return toast("That didn't send. Try again.");
  ta.value = ""; toast("Thanks, your thoughts are in."); load();
});
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
render(); load();
if (!acked()) showBrief();
setInterval(() => { if (!document.hidden) load(); }, 20000);
