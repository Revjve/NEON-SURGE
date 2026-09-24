// Inline SVG glyphs for upgrade cards, build chips and the Hangar shop (24x24, stroked
// with currentColor so CSS controls the colour and glow).

const P = {
  multishot: '<path d="M12 21V6M12 21 5.5 8.5M12 21l6.5-12.5"/><circle cx="12" cy="4" r="1.6"/><circle cx="4.8" cy="7" r="1.6"/><circle cx="19.2" cy="7" r="1.6"/>',
  firerate: '<path d="m4 6 5 6-5 6M11 6l5 6-5 6M18 6l3 6-3 6"/>',
  damage: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5M5.3 5.3l2.4 2.4M16.3 16.3l2.4 2.4M18.7 5.3l-2.4 2.4M7.7 16.3l-2.4 2.4"/>',
  explosive: '<path d="m12 2 2.2 5.3 5.6-1.9-2.6 5.2L22 13l-5.4 1.4 1 5.6-4.8-3.2L9.2 22l-.6-5.6L3 16l4.4-3.6L3.5 8l5.6.4Z"/>',
  bounce: '<path d="M3 20 11 5l5 10 5-9"/><path d="M2 21h20" opacity=".5"/>',
  pierce: '<circle cx="9" cy="12" r="4.5"/><circle cx="16" cy="12" r="3" opacity=".6"/><path d="M1.5 12H23M19.5 8.5 23 12l-3.5 3.5"/>',
  velocity: '<path d="M9 12h13M18 8l4 4-4 4M2 8h6M4 12h3M2 16h6"/>',
  caliber: '<path d="M4 9h10l6 3-6 3H4Z"/><path d="M8 9v6"/>',
  chain: '<path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2Z"/>',
  crit: '<circle cx="12" cy="12" r="7.5"/><path d="M12 1.5V7M12 17v5.5M1.5 12H7M17 12h5.5"/><path d="m12 9.2.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3Z"/>',
  homing: '<path d="M3 20C6 9 13 6 18.5 8"/><path d="m15.5 5 3.2 3-3.4 2.8"/><circle cx="20" cy="15.5" r="2.2"/>',
  shrapnel: '<path d="m12 4 4 8-4 8-4-8Z"/><path d="M3 6l3 2M21 6l-3 2M3 18l3-2M21 18l-3-2"/>',
  cascade: '<circle cx="7" cy="15" r="3.5"/><circle cx="15.5" cy="9" r="4.5"/><path d="M19 17.5l2.5 2.5M3 5l2 2M10 3l.5 2.5"/>',
  drone: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3" opacity=".6"/><path d="m18.5 6 3 2.5-3 2.5-2-2.5Z"/><path d="m12 9 3 3-3 3-3-3Z"/>',
  hull: '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z"/><path d="M12 7v10M7.5 9.5v5M16.5 9.5v5"/>',
  repair: '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z"/><path d="M12 8v8M8 12h8"/>',
  shield: '<path d="M12 2.5c3 1.8 5.8 2.4 8.5 2.5v6.5c0 5-3.5 8.6-8.5 10.5C7 20.1 3.5 16.5 3.5 11.5V5c2.7-.1 5.5-.7 8.5-2.5Z"/>',
  speed: '<path d="M12 3 20 20l-8-4.5L4 20Z"/><path d="M8 22h8" opacity=".6"/>',
  magnet: '<path d="M5 4v8a7 7 0 0 0 14 0V4h-4.5v8a2.5 2.5 0 0 1-5 0V4Z"/><path d="M5 8h4.5M14.5 8H19"/>',
  surge: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6" opacity=".75"/><circle cx="12" cy="12" r="9.5" opacity=".45"/>',
  cache: '<path d="m12 2 7 6-7 14L5 8Z"/><path d="M5 8h14M9.5 8 12 22l2.5-14L12 2 9.5 8"/>',
  shards: '<path d="m12 2 7 6-7 14L5 8Z"/><path d="M5 8h14M9.5 8 12 22l2.5-14L12 2 9.5 8"/>',
  fireRate: '<path d="m4 6 5 6-5 6M11 6l5 6-5 6M18 6l3 6-3 6"/>',
  reroll: '<path d="M20 11a8 8 0 0 0-14.3-4.7L3.5 8.5"/><path d="M3.5 3.5v5h5M4 13a8 8 0 0 0 14.3 4.7l2.2-2.2"/><path d="M20.5 20.5v-5h-5"/>',
  luck: '<path d="M12 2.5 14.4 9.6 21.5 12l-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4Z"/>',
  ship: '<path d="M3 21 12 2l9 19-9-5.5Z"/>',
};

export function icon(id, cls = 'ico') {
  const body = P[id] ?? P.luck;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
