// Server-side Iconify resolver so the Director can change an icon_row's icons
// in the editor. Mirrors guide_creator_flow/tools/icons.py: a curated concept →
// Iconify-name map for staples, Iconify search for anything else, then a
// recoloured SVG URL the ingest route downloads into the project snapshot.
// Keyless (api.iconify.design).

const SEARCH_URL = 'https://api.iconify.design/search';
const PREFIXES = 'mdi,lucide,ph,tabler,material-symbols';
const TIMEOUT = 15000;

// Keep in sync with icons.py's _MAP for consistent picks across pipeline/editor.
const MAP = {
  brain: 'mdi:brain', chip: 'mdi:chip', cpu: 'mdi:cpu-64-bit', database: 'mdi:database',
  network: 'mdi:lan', eye: 'mdi:eye', gear: 'mdi:cog', settings: 'mdi:cog',
  chart: 'mdi:chart-line', graph: 'mdi:chart-line', lightbulb: 'mdi:lightbulb-on',
  idea: 'mdi:lightbulb-on', clock: 'mdi:clock-outline', time: 'mdi:clock-outline',
  check: 'mdi:check-circle', cross: 'mdi:close-circle', arrow: 'mdi:arrow-right',
  rocket: 'mdi:rocket-launch', cloud: 'mdi:cloud', lock: 'mdi:lock',
  security: 'mdi:shield-check', shield: 'mdi:shield-check', code: 'mdi:code-tags',
  money: 'mdi:cash', growth: 'mdi:trending-up', people: 'mdi:account-group',
  user: 'mdi:account', globe: 'mdi:earth', world: 'mdi:earth', phone: 'mdi:cellphone',
  mobile: 'mdi:cellphone', email: 'mdi:email', search: 'mdi:magnify', star: 'mdi:star',
  heart: 'mdi:heart', fire: 'mdi:fire', flash: 'mdi:lightning-bolt', speed: 'mdi:speedometer',
  target: 'mdi:target', map: 'mdi:map-marker', calendar: 'mdi:calendar',
  document: 'mdi:file-document', folder: 'mdi:folder', cart: 'mdi:cart', gift: 'mdi:gift',
  warning: 'mdi:alert', info: 'mdi:information', link: 'mdi:link-variant', robot: 'mdi:robot',
  atom: 'mdi:atom', dna: 'mdi:dna', leaf: 'mdi:leaf', water: 'mdi:water',
  sun: 'mdi:white-balance-sunny', battery: 'mdi:battery', wifi: 'mdi:wifi',
  server: 'mdi:server', key: 'mdi:key', trophy: 'mdi:trophy', book: 'mdi:book-open-variant',
};

async function resolveName(concept) {
  const key = String(concept || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!key) return null;
  if (MAP[key]) return MAP[key];
  for (const word of key.split(' ')) if (MAP[word]) return MAP[word];
  try {
    const url = `${SEARCH_URL}?query=${encodeURIComponent(key)}&limit=1&prefixes=${PREFIXES}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!r.ok) return null;
    const icons = (await r.json())?.icons || [];
    return icons[0] || null;
  } catch { return null; }
}

// Resolve a concept to a recoloured Iconify SVG URL (or null). The ingest route
// downloads this URL into the project snapshot as the icon's src.
export async function iconSvgUrl(concept, color = '#ffffff', size = 240) {
  const name = await resolveName(concept);
  if (!name || !name.includes(':')) return null;
  const [prefix, icon] = name.split(':');
  return `https://api.iconify.design/${prefix}/${icon}.svg?color=${encodeURIComponent(color)}&height=${size}`;
}
