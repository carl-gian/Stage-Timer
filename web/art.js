/* Copy of art.js from the Steward design system (github.com/SymboBingo12/kingdom-project-design, MIT).
   Change it there first, then copy it here. */
'use strict';

// Original duotone artwork for Steward, drawn in code. Each function returns an SVG string.
// Shared by every page: <script src="art.js"></script>
// One layer in each artwork carries a motion hook (art-breathe, art-sway or art-drift). It only moves inside
// .st-rest, on welcome and empty screens (see components/art.css and motion/motion.md).

const halftone = (id, color, from, to) => `
  <defs>
    <pattern id="${id}-dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="2" fill="${color}"/></pattern>
    <linearGradient id="${id}-fade" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <mask id="${id}-m"><rect width="100%" height="100%" fill="url(#${id}-fade)"/></mask>
  </defs>`;

// Seen from behind: rows of people facing the platform
function audience(rows, dark) {
  let s = '';
  for (const r of rows) {
    for (let i = 0; i < r.n; i++) {
      const x = r.x0 + i * r.gap + (i % 2 ? r.jitter : 0), y = r.y + ((i * 7) % 3) * 6, k = r.k * (1 + (((i * 5) % 4) - 1.5) * 0.05);
      s += `<g transform="translate(${x} ${y}) scale(${k})" fill="${dark}">
        <path d="M-62 90 C-62 28 -36 8 0 8 C36 8 62 28 62 90 Z"/>
        <ellipse cx="0" cy="-22" rx="25" ry="30"/></g>`;
    }
  }
  return s;
}

function platformArt({ dark = '#22305a', mid = '#d9a93a', light = '#f5e6b8', w = 1200, h = 620, cx = 460, crowd = true, id = 'pl' } = {}) {
  const cy = 250;
  return `<svg class="art" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${halftone(id, dark, ['0', '0'], ['0.6', '0.8'])}
    <rect width="${w}" height="${h}" fill="${mid}"/>
    <g class="art-breathe" fill="none" stroke="${light}" stroke-opacity=".45" stroke-width="2">
      <circle cx="${cx}" cy="${cy}" r="300"/><circle cx="${cx}" cy="${cy}" r="360"/><circle cx="${cx}" cy="${cy}" r="430"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="235" fill="${light}"/>
    <g stroke="${dark}" stroke-opacity=".18" stroke-width="3">
      ${Array.from({ length: 9 }, (_, i) => `<line x1="${cx - 200 + i * 50}" y1="0" x2="${cx - 200 + i * 50 + (i - 4) * 45}" y2="404"/>`).join('')}
    </g>
    <rect width="${w}" height="${h}" fill="url(#${id}-dots)" mask="url(#${id}-m)" opacity=".35"/>
    <rect x="0" y="408" width="${w}" height="${h - 408}" fill="${light}" opacity=".55"/>
    <rect x="0" y="404" width="${w}" height="6" fill="${dark}" opacity=".85"/>
    <g fill="${dark}">
      <path d="M${cx - 70} 300 L${cx + 70} 300 L${cx + 58} 322 L${cx + 48} 410 L${cx - 48} 410 L${cx - 58} 322 Z"/>
      <rect x="${cx - 78}" y="292" width="156" height="12" rx="3"/>
      <path d="M${cx + 30} 294 C${cx + 34} 262 ${cx + 22} 236 ${cx + 2} 226" fill="none" stroke="${dark}" stroke-width="5" stroke-linecap="round"/>
      <rect x="${cx - 14}" y="212" width="22" height="34" rx="11" transform="rotate(-38 ${cx - 3} 229)"/>
    </g>
    ${crowd ? audience([
      { n: 9, x0: 40, gap: 140, y: 520, k: 0.95, jitter: 8 },
      { n: 8, x0: 100, gap: 160, y: 600, k: 1.25, jitter: -10 },
    ], dark) : ''}
  </svg>`;
}

function clockArt({ dark = '#164e57', mid = '#7a2b3a', light = '#a9d6d9', id = 'ck' } = {}) {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2, r1 = i % 3 ? 98 : 88, r2 = 112;
    return `<line x1="${200 + Math.sin(a) * r1}" y1="${200 - Math.cos(a) * r1}" x2="${200 + Math.sin(a) * r2}" y2="${200 - Math.cos(a) * r2}" stroke="${dark}" stroke-width="${i % 3 ? 4 : 8}" stroke-linecap="round"/>`;
  }).join('');
  const nodes = [[318, 70], [352, 112], [330, 160], [372, 168]];
  return `<svg class="art" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${halftone(id, dark, ['1', '0'], ['0.3', '0.7'])}
    <rect width="400" height="400" fill="${light}"/>
    <rect width="400" height="400" fill="url(#${id}-dots)" mask="url(#${id}-m)" opacity=".4"/>
    <g class="art-breathe" fill="none" stroke="${dark}" stroke-opacity=".3" stroke-width="2"><circle cx="200" cy="200" r="150"/><circle cx="200" cy="200" r="172"/></g>
    <path d="M0 400 L0 250 A190 190 0 0 1 150 400 Z" fill="${mid}" opacity=".85"/>
    <circle cx="200" cy="200" r="128" fill="#fff" fill-opacity=".55" stroke="${dark}" stroke-width="12"/>
    ${ticks}
    <line x1="200" y1="200" x2="148" y2="168" stroke="${mid}" stroke-width="12" stroke-linecap="round"/>
    <line x1="200" y1="200" x2="252" y2="120" stroke="${mid}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="200" cy="200" r="11" fill="${mid}"/>
    <g stroke="${mid}" stroke-width="3">${nodes.slice(1).map((n, i) => `<line x1="${nodes[i][0]}" y1="${nodes[i][1]}" x2="${n[0]}" y2="${n[1]}"/>`).join('')}</g>
    ${nodes.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 9 : 13}" fill="${i % 2 ? dark : mid}"/>`).join('')}
  </svg>`;
}

function bookArt({ dark = '#4f2346', mid = '#b8657f', light = '#f3d9d3', id = 'bk' } = {}) {
  return `<svg class="art" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${halftone(id, dark, ['0', '1'], ['0.5', '0.2'])}
    <rect width="400" height="400" fill="${light}"/>
    <path d="M120 300 L120 120 A80 80 0 0 1 280 120 L280 300 Z" fill="${mid}" opacity=".55"/>
    <path d="M150 300 L150 135 A50 50 0 0 1 250 135 L250 300 Z" fill="${light}" opacity=".6"/>
    <rect width="400" height="400" fill="url(#${id}-dots)" mask="url(#${id}-m)" opacity=".35"/>
    <g class="art-drift" fill="none" stroke="${dark}" stroke-opacity=".55" stroke-width="5" stroke-linecap="round">
      <path d="M188 238 C170 205 205 185 188 150 C176 126 196 108 190 84"/>
      <path d="M214 238 C232 210 200 190 220 160 C234 138 214 120 222 96"/>
    </g>
    <rect x="0" y="292" width="400" height="108" fill="${dark}"/>
    <path d="M200 262 C170 248 130 246 92 254 L84 296 C124 288 166 290 200 304 Z" fill="${light}" stroke="${dark}" stroke-width="3"/>
    <path d="M200 262 C230 248 270 246 308 254 L316 296 C276 288 234 290 200 304 Z" fill="#fff" stroke="${dark}" stroke-width="3"/>
    <g stroke="${mid}" stroke-width="2.5" stroke-linecap="round">
      <line x1="112" y1="268" x2="184" y2="270"/><line x1="110" y1="278" x2="184" y2="282"/>
      <line x1="216" y1="270" x2="288" y2="268"/><line x1="216" y1="282" x2="290" y2="278"/>
    </g>
  </svg>`;
}

function soundArt({ dark = '#4a1410', mid = '#d2502f', light = '#f7c9b0', id = 'sd' } = {}) {
  return `<svg class="art" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${halftone(id, dark, ['1', '1'], ['0.4', '0.3'])}
    <rect width="400" height="400" fill="${mid}"/>
    <circle cx="300" cy="230" r="150" fill="${light}" opacity=".9"/>
    <rect width="400" height="400" fill="url(#${id}-dots)" mask="url(#${id}-m)" opacity=".35"/>
    <g class="art-breathe art-breathe--left" fill="none" stroke="${dark}" stroke-width="7" stroke-linecap="round">
      <path d="M250 120 A90 90 0 0 1 250 250" stroke-opacity=".75"/>
      <path d="M285 92 A130 130 0 0 1 285 278" stroke-opacity=".5"/>
      <path d="M320 64 A170 170 0 0 1 320 306" stroke-opacity=".3"/>
    </g>
    <rect x="140" y="92" width="76" height="132" rx="38" fill="${dark}"/>
    <g stroke="${light}" stroke-opacity=".55" stroke-width="3">
      ${[118, 134, 150, 166].map((y) => `<line x1="152" y1="${y}" x2="204" y2="${y}"/>`).join('')}
    </g>
    <path d="M122 186 C122 250 234 250 234 186" fill="none" stroke="${dark}" stroke-width="10" stroke-linecap="round"/>
    <line x1="178" y1="236" x2="178" y2="330" stroke="${dark}" stroke-width="10"/>
    <ellipse cx="178" cy="336" rx="58" ry="12" fill="${dark}"/>
  </svg>`;
}

// A street of homes and a path to a door: the ministry
function streetArt({ dark = '#2f4a3a', mid = '#8aa26a', light = '#ecebd2', id = 'st' } = {}) {
  const house = (x, base, w, h, roof) => `
    <path d="M${x} ${base} V${base - h} L${x + w / 2} ${base - h - roof} L${x + w} ${base - h} V${base} Z" fill="${dark}"/>
    <rect x="${x + w / 2 - 9}" y="${base - 34}" width="18" height="34" rx="2" fill="${light}"/>`;
  return `<svg class="art" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${halftone(id, dark, ['0', '0'], ['0.5', '0.6'])}
    <rect width="400" height="400" fill="${light}"/>
    <g class="art-breathe">
      <circle cx="282" cy="132" r="92" fill="${mid}" opacity=".85"/>
      <g fill="none" stroke="${mid}" stroke-opacity=".5" stroke-width="2"><circle cx="282" cy="132" r="118"/><circle cx="282" cy="132" r="146"/></g>
    </g>
    <rect width="400" height="400" fill="url(#${id}-dots)" mask="url(#${id}-m)" opacity=".3"/>
    ${house(20, 300, 90, 70, 44)}${house(120, 300, 70, 96, 36)}${house(204, 300, 104, 62, 50)}${house(318, 300, 72, 84, 34)}
    <g fill="${dark}"><circle cx="196" cy="236" r="20"/><rect x="193" y="250" width="6" height="50"/></g>
    <rect x="0" y="298" width="400" height="102" fill="${mid}"/>
    <path d="M110 400 C150 360 230 352 256 300 L274 300 C262 352 214 372 200 400 Z" fill="${light}" opacity=".85"/>
  </svg>`;
}

// The Kingdom Hall building with a tree: care of the hall
function hallArt({ dark = '#2d3e50', mid = '#6fa3c7', light = '#dcecf5', id = 'hl' } = {}) {
  const windows = [0, 1, 2, 3].map((i) => `<rect x="${118 + i * 46}" y="214" width="26" height="40" rx="3" fill="${light}"/>`).join('');
  return `<svg class="art" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${halftone(id, dark, ['1', '0'], ['0.4', '0.6'])}
    <rect width="400" height="400" fill="${light}"/>
    <circle cx="200" cy="170" r="150" fill="${mid}" opacity=".55"/>
    <g fill="none" stroke="${dark}" stroke-opacity=".18" stroke-width="2"><circle cx="200" cy="170" r="172"/></g>
    <rect width="400" height="400" fill="url(#${id}-dots)" mask="url(#${id}-m)" opacity=".3"/>
    <path d="M86 180 L200 120 L314 180 Z" fill="${dark}"/>
    <rect x="96" y="178" width="208" height="122" fill="${dark}"/>
    ${windows}
    <rect x="186" y="262" width="28" height="38" fill="${mid}"/>
    <g class="art-sway" fill="${dark}" opacity=".9"><circle cx="58" cy="226" r="34"/><circle cx="40" cy="250" r="24"/><rect x="54" y="246" width="8" height="54"/></g>
    <rect x="0" y="298" width="400" height="102" fill="${mid}"/>
    <rect x="0" y="298" width="400" height="5" fill="${dark}" opacity=".6"/>
  </svg>`;
}
