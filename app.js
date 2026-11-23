/* unshortly — expande enlaces acortados vía /api/unshorten.
   La página solo orquesta: pegar -> expandir -> mostrar destino. */

const $ = (id) => document.getElementById(id);
let busy = false;

/* ---------- detección ---------- */

const KNOWN = /(bit\.ly|adf\.ly|j\.gs|q\.gs|ay\.gy|tinyurl|cutt\.|t\.co\/|linkvertise|link-to\.net|ouo\.|is\.gd|v\.gd|s\.id|rb\.gy|exe\.io|b23\.tv|shorturl|rebrand|bc\.vc|shrink|za\.|uii\.io|fc-lc|fc\.lc|work\.ink|sub2unlock|boost\.ink|loot-?link|cuty|cty\.io|adfoc|soo\.gd|u\.to|lmy\.de|clck\.ru|tiny\.cc|t\.ly|dub\.|short\.gy|gg\.gg|bitly|tiny\.one|isgd|vurl)/i;

function detectService(url) {
  const det = $("detected");
  if (!url) { det.classList.add("hidden"); return; }
  det.classList.remove("hidden");
  if (KNOWN.test(url)) {
    det.textContent = "Acortador detectado";
    det.style.color = "";
  } else if (/^https?:\/\//i.test(url)) {
    det.textContent = "Enlace válido — seguiré las redirecciones";
    det.style.color = "";
  } else {
    det.textContent = "No parece un enlace válido";
    det.style.color = "var(--err)";
  }
}

/* ---------- UI helpers ---------- */

function showStatus() { $("status").classList.remove("hidden"); $("status").innerHTML = ""; }
function step(text) {
  const div = document.createElement("div");
  div.className = "step";
  div.innerHTML = '<span class="spin"></span><span></span>';
  div.querySelector("span:last-child").textContent = text;
  $("status").appendChild(div);
  return div;
}
function setStep(el, text, state) {
  el.className = "step " + state;
  el.textContent = text;
}
function clearResult() { $("result").classList.add("hidden"); }

function showResult(final, hops, interstitial) {
  const r = $("result");
  r.classList.remove("hidden");
  r.innerHTML = interstitial
    ? '<div class="rcheck" style="background:var(--err);box-shadow:0 8px 24px -6px rgba(248,113,113,.5)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>'
    : '<div class="rcheck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>';

  if (hops && hops.length > 1) {
    const chain = document.createElement("div");
    chain.className = "chain";
    chain.textContent = hops.join("  →  ");
    r.appendChild(chain);
  }

  const f = document.createElement("div");
  f.className = "fname";
  f.textContent = final;

  const row = document.createElement("div");
  row.className = "row";

  const cp = document.createElement("button");
  cp.className = "dl copybtn";
  cp.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar';
  cp.addEventListener("click", () => {
    navigator.clipboard.writeText(final).then(() => {
      cp.textContent = "Copiado ✓";
      setTimeout(() => {
        cp.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar';
      }, 1600);
    });
  });

  const op = document.createElement("a");
  op.className = "dl openbtn";
  op.href = final;
  op.target = "_blank";
  op.rel = "noopener";
  op.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg> Abrir';

  const note = document.createElement("div");
  note.className = "note";
  note.textContent = interstitial
    ? "Este acortador exige captcha/espera manual — solo llegué hasta aquí."
    : "Destino real del enlace — verificado, no lo abrimos en tu navegador.";

  row.append(cp, op);
  r.append(f, row, note);
}

/* ---------- historial (solo en memoria) ---------- */

const historyItems = [];
function pushHistory(url, final) {
  historyItems.unshift({ url, final, t: Date.now() });
  historyItems.length = Math.min(historyItems.length, 15);
  renderHistory();
}
function renderHistory() {
  const sec = $("historysec"), ul = $("history");
  if (!historyItems.length) { sec.classList.add("hidden"); return; }
  sec.classList.remove("hidden");
  ul.innerHTML = "";
  historyItems.forEach((x) => {
    const li = document.createElement("li");
    li.textContent = x.final;
    li.title = x.url;
    ul.appendChild(li);
  });
}

/* ---------- flujo ---------- */

async function run() {
  if (busy) return;
  const url = $("url").value.trim();
  if (!url || !/^https?:\/\//i.test(url)) { $("url").focus(); return; }

  busy = true;
  $("go").disabled = true;
  $("go").classList.add("loading");
  const goLabel = $("go").querySelector("span");
  goLabel.textContent = "Destapando…";
  clearResult();
  showStatus();

  try {
    const st = step("Siguiendo el enlace…");
    const r = await fetch(`/api/unshorten?u=${encodeURIComponent(url)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "error " + r.status);

    if (j.interstitial) {
      setStep(st, `Muro en ${j.via}: pide captcha/espera manual`, "err");
      showResult(j.final, j.hops, true);
    } else if (j.final === url) {
      setStep(st, "El enlace ya era directo", "done");
      showResult(j.final, j.hops, false);
    } else {
      setStep(st, `Destapado → ${new URL(j.final).hostname}`, "done");
      showResult(j.final, j.hops, false);
      pushHistory(url, j.final);
    }
  } catch (e) {
    step("Error: " + e.message, "err");
  } finally {
    busy = false;
    $("go").disabled = false;
    $("go").classList.remove("loading");
    goLabel.textContent = "Destapar";
  }
}

/* ---------- wiring ---------- */

$("go").addEventListener("click", run);
$("url").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
$("url").addEventListener("input", (e) => detectService(e.target.value.trim()));
$("url").addEventListener("paste", () => setTimeout(() => detectService($("url").value.trim()), 0));
$("paste").addEventListener("click", async () => {
  try {
    $("url").value = await navigator.clipboard.readText();
    detectService($("url").value.trim());
    $("url").focus();
  } catch (e) { $("url").focus(); }
});

/* efectos de puntero — solo con ratón real */
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
if (finePointer) {
  document.querySelectorAll(".tool, .feat").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });
  const goBtn = $("go");
  goBtn.addEventListener("pointermove", (e) => {
    const r = goBtn.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    goBtn.style.transform = `translate(${dx * 0.16}px, ${dy * 0.26}px)`;
  });
  goBtn.addEventListener("pointerleave", () => { goBtn.style.transform = ""; });
  const bgEl = document.querySelector(".bg");
  addEventListener("pointermove", (e) => {
    const x = (e.clientX / innerWidth - 0.5) * 26;
    const y = (e.clientY / innerHeight - 0.5) * 20;
    bgEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, { passive: true });
}

/* placeholder rotativo */
const PH = ["Pega un bit.ly…", "Pega un adf.ly…", "Pega un linkvertise…",
            "Pega un cutt.ly…", "Pega un ouo.io…", "Pega aquí tu enlace acortado…"];
let phi = 0;
setInterval(() => {
  const inp = $("url");
  if (document.activeElement === inp || inp.value) return;
  inp.classList.add("phswap");
  setTimeout(() => {
    phi = (phi + 1) % PH.length;
    inp.placeholder = PH[phi];
    inp.classList.remove("phswap");
  }, 420);
}, 3400);

/* features: reveal al hacer scroll */
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}), { threshold: 0.2 });
document.querySelectorAll(".feat").forEach((f, i) => {
  f.classList.add("pre");
  f.style.transitionDelay = `${i * 70}ms`;
  io.observe(f);
});

renderHistory();
