import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const AIRTABLE_API_KEY = process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";
const AIRTABLE_POLICIES_TABLE = process.env.AIRTABLE_POLICIES_TABLE || "Policies";

function esc(v: any): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getRecordId(req: any): string {
  const q = req.query?.recordId;
  if (typeof q === "string" && q.trim()) return decodeURIComponent(q.trim());
  const match = (req.url || "").match(/[?&]recordId=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1].trim()) : "";
}

function raw(fields: any, names: string | string[]) {
  const arr = Array.isArray(names) ? names : [names];
  for (const name of arr) {
    const v = fields?.[name];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function display(v: any, fallback = "—"): string {
  if (Array.isArray(v)) return v.map((x) => x?.name || x).filter(Boolean).join(", ") || fallback;
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "object") return v.name || v.id || fallback;
  return String(v);
}

function pick(fields: any, names: string | string[], fallback = "—") {
  return display(raw(fields, names), fallback);
}

function num(v: any): number | null {
  if (Array.isArray(v)) return v.length ? num(v[0]) : null;
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace("%", "").trim());
  if (Number.isNaN(n)) return null;
  return n > 1 && n <= 100 ? n / 100 : n;
}

function pct(v: any): string {
  const n = num(v);
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function color(v: any): string {
  const n = num(v);
  if (n === null) return "#94a3b8";
  if (n >= 0.8) return "#16a34a";
  if (n >= 0.6) return "#2563eb";
  if (n >= 0.4) return "#f97316";
  return "#dc2626";
}

function riskLabel(v: any): string {
  const n = num(v);
  if (n === null) return "Not assessed";
  if (n >= 0.8) return "Low";
  if (n >= 0.6) return "Moderate";
  if (n >= 0.4) return "High";
  return "Critical";
}

async function airtableFetch(url: string) {
  if (!AIRTABLE_API_KEY) throw new Error("Missing AIRTABLE or AIRTABLE_API_KEY environment variable.");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Airtable ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function fetchPolicy(recordId: string) {
  const formula = `OR(RECORD_ID()="${recordId}",{Policy ID}="${recordId}")`;
  const params = new URLSearchParams({ filterByFormula: formula, maxRecords: "1", cellFormat: "string", timeZone: "Europe/Paris", userLocale: "en-us" });
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_POLICIES_TABLE)}?${params.toString()}`;
  const data = await airtableFetch(url);
  if (!data.records?.length) throw new Error(`No policy found for ${recordId}`);
  return data.records[0].fields || {};
}

function bar(labelText: string, value: any, sub: string) {
  const width = Math.round((num(value) ?? 0) * 100);
  return `<div class="bar-row"><div class="bar-meta"><div class="bar-label">${esc(labelText)}</div><div class="bar-sub">${esc(sub)}</div></div><div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${color(value)}"></div></div><div class="bar-value">${pct(value)}</div></div>`;
}

function kpi(title: string, value: any, sub: string) {
  return `<div class="kpi-card"><div class="kpi-title">${esc(title)}</div><div class="kpi-score" style="color:${color(value)}">${pct(value)}</div><div class="kpi-sub">${esc(sub)}</div></div>`;
}

function radarPoint(i: number, total: number, value: number, cx: number, cy: number, r: number) {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / total;
  return { x: cx + r * value * Math.cos(a), y: cy + r * value * Math.sin(a) };
}

function radar(scores: { key: string; label: string; value: any }[]) {
  const cx = 185;
  const cy = 170;
  const r = 102;
  const total = scores.length;
  const vals = scores.map(s => num(s.value) ?? 0);
  const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const rings = [0.25, 0.5, 0.75, 1].map(level => {
    const points = scores.map((_, i) => radarPoint(i, total, level, cx, cy, r)).map(p => `${p.x},${p.y}`).join(" ");
    return `<polygon points="${points}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
  }).join("");
  const axes = scores.map((_, i) => {
    const p = radarPoint(i, total, 1, cx, cy, r);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="#e5e7eb"/>`;
  }).join("");
  const shape = scores.map((s, i) => radarPoint(i, total, num(s.value) ?? 0, cx, cy, r)).map(p => `${p.x},${p.y}`).join(" ");
  const labels = scores.map((s, i) => {
    const p = radarPoint(i, total, 1.22, cx, cy, r);
    return `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="900" fill="#0f172a">${esc(s.key)}</text>`;
  }).join("");
  const dots = scores.map((s, i) => {
    const p = radarPoint(i, total, num(s.value) ?? 0, cx, cy, r);
    return `<circle cx="${p.x}" cy="${p.y}" r="6" fill="${color(s.value)}"/>`;
  }).join("");
  return `<div class="radar-wrap"><svg viewBox="0 0 370 335" class="radar-svg">${rings}${axes}<polygon points="${shape}" fill="rgba(37,99,235,.14)" stroke="#2563eb" stroke-width="3"/>${dots}${labels}<circle cx="${cx}" cy="${cy}" r="54" fill="#f8fafc" stroke="#e5e7eb"/><text x="${cx}" y="${cy - 9}" text-anchor="middle" font-size="13" fill="#64748b">Average</text><text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="34" font-weight="900" fill="${color(avg)}">${pct(avg)}</text></svg><div class="legend"><span><i class="g"></i>Strong</span><span><i class="b"></i>Moderate</span><span><i class="o"></i>Weak</span><span><i class="r"></i>Critical</span></div></div>`;
}

function demoFields() {
  return {
    "Policy Name": "National Medium-Term Development Policy Framework",
    "Policy ID": "POL-1",
    "Policy Type": "National Development Strategy",
    "Policy Role": "Anchor",
    "Primary SDG": "SDG 2",
    "Reviewer Priority": "Medium",
    "Final Policy Coherence Score": 0.79,
    "Final Policy OCI-D Score": 0.84,
    "Final Policy OCI-O Score": 0.68,
    "Policy Intrinsic OCI-D": 0.9,
    "Inherited Programme OCI-D Score": 0.75,
    "Policy Intrinsic OCI-O": 0.72,
    "Inherited Programme OCI-O Score": 0.62,
    "Inherited Programme Coherence Score": 0.74,
    "Policy Contradiction Pressure": 0.31,
    "Linked Programmes": "5",
    "Linked Actions": "23",
    "Critical Programmes": "1",
    "Weakest Governance Layer": "C4 Monitoring System",
    "Recursive Governance Exposure": 0.52,
    "Policy C1 Claim-Evidence Score": 0.9,
    "Policy C2 Claim-Evidence Score": 0.85,
    "Policy C3 Claim-Evidence Score": 0.78,
    "Policy C4 Claim-Evidence Score": 0.52,
    "Policy C5 Claim-Evidence Score": 0.68,
    "Policy C6 Claim-Evidence Score": 0.82,
    "Policy Governance Narrative": "The policy demonstrates strong strategic alignment and institutional embedding. Monitoring and response systems require further strengthening to reduce implementation risk.",
    "Strongest Governance Layers": "Strong alignment with national priorities; clear policy instruments; resource alignment across key sectors.",
    "Critical Governance Failures": "Monitoring coverage is incomplete; trigger and response mechanisms are not fully operationalised; data traceability across programmes requires improvement.",
    "Escalation Overview": "1 escalated action; 1 high-risk issue; 0 medium-risk issues."
  };
}

function build(fields: any) {
  const finalCoherence = raw(fields, ["Final Policy Coherence Score"]);
  const finalOciD = raw(fields, ["Final Policy OCI-D Score"]);
  const finalOciO = raw(fields, ["Final Policy OCI-O Score"]);
  return {
    name: pick(fields, "Policy Name", "Policy Dashboard"),
    id: pick(fields, "Policy ID", "POL-PLACEHOLDER"),
    policyType: pick(fields, "Policy Type", "Policy / Strategy"),
    policyRole: pick(fields, "Policy Role", "Anchor"),
    primarySDG: pick(fields, "Primary SDG", "SDG 2"),
    reviewPriority: pick(fields, "Reviewer Priority", "Medium"),
    finalCoherence,
    finalOciD,
    finalOciO,
    intrinsicD: raw(fields, ["Policy Intrinsic OCI-D", "Policy Intrinsic OCI-D Score"]),
    inheritedD: raw(fields, ["Inherited Programme OCI-D Score"]),
    intrinsicO: raw(fields, ["Policy Intrinsic OCI-O", "Policy Intrinsic OCI-O Score"]),
    inheritedO: raw(fields, ["Inherited Programme OCI-O Score"]),
    inheritedProgrammeSignal: raw(fields, ["Inherited Programme Coherence Score"]),
    contradictionPressure: raw(fields, ["Policy Contradiction Pressure", "Cross-Programme Contradiction Pressure"]),
    linkedPrograms: pick(fields, "Linked Programmes", "5"),
    linkedActions: pick(fields, "Linked Actions", "23"),
    criticalPrograms: pick(fields, "Critical Programmes", "1"),
    weakestComponent: pick(fields, "Weakest Governance Layer", "C4 Monitoring System"),
    recursiveRisk: raw(fields, ["Recursive Governance Exposure", "Policy C4 Claim-Evidence Score"]),
    c1: raw(fields, ["Policy C1 Claim-Evidence Score"]),
    c2: raw(fields, ["Policy C2 Claim-Evidence Score"]),
    c3: raw(fields, ["Policy C3 Claim-Evidence Score"]),
    c4: raw(fields, ["Policy C4 Claim-Evidence Score"]),
    c5: raw(fields, ["Policy C5 Claim-Evidence Score"]),
    c6: raw(fields, ["Policy C6 Claim-Evidence Score"]),
    narrative: pick(fields, ["Policy Governance Narrative", "Policy Governance Summary"], "No governance narrative available."),
    strengths: pick(fields, "Strongest Governance Layers", "No major strengths identified."),
    failures: pick(fields, "Critical Governance Failures", "No major governance failures identified."),
    escalationOverview: pick(fields, "Escalation Overview", "No escalations.")
  };
}

function html(d: any) {
  const radarScores = [
    { key: "C1", label: "Policy Alignment", value: d.c1 },
    { key: "C2", label: "Instrument Embedding", value: d.c2 },
    { key: "C3", label: "Resource Alignment", value: d.c3 },
    { key: "C4", label: "Monitoring System", value: d.c4 },
    { key: "C5", label: "Trigger & Response", value: d.c5 },
    { key: "C6", label: "Auditability", value: d.c6 }
  ];
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(d.name)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#0f172a;padding:16px}.page{max-width:1600px;margin:0 auto}.card{background:#fff;border-radius:18px;padding:18px;border:1px solid #e5e7eb;box-shadow:0 8px 24px rgba(15,23,42,.05)}.header{display:flex;justify-content:space-between;gap:18px;margin-bottom:16px}.title{font-size:20px;font-weight:900;color:#2563eb;margin-bottom:8px}.policy-name{font-size:42px;font-weight:900;line-height:1.1}.meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:12px;font-size:13px}.badge{background:#eef4ff;color:#2563eb;padding:18px 22px;border-radius:16px;font-size:20px;font-weight:900;min-width:260px}.grid6{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:16px}.kpi-card{background:#fff;border-radius:18px;border:1px solid #e5e7eb;padding:18px;text-align:center}.kpi-title{font-size:14px;font-weight:700;margin-bottom:10px}.kpi-score{font-size:40px;font-weight:900}.kpi-sub{margin-top:10px;font-size:12px;color:#64748b;font-weight:700}.grid3{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:16px;margin-bottom:16px}.section-title{font-size:22px;font-weight:900;margin-bottom:16px}.bar-row{display:grid;grid-template-columns:220px 1fr 55px;gap:14px;align-items:center;margin-bottom:16px}.bar-label{font-weight:900;font-size:15px}.bar-sub{font-size:11px;color:#64748b;margin-top:3px}.bar-track{height:12px;background:#e5e7eb;border-radius:999px;overflow:hidden}.bar-fill{height:12px;border-radius:999px}.bar-value{text-align:right;font-weight:900}.gauge{text-align:center}.gauge-score{font-size:54px;font-weight:900;margin-top:12px}.grid4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px}.small{font-size:14px;line-height:1.6}.panel{background:#f8fafc;border-radius:14px;padding:14px}.radar-wrap{text-align:center}.radar-svg{width:100%;height:355px;display:block}.legend{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;font-size:11px;color:#64748b;font-weight:800;margin-top:4px}.legend i{display:inline-block;width:9px;height:9px;border-radius:99px;margin-right:4px}.legend .g{background:#16a34a}.legend .b{background:#2563eb}.legend .o{background:#f97316}.legend .r{background:#dc2626}@media(max-width:1200px){.grid6,.grid3,.grid4{grid-template-columns:1fr}.header{flex-direction:column}}</style></head><body><div class="page"><div class="card header"><div><div class="title">Policy Dashboard</div><div class="policy-name">${esc(d.name)} <span style="font-size:16px;background:#dbeafe;color:#2563eb;border-radius:8px;padding:6px 10px">${esc(d.id)}</span></div><div class="meta"><div><b>Level:</b> National</div><div><b>Type:</b> ${esc(d.policyType)}</div><div><b>Policy Role:</b> ${esc(d.policyRole)}</div><div><b>Primary SDG:</b> ${esc(d.primarySDG)}</div></div></div><div class="badge">${esc(d.reviewPriority)} Review Priority</div></div><div class="grid6">${kpi("Policy Governance Score", d.finalCoherence, "C1-C6 recursive")}${kpi("Design Coherence", d.finalOciD, "OCI-D")}${kpi("Operational Coherence", d.finalOciO, "OCI-O")}${kpi("Linked Programs", d.linkedPrograms, "Active")}${kpi("Critical Programs", d.criticalPrograms, "Requires attention")}${kpi("Weakest Component", d.recursiveRisk, d.weakestComponent)}</div><div class="grid3"><div class="card"><div class="section-title">OCAM Component Performance</div>${radar(radarScores)}</div><div class="card"><div class="section-title">Recursive Governance Engine</div>${bar("Intrinsic Policy OCI-D", d.intrinsicD, "Claims-based design coherence")}${bar("Inherited Programme OCI-D", d.inheritedD, "Downstream design signal")}${bar("Intrinsic Policy OCI-O", d.intrinsicO, "Claims-based operational coherence")}${bar("Inherited Programme OCI-O", d.inheritedO, "Downstream operational signal")}${bar("Recursive Governance Exposure", d.recursiveRisk, "Inherited fragility")}${bar("Contradiction Pressure", d.contradictionPressure, "Cross-programme conflict density")}</div><div class="card"><div class="section-title">Policy Recursive Risk Exposure</div><div class="gauge"><div class="gauge-score" style="color:${color(d.recursiveRisk)}">${pct(d.recursiveRisk)}</div><div style="font-size:24px;font-weight:900;margin-top:6px;color:${color(d.recursiveRisk)}">${esc(riskLabel(d.recursiveRisk))} Risk</div></div><div class="panel" style="margin-top:20px"><div style="color:#dc2626;font-weight:900;margin-bottom:10px">Overall Assessment</div><div class="small">${esc(d.narrative)}</div></div></div></div><div class="grid4"><div class="card"><div class="section-title">Strategic Alignment</div><div class="small">National Strategy Alignment</div><br/><div class="small">Regional Framework Alignment</div><br/><div class="small">Global Framework Alignment</div></div><div class="card"><div class="section-title">Strongest Governance Layers</div><div class="small">${esc(d.strengths)}</div></div><div class="card"><div class="section-title">Critical Governance Failures</div><div class="small">${esc(d.failures)}</div></div><div class="card"><div class="section-title">Escalation Overview</div><div class="small">${esc(d.escalationOverview)}</div></div></div></div></body></html>`;
}

app.get("/", (_req, res) => res.redirect("/api"));

app.get("/api", async (req, res) => {
  try {
    const recordId = getRecordId(req);
    const fields = recordId ? await fetchPolicy(recordId) : demoFields();
    res.type("html").send(html(build(fields)));
  } catch (e: any) {
    res.type("html").send(html(build({ ...demoFields(), "Policy Governance Narrative": `Runtime fallback: ${e.message || String(e)}` })));
  }
});

export default app;
