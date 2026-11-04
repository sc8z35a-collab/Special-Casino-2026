// 健康度 (js/game/npc.js HEALTH): everyone's, −100 to 100. ヴェルノア's people keep it in their `health` byte (0..255 ↔
// −100..100: a country kept before reads as it was, put on the new scale once), アスカ国's in their `hp`. A day at a
// time it wears down — stress, a big loss of money (心の傷), work beyond what one bears, illness now and then and the
// long ones (持病: `ill`), age, being poor a long time — and comes back with rest and sleep, and with the hospital's
// care (server/core/hachi.js). What it does: below 1 no work (休職), the less done the lower, twice as much done from
// 76, and from 86 up to 70% more earned; at −90 and below an operation within the hour or death.
import { NPC } from './rules.js';
import { T, E, E2, NT, FL, HOME, MEMS, memoryAt } from './npc-pop.js';

const HL = NPC.health;
const clamp = (x) => Math.max(-100, Math.min(100, x));
// the byte and the scale
export const toHp = (b) => Math.round(b / 1.275 - 100);
export const toByte = (h) => Math.max(0, Math.min(255, Math.round((clamp(h) + 100) * 1.275)));
export const hpOf = (P, i) => toHp(P.health[i]);
export function setHp(P, i, h) { P.health[i] = toByte(h); }
export function addHp(P, i, x) { P.health[i] = toByte(toHp(P.health[i]) + x); }
export const band = (h) => NPC.healthBand(Math.round(h));

// what a person's work does at their health (1: as usual) — none below 1, twice as much from 76
export function output(h) {
  if (h <= 0) return 0;
  if (h <= 30) return 0.6;
  if (h <= 50) return 0.85;
  if (h <= 75) return 1;
  return 2;
}
// what they earn of their pay at their health: from 86, up to 70% more at 100
export const earn = (h) => (h > 85 ? 1 + HL.earn * Math.min(1, (h - 85) / 15) : 1);
// (what their pay counts as for their employer's payroll: server/core/npc-model.js flowsFor, npc-state.js payStaff)
export const earnOf = (P, i) => earn(hpOf(P, i));

// where a person's health comes back to of itself at their age (and their 持病's weight)
export const baseline = (age, ill = 0) => 68 - Math.max(0, age - 40) * 0.45 - ill * 0.25;

// A person's health at the start (a new country, a new life at 18): about their age's baseline, a few with a 持病
export function start(age, r) {
  const ill = r.u() < 0.02 + Math.max(0, age - 50) * 0.002 ? 20 + r.int(60) : 0;
  return { hp: clamp(Math.round(baseline(age, ill) + r.z() * 9)), ill };
}

// (the memories of a big loss — kinds 2 and 14, npc-life.js M.bigLoss, M.stockDown — from today: how much it hurt, 0..1)
function lossToday(P, i, day) {
  let worst = 0;
  for (let k = 0; k < MEMS; k++) {
    const v = memoryAt(P, i, k);
    if (v && (v.kind === 2 || v.kind === 14) && v.day === (day & 0xffff)) worst = Math.max(worst, v.power / 255);
  }
  return worst;
}
// A day of a ヴェルノア person's health (npc-state.js daily): what wore it down, what brought it back. Returns
// `sick`: an illness came today (to the hospital: hachi.js).
export function day(W, i, day, age, r) {
  const P = W.P, H = HL.harm;
  let h = hpOf(P, i), sick = false;
  const ill = P.ill ? P.ill[i] : 0, base = baseline(age, ill);
  const stress = P.emo[i * 5 + E.stress], tired = P.emo2 ? P.emo2[i * 3 + E2.tired] : 0;
  // stress beyond what one shrugs off, work beyond what one bears
  if (stress > 170) h -= H.stress * (stress - 170) / 85;
  if (tired > 180) h -= H.work * (tired - 180) / 75;
  // a big loss of money today — at the casino, in the market —: 心の傷 (as much as it hurt: the memory's power)
  const hurt = lossToday(P, i, day);
  if (hurt) h -= H.loss * hurt;
  // an illness now and then (the older the likelier), a long one now and then from it (持病)
  if (r.u() < 0.0015 + age * 0.00005) {
    h -= H.illness[0] + r.int(H.illness[1] - H.illness[0]);
    // (now and then a grave one — a stroke, an accident —: to a bed or an operation, at worst the hour)
    if (r.u() < H.grave[0]) h -= H.grave[1] + r.int(H.grave[2]);
    sick = true;
    if (P.ill && r.u() < 0.1) P.ill[i] = Math.min(255, ill + 20 + r.int(40));
  }
  // its weight a day, less while it is treated (the month's medicine: hachi.js `med`)
  if (ill) h -= H.chronic * ill / 100 * (P.med && P.med[i] ? 0.4 : 1);
  // age: the years past 60 a little each day
  if (age > 60) h -= H.age * (age - 60) / 20;
  // poor a long time: payments missed, no home
  if ((P.miss && P.miss[i] >= 3) || P.home[i] === HOME.street) h -= H.poor;
  // back towards one's baseline: faster resting (no work while unfit: npc-life.js obliged), a little above it never —
  // and a リハビリ's conditioning (76 and up) fading within days, unless kept up
  if (h < base) h += HL.rest * (h <= 0 ? 2.5 : 1) * (0.6 + 0.4 * (1 - stress / 255));
  else h -= Math.min(h - base, h > 75 ? HL.fade : 0.3);
  // the neurotic feel every ache the more (a little, always)
  h -= 0.1 * P.tr[i * NT + T.neuro] / 255;
  setHp(P, i, h);
  if (h > 0) P.flags[i] &= ~FL.sick; else P.flags[i] |= FL.sick;
  return sick;
}

// A country kept before 健康度 had its scale (its `health` bytes as they were, most near the top): everyone set by their
// age's baseline as the new scale has it, keeping who was healthier than whom (once)
export function recalibrate(W, day, ageOf) {
  const P = W.P;
  if (W.health2) return;
  for (let i = 0; i < P.n; i++) {
    const age = ageOf(P, i, day), was = P.health[i] / 255, ill = P.ill ? P.ill[i] : 0;
    setHp(P, i, clamp(Math.round(baseline(age, ill) + (was - 0.85) * 60)));
  }
  W.health2 = day;
}

/* ------------------------------------------------------------ アスカ国's --- */
// A day of an アスカ国 person's (lighter: no moods; their pay against the country's and their age): the same bands
export function asukaDay(A, i, age, poor, r) {
  let h = A.hp[i];
  const ill = A.ill[i], base = baseline(age, ill);
  let sick = false;
  if (r.u() < 0.0015 + age * 0.00005) {
    h -= HL.harm.illness[0] + r.int(HL.harm.illness[1] - HL.harm.illness[0]);
    if (r.u() < HL.harm.grave[0]) h -= HL.harm.grave[1] + r.int(HL.harm.grave[2]);
    sick = true;
    if (r.u() < 0.1) A.ill[i] = Math.min(255, ill + 20 + r.int(40));
  }
  if (ill) h -= HL.harm.chronic * ill / 100 * (A.med[i] ? 0.4 : 1);
  if (age > 60) h -= HL.harm.age * (age - 60) / 20;
  if (poor) h -= HL.harm.poor;
  // (work's and life's own wear, now and then)
  if (r.u() < 0.03) h -= 3 + r.int(8);
  if (h < base) h += HL.rest * (h <= 0 ? 2.5 : 1) * 0.8;
  else h -= Math.min(h - base, h > 75 ? HL.fade : 0.3);
  A.hp[i] = clamp(Math.round(h));
  return sick;
}
