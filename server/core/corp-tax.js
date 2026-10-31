// A company's taxes for a fiscal year (企業: server/core/corp-model.js), as in Japan for a company in Tokyo, by the
// rules in js/game/corp.js (BR.CORP.tax): 法人税 (a 中小法人's first slice of income at the lower rate), 地方法人税
// and the 住民税's 法人税割 as shares of it, the 均等割 by the capital and the staff, 事業税 with its 特別法人事業税 (a
// 大法人's partly by its size: 外形標準課税), and the losses of the last years set against the income. A year's
// 事業税 is a cost of the year it is paid in, so it comes off the next year's income.
import { CORP } from './rules.js';

const T = CORP.tax;

// the 均等割 a year: by the capital with the reserve (資本金等), and whether the staff are more than 50
export function flatTax(capitalEtc, staff) {
  for (const [upTo, few, many] of T.flat) if (capitalEtc <= upTo) return staff > 50 ? many : few;
  return 0;
}

// A year's taxes. income: the year's pre-tax income as the tax counts it (with what is not taxed already taken
// out); paidBusiness: the 事業税 paid in the year (for the year before); carry: the losses carried [[fy, $]…];
// value: what the company added (its pay, net interest and rent, with the income: 付加価値, for a 大法人).
export function yearTax({ fy, income, paidBusiness = 0, carry = [], capital, capitalEtc, staff, value = 0 }) {
  const small = capital <= T.small.capital;
  const base = Math.round(income - paidBusiness);
  // (losses older than the rule allows are gone; the oldest are used first)
  let kept = carry.filter(([year, n]) => n > 0 && fy - year <= T.carryYears).map(([year, n]) => [year, n]);
  let taxable = 0, used = 0;
  if (base <= 0) {
    if (base < 0) kept.push([fy, -base]);
  } else {
    let room = small ? base : Math.floor(base * T.large.carryShare);
    for (const k of kept) {
      const take = Math.min(room, k[1]);
      k[1] -= take;
      room -= take;
      used += take;
    }
    kept = kept.filter(([, n]) => n > 0);
    taxable = base - used;
  }
  const low = small ? Math.min(taxable, T.small.lowUpTo) : 0;
  const corporate = Math.floor(low * T.small.low + (taxable - low) * T.corporate);
  const local = Math.floor(corporate * T.local);
  const flat = flatTax(capitalEtc, staff);
  const inhabitant = Math.floor(corporate * T.inhabitant) + flat;
  let business, special, sizeTax = 0;
  if (small) {
    business = Math.floor(taxable * T.small.business);
    special = Math.floor(business * T.small.special);
  } else {
    business = Math.floor(taxable * T.large.business);
    special = Math.floor(business * T.large.special);
    sizeTax = Math.floor(Math.max(0, value) * T.large.value) + Math.floor(capitalEtc * T.large.capital);
  }
  const businessAll = business + special + sizeTax;
  return {
    fy, small, base, taxable, used, carry: kept,
    corporate, local, inhabitant, flat, business, special, sizeTax,
    // (the 事業税 family: a cost of next year, when it is paid)
    businessAll,
    total: corporate + local + inhabitant + businessAll
  };
}

// The year's tax as a share of a pre-tax income (for the quarters' estimates and the forecasts).
export function taxRate(args) {
  const income = Math.max(1, args.income);
  return Math.max(0, yearTax(args).total / income);
}
