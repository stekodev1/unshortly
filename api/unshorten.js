// Vercel serverless function: expande enlaces acortados.
// GET /api/unshorten?u=<url>
// Sigue la cadena de redirecciones y, si el destino es un intermediario
// conocido (adf.ly & familia), extrae la URL real embebida en su HTML.
// No resuelve captchas interactivos — devuelve interstitial:true en ese caso.

const INTERSTITIAL = [
  "adf.ly", "j.gs", "q.gs", "ay.gy", "atominik.com", "microify.com",
  "linkvertise.com", "link-to.net", "linkvertise.download", "direct-link.net",
  "up-to-down.net", "ouo.io", "ouo.press", "bc.vc", "shrinkearn.com",
  "shrinkme.io", "exe.io", "exey.io", "fc-lc.com", "fc.lc", "uii.io",
  "za.gl", "za.bolt", "work.ink", "workink.net", "sub2unlock.com",
  "sub2unlock.net", "boost.ink", "loot-link.com", "lootlinks.com",
  "cuty.io", "cty.io", "adshrink.it", "adfoc.us", "bstlar.com",
];

// hosts/dominios que nunca deben ser destino (ads, trackers del propio acortador)
const JUNK = [
  "google.", "facebook.", "googlesyndication", "doubleclick", "adservice",
  "cdn.", "fonts.", "jquery", "cloudflare", "bootstrap", "w3.org",
  "gstatic", "googleapis", "youtube.com/embed", "schema.org",
];

function privateHost(h) {
  return (
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith(".local") || h.endsWith(".internal")
  );
}

/* adf.ly & familia: el destino va en la var `ysmm`, intercalada y base64 */
function decodeYsmm(html) {
  const m = html.match(/var ysmm = '([A-Za-z0-9+/=]+)'/);
  if (!m) return null;
  const s = m[1];
  let a = "", b = "";
  for (let i = 0; i < s.length; i++) {
    if (i % 2 === 0) a += s[i];
    else b = s[i] + b;
  }
  try {
    const dec = Buffer.from(a + b, "base64").toString("utf8").slice(2);
    const u = dec.match(/https?:\/\/[^\s"']+/);
    return u ? u[0] : null;
  } catch {
    return null;
  }
}

/* fallback genérico: primera URL externa que no sea del acortador ni basura */
function genericExtract(html, host) {
  const urls = html.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
  for (const raw of urls) {
    let h;
    try { h = new URL(raw).hostname; } catch { continue; }
    if (h === host || h.endsWith("." + host) || host.endsWith("." + h)) continue;
    if (privateHost(h)) continue;
    if (JUNK.some((j) => h.includes(j.replace(/\.$/, "")) || raw.includes(j))) continue;
    if (/\.(png|jpe?g|gif|svg|css|js|woff2?|ico)(\?|$)/i.test(raw)) continue;
    return raw;
  }
  return null;
}

function isInterstitial(h) {
  return INTERSTITIAL.some((d) => h === d || h.endsWith("." + d));
}

module.exports = async function handler(req, res) {
  const u = (req.query.u || "").toString();
  let cur;
  try {
    cur = new URL(u);
  } catch {
    return res.status(400).json({ error: "url inválida" });
  }
  if (!/^https?:$/.test(cur.protocol) || privateHost(cur.hostname)) {
    return res.status(400).json({ error: "url no permitida" });
  }

  const hops = [cur.hostname];
  let html = "";
  try {
    // seguimos redirects a mano para registrar la cadena
    for (let i = 0; i < 10; i++) {
      const r = await fetch(cur, {
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      const loc = r.headers.get("location");
      if (loc && [301, 302, 303, 307, 308].includes(r.status)) {
        cur = new URL(loc, cur).toString();
        const h = new URL(cur).hostname;
        if (privateHost(h)) return res.status(400).json({ error: "destino no permitido" });
        hops.push(h);
        continue;
      }
      // página final — leemos el HTML por si es intermediario
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("text/html")) html = await r.text();
      break;
    }
  } catch {
    return res.status(502).json({ error: "no se pudo seguir el enlace" });
  }

  const host = new URL(cur).hostname;

  // muro de cloudflare/anti-bot: la página nunca llega al destino sin navegador real
  if (/challenge-platform|_cf_chl|just a moment|checking your browser|ddos-guard|cf-browser-verification/i.test(html)) {
    return res.json({
      final: cur.toString(),
      hops,
      interstitial: true,
      via: host,
      message: "protegido por Cloudflare/captcha — pide un navegador real",
    });
  }

  if (isInterstitial(host)) {
    const real = decodeYsmm(html) || genericExtract(html, host);
    if (real) {
      let rh;
      try { rh = new URL(real).hostname; } catch { rh = ""; }
      if (rh && !privateHost(rh)) {
        return res.json({ final: real, hops, via: host });
      }
    }
    return res.json({
      final: cur.toString(),
      hops,
      interstitial: true,
      via: host,
      message: "este acortador pide pasos manuales (captcha/espera) — solo llegué hasta aquí",
    });
  }

  res.json({ final: cur.toString(), hops });
};
