// Browser copy of backend/raah/engine.py so the planner works offline.
// Every number comes from the dataset JSON (built from raah-dataset.xlsx).
// web/tests/parity.ts checks this file and the Python engine agree.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Data = any;
export type Profile = Record<string, any>;

export type RuleStatus = "pass" | "fail" | "unknown" | "missing_doc";
export type SchemeStatus = "eligible" | "eligible_missing_docs" | "need_info" | "not_eligible";

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const threshold = (value: any, category: string) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value.by_category?.[category] ?? value.base
    : value;

const isEmpty = (v: any) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const lowerSet = (v: any) => new Set((Array.isArray(v) ? v : [v]).map((x: any) => String(x).toLowerCase()));

export function evalRule(rule: any, ctx: Profile) {
  const { field, op, value: val } = rule;
  const docs = new Set<string>(ctx.documents || []);
  const v = ctx[field];
  let status: RuleStatus = "unknown";
  if (field === "documents" && op === "has") {
    status = (val || []).every((d: string) => docs.has(d)) ? "pass" : "missing_doc";
  } else if (val === null || val === undefined) {
    status = "unknown";
  } else if (isEmpty(v)) {
    status = "unknown";
  } else if (op === "in") {
    const vals = val.map((x: any) => String(x).toLowerCase());
    const cand = typeof v === "number" && Number.isInteger(v) ? String(v) : String(v);
    status = vals.includes(cand.toLowerCase()) ? "pass" : "fail";
  } else if (op === "any") {
    const have = lowerSet(v);
    status = val.some((x: any) => have.has(String(x).toLowerCase())) ? "pass" : "fail";
  } else if (op === "has") {
    const have = lowerSet(v);
    status = val.every((x: any) => have.has(String(x).toLowerCase())) ? "pass" : "fail";
  } else if (op === "is" || op === "==") {
    const ok = typeof val === "boolean" ? Boolean(v) === val : String(v).toLowerCase() === String(val).toLowerCase();
    status = ok ? "pass" : "fail";
  } else if (["<=", "<", ">=", ">"].includes(op)) {
    const t = num(threshold(val, ctx.category));
    const x = num(v);
    if (t === null || x === null) status = "unknown";
    else {
      const ok = op === "<=" ? x <= t : op === "<" ? x < t : op === ">=" ? x >= t : x > t;
      status = ok ? "pass" : "fail";
    }
  }
  if (status === "pass" && rule.doc && !docs.has(rule.doc)) status = "missing_doc";
  return { label: rule.label, field, status, doc: rule.doc, where: rule.where };
}

export function checkScheme(scheme: any, ctx: Profile) {
  const results = scheme.rules.map((r: any) => evalRule(r, ctx));
  const st = new Set(results.map((r: any) => r.status));
  let overall: SchemeStatus;
  if (st.has("fail")) overall = "not_eligible";
  else if (st.has("unknown")) overall = "need_info";
  else if (st.has("missing_doc")) overall = "eligible_missing_docs";
  else overall = results.length ? "eligible" : "need_info";
  const missing: { doc: string; where: string }[] = [];
  for (const r of results) {
    if (r.status === "missing_doc" && r.doc && !missing.some((m) => m.doc === r.doc)) missing.push({ doc: r.doc, where: r.where });
  }
  return {
    id: scheme.id, name: scheme.name, status: overall,
    passed: results.filter((r: any) => r.status === "pass").length, total: results.length,
    rules: results, missing_docs: missing, amount_text: scheme.amount_text,
    apply_via: scheme.apply_via, source: scheme.source, last_checked: scheme.last_checked,
  };
}

const ORDER: Record<SchemeStatus, number> = { eligible: 0, eligible_missing_docs: 1, need_info: 2, not_eligible: 3 };

export function eligibility(data: Data, profile: Profile, plan?: any, hostel?: boolean) {
  const ctx: Profile = { ...profile };
  if (plan) {
    ctx.course_tags = plan.course_tags;
    if (plan.course_tags.includes("post_matric")) ctx.class = Math.max(Math.trunc(Number(ctx.class) || 0), 11);
  }
  if (hostel !== undefined) ctx.stays_in_hostel = hostel;
  const out = data.scholarships.filter((s: any) => s.rules.length).map((s: any) => checkScheme(s, ctx));
  out.sort((a: any, b: any) => ORDER[a.status as SchemeStatus] - ORDER[b.status as SchemeStatus] || b.passed / Math.max(b.total, 1) - a.passed / Math.max(a.total, 1));
  return out;
}
