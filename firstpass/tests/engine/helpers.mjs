// Shared shapes and helpers for the engine tests (not a test file itself).

import { defaultRoundabout, defaultLeg } from '../../public/js/engine/roundabout/model.js';

export function shapes() {
  const def = defaultRoundabout();

  const t = defaultRoundabout();
  t.legs = [0, 90, 270].map((b) => defaultLeg(b));

  // The literal skew from the first brief, at the default sizes. Its legs 75 and 105 degrees apart leave too
  // little circle at the two close corners, so those corners are built with shorter curb radii (a warning).
  const skew = defaultRoundabout();
  skew.legs = [0, 75, 180, 255].map((b) => defaultLeg(b));

  // The default with the North leg turned 20 degrees: the corner it closes up is built with shorter radii.
  const turned = defaultRoundabout();
  turned.legs[0].bearing = 20;

  // Widths are measured square to the curb from the end of the splitter island, so each shape's widths are at
  // least what its curb radii make with the lane beside the island kept at its approach width.
  const big = defaultRoundabout();
  big.icd = 300; big.circWidth = 24; big.apronWidth = 16;
  big.legs.forEach((l) => { Object.assign(l, { entryRadius: 60, exitRadius: 70, splitterLength: 200, splitterWidth: 20, entryWidth: 26, exitWidth: 26 }); });

  const small = defaultRoundabout();
  small.icd = 90; small.circWidth = 20; small.apronWidth = 10;
  small.legs.forEach((l) => { Object.assign(l, { entryRadius: 35, exitRadius: 45, splitterWidth: 6, entryWidth: 14.5, exitWidth: 15.5, splitterLength: 40 }); });

  const offset = defaultRoundabout();
  offset.icd = 150;
  offset.legs.forEach((l) => { Object.assign(l, { exitRadius: 80, entryWidth: 20, exitWidth: 21 }); });
  Object.assign(offset.legs[0], { offsetLeft: 12 });
  Object.assign(offset.legs[1], { offsetLeft: -8, bearing: 95, exitWidth: 23 });
  Object.assign(offset.legs[2], { approachSpeed: 30, entryRadius: 100, entryWidth: 22.5 });
  Object.assign(offset.legs[3], { entryWidth: 20, splitterWidth: 20 });

  const six = defaultRoundabout();
  six.icd = 200; six.circWidth = 20;
  six.legs = [0, 60, 120, 180, 240, 300].map((b, i) => ({
    ...defaultLeg(b, `L${i + 1}`, `Leg ${i + 1}`), entryRadius: 45, exitRadius: 60, splitterWidth: 10, entryWidth: 19, exitWidth: 21.5,
  }));

  return { default: def, t, skew, turned, big, small, offset, six };
}

/** A small deterministic random number generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}
