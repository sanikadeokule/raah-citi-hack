// Financial aid calculator (Raah Pro): what a course really costs after scholarships, whether an education
// loan is possible and on what terms, the EMI, and how many months of the first job it takes to pay back.
//
// Scholarships and the starting salary come from the dataset (raah-dataset.xlsx) through engine.ts.
// The loan rules below are the published national rules for education loans in India; they are not in the
// spreadsheet because they are the same for every student. Each one says where it comes from.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { A, benefitValue, eligibility, incomeAt, planIncome, type Data, type Profile } from "./engine";

export const LOAN_RULES = {
  // IBA Model Educational Loan Scheme (followed by public sector banks)
  no_margin_upto: 400000, // up to ₹4 lakh: no margin money, no security
  guarantee_upto: 750000, // ₹4 to 7.5 lakh: parent as co-borrower + guarantee, no property needed (CGFSEL cover)
  margin_pct_above_4l: 5, // studies in India: 5% margin above ₹4 lakh
  collateral_margin_pct: 15, // our simplification for loans above ₹7.5 lakh, which need property as security
  moratorium_extra_months: 12, // repayment starts 1 year after the course ends
  max_tenure_years: 15,
  // Central Sector Interest Subsidy (CSIS): the government pays all interest during the course + 1 year
  csis_income_limit: 450000,
  csis_loan_cap: 1000000,
  // PM-Vidyalaxmi (Nov 2024): 3% interest subvention during the moratorium, loans up to ₹10 lakh,
  // family income up to ₹8 lakh, at quality institutions (top NIRF ranks)
  vidyalaxmi_income_limit: 800000,
  vidyalaxmi_subvention_pct: 3,
  vidyalaxmi_loan_cap: 1000000,
  // keep the EMI within this share of take-home pay
  safe_emi_share: 0.2,
  stretch_emi_share: 0.35,
};

export const LOAN_SOURCES = [
  { label: "PM-Vidyalaxmi portal (apply for all education loans and subsidies)", url: "https://pmvidyalaxmi.co.in/" },
  { label: "IBA Model Educational Loan Scheme", url: "https://www.iba.org.in/" },
];

export interface AidInput {
  fee_per_year: number;
  years: number;
  family_income: number;
  scholarship_ids: string[]; // from the dataset
  other_scholarship_per_year: number; // a scholarship the student already has that is not in the dataset
  career_id: string | null;
  rate_pct: number; // bank interest rate, per year
  tenure_years: number;
}

export function emi(principal: number, ratePct: number, months: number) {
  if (principal <= 0 || months <= 0) return 0;
  const r = ratePct / 1200;
  if (r === 0) return principal / months;
  const f = (1 + r) ** months;
  return (principal * r * f) / (f - 1);
}

/** Dataset scholarships the student qualifies for at this family income (eligible, or eligible once documents are in). */
export function matchingScholarships(data: Data, profile: Profile, familyIncome: number) {
  return eligibility(data, { ...profile, family_income_annual: familyIncome })
    .filter((e: any) => e.status === "eligible" || e.status === "eligible_missing_docs")
    .map((e: any) => data.scholarships.find((s: any) => s.id === e.id))
    .filter((s: any) => s && s.benefit?.computable);
}

/** Sensible starting values from the student's roadmap plan (fee per year and length of the course). */
export function defaultsFor(data: Data, profile: Profile, careerId: string | null) {
  const plan = careerId ? data.plans.find((p: any) => p.career_id === careerId) : null;
  const years = plan?.course_months ? Math.max(1, Math.round(plan.course_months / 12)) : 3;
  const total = plan ? plan.fees + plan.exam_fees + plan.materials : 0;
  return {
    fee_per_year: total ? Math.round(total / years / 1000) * 1000 : 60000,
    years,
    family_income: Number(profile?.family_income_annual) || 150000,
  };
}

export function computeAid(data: Data, profile: Profile, inp: AidInput) {
  const R = LOAN_RULES;
  const gender = profile?.gender || "F";
  const courseCost = Math.max(0, inp.fee_per_year) * Math.max(0, inp.years);

  // scholarships: each chosen one valued over the whole course, the same way the roadmap does
  const chosen = inp.scholarship_ids
    .map((id) => data.scholarships.find((s: any) => s.id === id))
    .filter(Boolean)
    .map((s: any) => {
      const v = benefitValue(s, gender, inp.years, courseCost);
      return { id: s.id, name: s.name, value: v.low, value_high: v.high, amount_text: s.amount_text, apply_via: s.apply_via, source: s.source };
    });
  const stack = A(data, "stack_scholarships", 0) === 1;
  const datasetAid = stack ? chosen.reduce((a, s) => a + s.value, 0) : Math.max(0, ...chosen.map((s) => s.value));
  const otherAid = Math.max(0, inp.other_scholarship_per_year) * inp.years;
  const scholarshipTotal = Math.min(courseCost, datasetAid + otherAid);
  const netCost = Math.max(0, courseCost - scholarshipTotal);

  // loan size and terms (IBA model scheme)
  const marginPct = netCost <= R.no_margin_upto ? 0 : netCost <= R.guarantee_upto ? R.margin_pct_above_4l : R.collateral_margin_pct;
  const margin = Math.round(netCost * marginPct / 100);
  const loan = netCost - margin;
  const security = netCost <= R.no_margin_upto ? "none" : netCost <= R.guarantee_upto ? "guarantee" : "collateral";
  const csis = inp.family_income <= R.csis_income_limit && loan > 0;
  const vidyalaxmi = !csis && inp.family_income <= R.vidyalaxmi_income_limit && loan > 0;

  // interest during the course + 1 year (simple interest, added to the loan when repayment starts)
  const courseMonths = Math.round(inp.years * 12);
  const moratorium = courseMonths + R.moratorium_extra_months;
  const coveredLoan = csis ? Math.min(loan, R.csis_loan_cap) : vidyalaxmi ? Math.min(loan, R.vidyalaxmi_loan_cap) : 0;
  const fullInterest = loan * inp.rate_pct / 100 * moratorium / 12;
  const subsidy = csis
    ? coveredLoan * inp.rate_pct / 100 * moratorium / 12
    : vidyalaxmi ? coveredLoan * Math.min(R.vidyalaxmi_subvention_pct, inp.rate_pct) / 100 * moratorium / 12 : 0;
  const moratoriumInterest = Math.max(0, fullInterest - subsidy);
  const principalAtStart = loan + moratoriumInterest;

  const tenureMonths = Math.round(Math.min(R.max_tenure_years, Math.max(1, inp.tenure_years)) * 12);
  const monthlyEmi = emi(principalAtStart, inp.rate_pct, tenureMonths);
  const totalRepaid = monthlyEmi * tenureMonths;

  // the first job's pay, from the dataset (with pay growth when the dataset has year 1/3/5 figures)
  const career = inp.career_id ? data.careers.find((c: any) => c.id === inp.career_id) : null;
  const plan = career ? data.plans.find((p: any) => p.career_id === career.id) : null;
  const income = career ? planIncome(data, plan || { income_override: null }, career, gender) : null;
  const salary = income ? income.median : null;
  const emiShare = salary ? monthlyEmi / salary : null;
  const affordability = emiShare === null ? "unknown" : emiShare <= R.safe_emi_share ? "comfortable" : emiShare <= R.stretch_emi_share ? "tight" : "heavy";

  // payback: the EMI month by month, and how fast it goes if the student puts 30% of pay towards it
  const balance: { month: number; owed: number }[] = [];
  let owed = principalAtStart;
  const r = inp.rate_pct / 1200;
  for (let m = 0; m <= tenureMonths && owed > 0.5; m++) {
    if (m % 3 === 0) balance.push({ month: m, owed: Math.round(owed) });
    owed = owed * (1 + r) - monthlyEmi;
  }
  balance.push({ month: tenureMonths, owed: 0 });
  let fastMonths: number | null = null;
  if (income && principalAtStart > 0) {
    let o = principalAtStart;
    for (let m = 1; m <= R.max_tenure_years * 12; m++) {
      o = o * (1 + r) - 0.3 * incomeAt(income, "median", m);
      if (o <= 0) { fastMonths = m; break; }
    }
  } else if (principalAtStart <= 0) fastMonths = 0;

  return {
    course_cost: courseCost, scholarships: chosen, scholarship_total: scholarshipTotal, other_aid: otherAid,
    stacked: stack, net_cost: netCost,
    loan: {
      needed: loan > 0, amount: loan, margin, margin_pct: marginPct, security, csis, vidyalaxmi,
      moratorium_months: moratorium, course_months: courseMonths,
      interest_full: Math.round(fullInterest), subsidy: Math.round(subsidy), moratorium_interest: Math.round(moratoriumInterest),
      principal_at_start: Math.round(principalAtStart), tenure_months: tenureMonths, emi: Math.round(monthlyEmi),
      total_repaid: Math.round(totalRepaid), total_interest: Math.round(totalRepaid - loan),
    },
    job: career ? { career: career.name, salary, estimate: Boolean(income?.estimate), text: income?.text, source: career.sources?.[0] } : null,
    emi_share: emiShare, affordability, balance, fast_payback_months: fastMonths,
    // months from today until the loan is fully repaid at the chosen EMI
    loan_free_after_months: loan > 0 ? moratorium + tenureMonths : courseMonths,
  };
}

export type Aid = ReturnType<typeof computeAid>;
