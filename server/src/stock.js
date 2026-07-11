// Unified stock-media search for the editor's "Replace footage" panel and the
// Director's add_stock tool. Ports the pipeline's provider reach
// (guide_creator_flow/tools/stock.py) to Node — logo.dev + Pexels + Pixabay +
// NASA + Wikimedia, photos AND videos — MINUS the LLM relevance ranker (that
// stays pipeline-only). Providers are pooled concurrently and interleaved in
// priority order; any provider without a key, or one that errors, is skipped.
//
// Result shape the webapp grid + ingest route consume:
//   { id, provider, type:'video'|'photo', thumb, download, width, height,
//     duration, credit, link, license?, attributionRequired? }
import { config } from './config.js';

// Priority order — also the interleave order and tie-break (mirrors stock.py):
// logos first (authoritative for brands), wikimedia last (broad catalog).
const ORDER = ['logodev', 'pexels', 'pixabay', 'nasa', 'wikimedia'];
const TIMEOUT = 20000;
const UA = 'SquookVideoPipeline/1.0 (stock media fetch; contact: local dev)';

async function httpGet(url, opts = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...opts });
  if (!r.ok) throw new Error(`${r.status}`);
  return r;
}

/**
 * Search configured providers and return a pooled, interleaved candidate list.
 * @param {string} query
 * @param {{provider?:string, perPage?:number, mediaType?:'video'|'photo'}} opts
 */
export async function searchStock(query, { provider = 'all', perPage = 24, mediaType = 'video' } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const type = mediaType === 'photo' ? 'photo' : 'video';
  const names = provider === 'all' ? ORDER : (PROVIDERS[provider] ? [provider] : []);
  const active = names.filter((n) => PROVIDERS[n].configured());
  const settled = await Promise.allSettled(
    active.map((n) => PROVIDERS[n].search(q, { perPage, mediaType: type })),
  );
  const out = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') out.push(...r.value);
    else console.warn(`[stock] ${active[i]} search failed:`, r.reason?.message || r.reason);
  });
  return interleave(out);
}

// ————————————————————————— providers —————————————————————————

// Pick the mp4 rendition closest to ~1080p without exceeding it (keeps ingest
// downloads reasonable), falling back to the largest available.
function pickMp4(files, cap = 1920) {
  const mp4 = (files || []).filter((f) => (f.file_type || '').includes('mp4') && f.link);
  if (!mp4.length) return null;
  const byW = [...mp4].sort((a, b) => (a.width || 0) - (b.width || 0));
  const underCap = byW.filter((f) => (f.width || 0) <= cap);
  return underCap.length ? underCap[underCap.length - 1] : byW[0];
}

const pexels = {
  configured: () => Boolean(config.pexelsKey),
  async search(query, { perPage, mediaType }) {
    const headers = { Authorization: config.pexelsKey };
    if (mediaType === 'photo') {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}`
        + `&per_page=${perPage}&orientation=landscape`;
      const data = await (await httpGet(url, { headers })).json();
      return (data.photos || []).map((p) => {
        const src = p.src || {};
        const download = src.large2x || src.original || src.large || src.medium;
        if (!download) return null;
        return {
          id: `pexels-${p.id}`, provider: 'pexels', type: 'photo',
          thumb: src.medium || src.small || download, download,
          width: p.width, height: p.height, duration: null,
          credit: p.photographer || 'Pexels', link: p.url,
        };
      }).filter(Boolean);
    }
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}`
      + `&per_page=${perPage}&orientation=landscape&size=medium`;
    const data = await (await httpGet(url, { headers })).json();
    return (data.videos || []).map((v) => {
      const file = pickMp4(v.video_files);
      if (!file) return null;
      return {
        id: `pexels-${v.id}`, provider: 'pexels', type: 'video',
        thumb: v.image, download: file.link,
        width: file.width || v.width, height: file.height || v.height,
        duration: v.duration, credit: v.user?.name || 'Pexels', link: v.url,
      };
    }).filter(Boolean);
  },
};

const pixabay = {
  configured: () => Boolean(config.pixabayKey),
  async search(query, { perPage, mediaType }) {
    const per = Math.min(perPage, 200);
    if (mediaType === 'photo') {
      const url = `https://pixabay.com/api/?key=${config.pixabayKey}`
        + `&q=${encodeURIComponent(query)}&image_type=photo&per_page=${per}&safesearch=true`;
      const data = await (await httpGet(url)).json();
      return (data.hits || []).map((h) => {
        const download = h.largeImageURL || h.webformatURL;
        if (!download) return null;
        return {
          id: `pixabay-${h.id}`, provider: 'pixabay', type: 'photo',
          thumb: h.webformatURL || h.previewURL || download, download,
          width: h.imageWidth, height: h.imageHeight, duration: null,
          credit: h.user || 'Pixabay', link: h.pageURL,
        };
      }).filter(Boolean);
    }
    const url = `https://pixabay.com/api/videos/?key=${config.pixabayKey}`
      + `&q=${encodeURIComponent(query)}&per_page=${per}&safesearch=true`;
    const data = await (await httpGet(url)).json();
    return (data.hits || []).map((h) => {
      const v = h.videos || {};
      const rendition = v.large?.url ? v.large : v.medium?.url ? v.medium : v.small;
      if (!rendition?.url) return null;
      const thumb = rendition.thumbnail
        || (h.picture_id ? `https://i.vimeocdn.com/video/${h.picture_id}_295x166.jpg` : '');
      return {
        id: `pixabay-${h.id}`, provider: 'pixabay', type: 'video',
        thumb, download: rendition.url,
        width: rendition.width, height: rendition.height,
        duration: h.duration, credit: h.user || 'Pixabay', link: h.pageURL,
      };
    }).filter(Boolean);
  },
};

// NASA: public-domain, keyless. Search returns an asset manifest per item; the
// downloadable file URL is resolved from it (capped + concurrent).
const nasa = {
  configured: () => true,
  async search(query, { mediaType }) {
    const apiMedia = mediaType === 'video' ? 'video' : 'image';
    const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(query.slice(0, 100))}`
      + `&media_type=${apiMedia}&page_size=8`;
    const data = await (await httpGet(url)).json();
    const items = ((data.collection || {}).items || []).slice(0, 6);
    const resolved = await Promise.allSettled(items.map(async (item) => {
      const d = (item.data || [{}])[0];
      if (!item.href || !d.nasa_id) return null;
      const download = await resolveNasaAsset(item.href, apiMedia);
      if (!download) return null;
      return {
        id: `nasa-${d.nasa_id}`, provider: 'nasa', type: mediaType,
        thumb: (item.links || []).find((l) => l.render === 'image')?.href || (item.links || [{}])[0]?.href || download,
        download, width: null, height: null, duration: null,
        credit: 'NASA', link: `https://images.nasa.gov/details/${d.nasa_id}`,
      };
    }));
    return resolved.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
  },
};

async function resolveNasaAsset(manifestUrl, apiMedia) {
  let files;
  try { files = await (await httpGet(manifestUrl)).json(); } catch { return null; }
  const urls = (files || []).filter((u) => typeof u === 'string');
  if (apiMedia === 'video') {
    const mp4s = urls.filter((u) => u.toLowerCase().endsWith('.mp4'));
    for (const m of ['~medium', '~small', '~mobile', '~orig']) {
      const hit = mp4s.find((u) => u.toLowerCase().includes(m));
      if (hit) return hit;
    }
    return mp4s[0] || null;
  }
  const imgs = urls.filter((u) => /\.(jpe?g|png)$/i.test(u));
  for (const m of ['~large', '~orig', '~medium']) {
    const hit = imgs.find((u) => u.toLowerCase().includes(m));
    if (hit) return hit;
  }
  return imgs[0] || null;
}

// Wikimedia Commons: photos only, keyless. Filtered to a commercial-safe
// license allowlist; CC BY(-SA) results are flagged attribution-required.
const WM_LICENSE_OK = /^(public domain|pd|no restrictions|cc0|cc[ -]by(?![ -]nc|[ -]nd)[\w.\- ]*)/i;
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();

const wikimedia = {
  configured: () => true,
  async search(query, { perPage, mediaType }) {
    if (mediaType !== 'photo') return [];
    const q = query.replace(/^\s*(a\s+)?(portrait|photo|picture|image)s?\s+of\s+/i, '');
    const limit = Math.min(perPage, 12);
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', generator: 'search',
      gsrsearch: `filetype:bitmap ${q}`, gsrnamespace: '6', gsrlimit: String(limit * 3),
      prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1920',
    });
    const data = await (await httpGet(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA } })).json();
    const pages = ((data.query || {}).pages) || [];
    const out = [];
    for (const page of pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99))) {
      const info = (page.imageinfo || [{}])[0];
      const meta = info.extmetadata || {};
      const license = stripTags((meta.LicenseShortName || {}).value);
      if (!WM_LICENSE_OK.test(license)) continue;
      const width = info.width || 0;
      if (width < 640) continue;
      const download = info.thumburl || info.url;
      if (!download) continue;
      out.push({
        id: `wikimedia-${page.pageid}`, provider: 'wikimedia', type: 'photo',
        thumb: download, download,
        width: info.thumbwidth || width, height: info.thumbheight || info.height || 0, duration: null,
        credit: (stripTags((meta.Artist || {}).value) || 'Wikimedia Commons').slice(0, 120),
        link: info.descriptionurl || '',
        license, attributionRequired: /^cc by/i.test(license),
      });
      if (out.length >= limit) break;
    }
    return out;
  },
};

// logo.dev: company logos, photo-intent only, and only when the query is
// explicitly a logo request. Editorial use — trademarks, not royalty-free.
const LOGO_INTENT = /\blogos?\b/i;
const LOGO_STRIP = /\b(logos?|of|the|company|brand|official)\b/gi;

const logodev = {
  configured: () => Boolean(config.logoDevToken),
  async search(query, { mediaType }) {
    if (mediaType !== 'photo' || !LOGO_INTENT.test(query)) return [];
    const company = query.replace(LOGO_STRIP, ' ').replace(/\s+/g, ' ').trim();
    if (!company) return [];
    const domain = await resolveLogoDomain(company);
    if (!domain) return [];
    const download = `https://img.logo.dev/${domain}?token=${config.logoDevToken}&size=512&format=png`;
    // Probe so a parked/unknown domain never becomes a broken asset.
    let probe;
    try { probe = await httpGet(download); } catch { return []; }
    if (!(probe.headers.get('content-type') || '').includes('image')) return [];
    return [{
      id: `logodev-${domain}`, provider: 'logodev', type: 'photo',
      thumb: download, download, width: 512, height: 512, duration: null,
      credit: `${company} logo — trademark of its owner (editorial use)`,
      link: `https://${domain}`,
    }];
  },
};

async function resolveLogoDomain(company) {
  if (config.logoDevSecret) {
    try {
      const r = await httpGet(`https://api.logo.dev/search?q=${encodeURIComponent(company)}`,
        { headers: { Authorization: `Bearer ${config.logoDevSecret}` } });
      const hits = await r.json();
      return hits?.[0]?.domain || null;
    } catch { return null; }
  }
  const guess = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  return guess ? `${guess}.com` : null;
}

const PROVIDERS = { logodev, pexels, pixabay, nasa, wikimedia };

// Round-robin by provider so no single source dominates the top of the grid,
// visiting providers in priority order.
function interleave(items) {
  const byProvider = new Map(ORDER.map((n) => [n, []]));
  for (const it of items) byProvider.get(it.provider)?.push(it);
  const lists = ORDER.map((n) => byProvider.get(n)).filter((l) => l.length);
  const max = Math.max(0, ...lists.map((l) => l.length));
  const out = [];
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}
