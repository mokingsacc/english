/* Beside's two figures, Mo and Semal (version 1, soft and round, no faces), and the little scenes they sit in.
   One drawing function per person (drawMo, drawSemal): swap the drawing there and every screen follows.
   Each garment is its own group (mo-outfit-legs, mo-outfit-puffer, mo-outfit-beanie; semal-outfit-legs,
   semal-outfit-coat, semal-outfit-scarf-band, semal-outfit-scarf-tail, semal-outfit-beanie, and her hair in
   semal-hair-back and semal-hair-front), so it can be recoloured or replaced on its own.
   Motion never lives in a drawing: the wrapper groups around it carry it (.fig-move bobs and hops, .fig-pose leans),
   so a new drawing keeps every animation. Knit and check patterns get ids unique to each picture. */
(() => {
  'use strict';
  if (window.BesideFigures) return;

  let seq = 0;
  const next = () => 'f' + (++seq);
  const SKIN_MO = '#E2AE88';
  const SKIN_SEMAL = '#E7B48F';
  const HAIR_SEMAL = '#3B2A22';
  const CHINO = '#C9A67A', CHINO_SEAM = '#B08D62';      // his tan chinos
  const DENIM = '#2E3F5E', DENIM_SEAM = '#45597D';      // her dark blue jeans
  // Heights, in proportion: she stands just a little shorter than him (Mo, 5 Nov 2026: "bigger ... but just
  // slightly smaller than me"), about nine tenths of his height. Each grows or shrinks from where it stands (feet, or the seat), so every scene keeps its ground line.
  const MO_SIZE = 1.06, SEMAL_SIZE = 0.985, SEMAL_SEATED = 0.91;
  const sized = (x, y, k, body) => `<g transform="translate(${x} ${y}) scale(${k}) translate(${-x} ${-y})">${body}</g>`;

  // Knit and check, for one picture (s makes the ids unique on the page).
  function defs(s) {
    return `<defs>
<pattern id="rib-${s}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#F5F2EC"/><rect x="3" width="1" height="4" fill="#E2DCD0"/></pattern>
<pattern id="ribc-${s}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#EAE5DB"/><rect x="2.6" width="1.4" height="4" fill="#D3CBBD"/></pattern>
<pattern id="red-${s}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#C8382D"/><rect x="3" width="1" height="4" fill="#B02F25"/></pattern>
<pattern id="redc-${s}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#AE2F26"/><rect x="2.6" width="1.4" height="4" fill="#94261E"/></pattern>
<pattern id="chk-${s}" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#F4EEE6"/><rect width="3" height="6" fill="#C8382D" opacity=".75"/><rect width="6" height="3" fill="#C8382D" opacity=".75"/></pattern>
</defs>`;
  }

  // Mo: a white ribbed beanie and a puffy black jacket with stitched baffles.
  // view 'front': standing, in the 220 by 210 pair box (he stands on the left). 'back': sitting, seen from behind,
  // in the 300 by 118 sofa box. hands: draw his own hands (left out when the two hold hands).
  function drawMo(view, s, o) {
    o = o || {};
    if (view === 'back') {
      return sized(132, 120, MO_SIZE, `<g class="mo-outfit-puffer"><rect x="112" y="80" width="40" height="40" rx="15" fill="#16181D"/><path d="M113 94 Q132 99 151 94 M113 106 Q132 111 151 106" stroke="#343842" stroke-width="1.3" fill="none"/><rect x="118" y="74" width="28" height="11" rx="5.5" fill="#1F2127"/></g>
<circle cx="132" cy="62" r="15" fill="#2B211C"/>
<g class="mo-outfit-beanie"><path d="M116 62 C115 41 149 41 148 62 Z" fill="url(#rib-${s})"/><rect x="115" y="54" width="34" height="10" rx="5" fill="url(#ribc-${s})"/></g>
<g class="tv-arm"><rect x="105" y="78" width="11" height="30" rx="5.5" fill="#1B1D23"/><rect x="106.5" y="72" width="8" height="11" rx="2" fill="#3A3330"/><circle cx="110.5" cy="74.5" r="1.4" fill="#D9493C"/></g>`);
    }
    return sized(74, 199, MO_SIZE, `<g class="mo-outfit-legs"><rect x="58" y="158" width="14" height="34" rx="6" fill="${CHINO}"/><rect x="76" y="158" width="14" height="34" rx="6" fill="${CHINO}"/><path d="M65 166 V188 M83 166 V188" stroke="${CHINO_SEAM}" stroke-width="1.1" stroke-linecap="round"/><rect x="58" y="185" width="14" height="4" rx="2" fill="${CHINO_SEAM}"/><rect x="76" y="185" width="14" height="4" rx="2" fill="${CHINO_SEAM}"/><ellipse cx="64" cy="194" rx="11" ry="5" fill="#121317"/><ellipse cx="84" cy="194" rx="11" ry="5" fill="#121317"/></g>
<g class="mo-outfit-puffer"><rect x="37" y="98" width="18" height="54" rx="9" fill="#1B1D23"/><path d="M38 116 Q46 119 54 116 M38 132 Q46 135 54 132" stroke="#343842" stroke-width="1.4" fill="none"/><rect x="47" y="90" width="54" height="76" rx="22" fill="#16181D"/><path d="M49 110 Q74 117 99 110 M48 128 Q74 135 100 128 M49 146 Q74 153 99 146" stroke="#343842" stroke-width="1.6" fill="none"/><path d="M56 98 Q52 120 56 150" stroke="#FFFFFF" stroke-opacity=".08" stroke-width="5" fill="none" stroke-linecap="round"/><line x1="74" y1="96" x2="74" y2="164" stroke="#2C3038" stroke-width="1.2"/><rect x="55" y="82" width="38" height="17" rx="8" fill="#1F2127"/><g transform="rotate(-18 101 102)"><rect x="92" y="98" width="18" height="52" rx="9" fill="#1B1D23"/><path d="M93 116 Q101 119 109 116 M93 132 Q101 135 109 132" stroke="#343842" stroke-width="1.4" fill="none"/></g></g>
${o.hands ? `<g class="mo-hands"><circle cx="46" cy="153" r="6" fill="${SKIN_MO}"/><circle cx="115" cy="149" r="6" fill="${SKIN_MO}"/></g>` : ''}
<circle cx="74" cy="62" r="25" fill="${SKIN_MO}"/>
<g class="mo-outfit-beanie"><path d="M46 64 C44 24 104 24 102 64 Z" fill="url(#rib-${s})"/><rect x="46" y="51" width="56" height="15" rx="7.5" fill="url(#ribc-${s})"/></g>`);
  }

  // Semal (they/them): a red ribbed beanie, a black coat, a red and white check scarf, long wavy dark hair.
  // Hair and scarf come in layers (back hair, scarf band, front locks, scarf tail) so each can be swapped.
  function drawSemal(view, s, o) {
    o = o || {};
    if (view === 'back') {
      return sized(172, 116, SEMAL_SEATED, `<g class="semal-outfit-coat"><path d="M156 84 Q172 78 188 84 L192 116 L152 116 Z" fill="#15161A"/></g>
<g class="semal-outfit-scarf-band"><rect x="157" y="77" width="30" height="10" rx="5" fill="url(#chk-${s})"/></g>
<g class="semal-hair-back"><path d="M158 60 C156 40 188 40 186 60 L189 102 C185 109 179 105 172 109 C165 105 159 109 155 102 Z" fill="${HAIR_SEMAL}"/><path d="M166 70 C165 82 167 92 165 102 M178 70 C179 82 177 92 179 102" stroke="#5C4235" stroke-width="1" fill="none" stroke-linecap="round"/></g>
<g class="semal-outfit-beanie"><path d="M157 58 C155 38 189 38 187 58 Z" fill="url(#red-${s})"/><rect x="155" y="51" width="34" height="10" rx="5" fill="url(#redc-${s})"/></g>`);
    }
    return sized(143, 199, SEMAL_SIZE, `<path class="semal-hair-back" d="M120 60 C118 32 168 32 166 60 L166 90 L120 90 Z" fill="${HAIR_SEMAL}"/>
<g class="semal-outfit-legs"><rect x="129" y="164" width="11" height="28" rx="5" fill="${DENIM}"/><rect x="146" y="164" width="11" height="28" rx="5" fill="${DENIM}"/><path d="M134.5 170 V189 M151.5 170 V189" stroke="${DENIM_SEAM}" stroke-width="1" stroke-linecap="round" stroke-dasharray="2 1.6"/><ellipse cx="134" cy="194" rx="9.5" ry="5" fill="#121317"/><ellipse cx="152" cy="194" rx="9.5" ry="5" fill="#121317"/></g>
<g class="semal-outfit-coat"><rect x="160" y="100" width="14" height="50" rx="7" fill="#1C1D22"/><path d="M124 92 Q143 86 162 92 L172 170 Q143 177 114 170 Z" fill="#15161A"/><path d="M133 94 L143 124 L153 94" stroke="#2D2F36" stroke-width="1.6" fill="none"/><circle cx="143" cy="134" r="1.8" fill="#2D2F36"/><circle cx="143" cy="150" r="1.8" fill="#2D2F36"/><g transform="rotate(16 120 104)"><rect x="113" y="100" width="14" height="50" rx="7" fill="#1C1D22"/></g></g>
${o.hands ? `<g class="semal-hands"><circle cx="108" cy="149" r="5.5" fill="${SKIN_SEMAL}"/><circle cx="167" cy="152" r="5.5" fill="${SKIN_SEMAL}"/></g>` : ''}
<circle cx="143" cy="62" r="23" fill="${SKIN_SEMAL}"/>
<g class="semal-outfit-scarf-band"><rect x="122" y="80" width="42" height="15" rx="7.5" fill="url(#chk-${s})"/></g>
<g class="semal-hair-front"><path d="M121 56 C116 70 119 84 116 98 C113 110 116 120 124 125 C122 117 127 112 128 104 C129 94 126 86 128 74 C129 68 129 62 129 58 Z" fill="${HAIR_SEMAL}"/><path d="M165 56 C170 70 167 84 170 98 C173 110 170 120 162 125 C164 117 159 112 158 104 C157 94 160 86 158 74 C157 68 157 62 157 58 Z" fill="${HAIR_SEMAL}"/><path d="M121 70 C119 84 121 96 118 108 M165 70 C167 84 165 96 168 108" stroke="#5C4235" stroke-width="1.2" fill="none" stroke-linecap="round"/></g>
<g class="semal-outfit-scarf-tail"><g transform="rotate(5 152 90)"><rect x="146" y="88" width="12" height="36" rx="4" fill="url(#chk-${s})"/><path d="M147 124 v4 M150 124 v4 M153 124 v4 M156 124 v4" stroke="#C8382D" stroke-width="1.2"/></g></g>
<g class="semal-outfit-beanie"><path d="M119 59 C117 29 169 29 167 59 Z" fill="url(#red-${s})"/><rect x="117" y="49" width="52" height="14" rx="7" fill="url(#redc-${s})"/></g>`);
  }

  const DRAW = { mo: drawMo, semal: drawSemal };
  const NAME = { mo: 'Mo', semal: 'Semal' };
  const LOOK = { mo: 'in a white beanie, a black puffer jacket and tan chinos', semal: 'in a red beanie, a black coat, a check scarf and dark blue jeans' };
  // Where each one stands in the pair box, for drawing them alone. Both boxes are the same height, so drawn alone
  // side by side they keep their heights. The head crops follow each one's size.
  const BOX = { mo: '23 18 102 188', semal: '92 18 102 188' };
  const HEAD = { mo: '42 22 64 64', semal: '114.5 36 57 57' };

  // One person, wrapped so motion can be added: .fig-move (bob, hop) holds .fig-pose (lean), which holds the drawing.
  const wrap = (who, body) => `<g class="fig-move fig-${who}" data-fig="${who}"><g class="fig-pose">${body}</g></g>`;
  const a11y = (label) => (label ? `role="img" aria-label="${String(label).replace(/"/g, '')}"` : 'aria-hidden="true"');

  // One person standing. pose 'head' crops to the head, for small round pictures.
  function figure(who, o) {
    o = o || {};
    who = DRAW[who] ? who : 'mo';
    const s = next();
    const vb = o.pose === 'head' ? HEAD[who] : BOX[who];
    const label = o.label === '' ? '' : (o.label || (o.name || NAME[who]) + ', ' + LOOK[who]);
    return `<svg class="fig ${o.cls || ''}" viewBox="${vb}" ${a11y(label)} focusable="false">${defs(s)}${wrap(who, DRAW[who]('front', s, { hands: true }))}</svg>`;
  }

  // The two standing hand in hand.
  function pair(o) {
    o = o || {};
    const s = next();
    return `<svg class="fig-scene fig-pair ${o.cls || ''}" viewBox="0 0 220 210" ${a11y(o.label === '' ? '' : (o.label || 'Mo and Semal, hand in hand'))} focusable="false">${defs(s)}
<ellipse cx="110" cy="198" rx="84" ry="6" fill="#EADFD0" class="fig-shadow"/>
${wrap('mo', drawMo('front', s))}${wrap('semal', drawSemal('front', s))}
<circle class="fig-hands" cx="115" cy="151" r="6.5" fill="${SKIN_MO}"/></svg>`;
  }

  // The two sitting together on the sofa, facing you: for empty lists and quiet moments.
  function sofa(o) {
    o = o || {};
    const s = next();
    return `<svg class="fig-scene fig-sofa ${o.cls || ''}" viewBox="0 10 220 170" ${a11y(o.label === '' ? '' : (o.label || 'Mo and Semal sitting together on the sofa'))} focusable="false">${defs(s)}
<rect x="22" y="92" width="176" height="64" rx="24" fill="#C98B6B"/>
${wrap('mo', drawMo('front', s))}${wrap('semal', drawSemal('front', s))}
<circle class="fig-hands" cx="115" cy="151" r="6.5" fill="${SKIN_MO}"/>
<rect x="26" y="146" width="168" height="34" rx="14" fill="#BB7E60"/><path d="M110 150 V178" stroke="#B57A5C" stroke-width="1.6"/>
<rect x="8" y="122" width="30" height="58" rx="13" fill="#B57A5C"/><rect x="182" y="122" width="30" height="58" rx="13" fill="#B57A5C"/>
</svg>`;
  }

  // The Calls room: the two on the sofa, seen from behind, facing the TV. He lifts the remote (.tv-arm), the TV
  // clicks on (.tv-on), the light spills out (.tv-glow), and she leans on his shoulder. .tv-screen is the screen
  // that grows into the call.
  function tvRoom(o) {
    o = o || {};
    const s = next();
    return `<svg class="fig-scene tv-room ${o.cls || ''}" viewBox="0 0 300 118" ${a11y(o.label === '' ? '' : (o.label || 'Mo and Semal on the sofa, seen from behind, facing the TV'))} focusable="false">${defs(s)}
<rect x="0" y="0" width="300" height="118" rx="16" fill="#EFE5D8"/>
<g class="tv-lamp"><rect x="258" y="40" width="2.5" height="62" rx="1.2" fill="#B9A796"/><path d="M246 42 L272 42 L265 26 L253 26 Z" fill="#F3D9B1"/><rect x="250" y="100" width="18" height="4" rx="2" fill="#B9A796"/></g>
<g class="tv-plant"><path d="M36 82 Q26 66 30 52 Q38 66 40 80 Z M42 80 Q42 60 51 50 Q53 66 45 82 Z M38 82 Q48 72 60 70 Q52 80 42 84 Z" fill="#7E9A6E"/><path d="M32 82 H54 L51 104 H35 Z" fill="#C9826A"/></g>
<polygon class="tv-glow" points="120,36 180,36 240,118 60,118" fill="#FFE2B0"/>
<rect x="144" y="38" width="12" height="5" fill="#8A6E58"/><rect x="118" y="42" width="64" height="5" rx="2.5" fill="#A88468"/>
<rect x="116" y="5" width="68" height="35" rx="4" fill="#1A1B20"/>
<rect class="tv-screen" x="119" y="8" width="62" height="29" rx="2.5" fill="#2A2D35"/>
<g class="tv-on"><rect x="119" y="8" width="62" height="29" rx="2.5" fill="#F6C98F"/><rect x="119" y="23" width="62" height="14" fill="#E59B6E"/><path d="M146 17 L155 22.5 L146 28 Z" fill="#FFFFFF" opacity=".9"/></g>
<g transform="translate(0 12) scale(1 0.92)">${wrap('semal', drawSemal('back', s))}${wrap('mo', drawMo('back', s))}</g>
<rect x="74" y="96" width="152" height="30" rx="13" fill="#C98B6B"/>
<path d="M150 99 V124" stroke="#B57A5C" stroke-width="1.6"/>
<rect x="64" y="102" width="22" height="24" rx="9" fill="#BB7E60"/><rect x="214" y="102" width="22" height="24" rx="9" fill="#BB7E60"/>
</svg>`;
  }

  // In a call (Next Door): the two on one sofa, seen from behind, with nothing else around them.
  function sofaBack(o) {
    o = o || {};
    const s = next();
    return `<svg class="fig-scene fig-sofaback ${o.cls || ''}" viewBox="60 36 180 92" ${a11y(o.label === '' ? '' : (o.label || 'Mo and Semal on one sofa, seen from behind'))} focusable="false" preserveAspectRatio="xMidYMax meet">${defs(s)}
<g transform="translate(0 12) scale(1 0.92)">${wrap('semal', drawSemal('back', s))}${wrap('mo', drawMo('back', s))}</g>
<rect x="70" y="91" width="160" height="37" rx="14" fill="#B06A52"/>
<path d="M150 95 V126" stroke="#9C5B45" stroke-width="1.6"/>
<rect x="60" y="99" width="26" height="29" rx="10" fill="#9C5B45"/><rect x="214" y="99" width="26" height="29" rx="10" fill="#9C5B45"/>
</svg>`;
  }

  // A soft heart, for the one that floats across.
  const softHeart = (cls) => `<svg class="${cls || ''}" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false"><path d="M0 9 C-9 3.5 -10 -2.5 -5.5 -5 C-2.8 -6.4 -0.8 -5 0 -3 C0.8 -5 2.8 -6.4 5.5 -5 C10 -2.5 9 3.5 0 9 Z" fill="#E8907A"/></svg>`;

  window.BesideFigures = { drawMo, drawSemal, figure, pair, sofa, tvRoom, sofaBack, softHeart, NAME };
})();
