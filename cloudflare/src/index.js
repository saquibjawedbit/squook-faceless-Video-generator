import { Container, getContainer } from '@cloudflare/containers';

// Squook on Cloudflare: one Container runs the whole app image (API + webapp +
// Claude Code + HyperFrames, see ../Dockerfile). This Worker just forwards
// every request to it. A single instance, because jobs queue in memory.

// Secrets/vars the container needs (set with `wrangler secret put` / vars).
const PASS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_BUCKET',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_MODEL', 'ANTHROPIC_API_KEY',
  'LANDING_ONLY', 'LANDING_DAILY_LIMIT', 'LANDING_GLOBAL_DAILY_LIMIT', 'LANDING_TIMEOUT_MIN', 'LANDING_UNLIMITED_EMAILS', 'MUSIC_BASE_URL',
  'PIPELINE_MODE', 'ALLOW_ANON', 'SALES_LINK', 'SALES_PRICE',
];

export class SquookApp extends Container {
  defaultPort = 8787;
  sleepAfter = '15m';
  enableInternet = true; // the agent captures sites and installs HyperFrames skills

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = Object.fromEntries(PASS.filter((k) => env[k] != null && env[k] !== '').map((k) => [k, String(env[k])]));
  }

  // Idle timer ran out: stay up while a video is still being made (renders take
  // 10–30 min and the viewer may have closed the tab), otherwise sleep.
  async onActivityExpired() {
    try {
      const r = await this.containerFetch('http://container/api/health');
      if (r.ok && (await r.json()).busy) { this.renewActivityTimeout(); return; }
    } catch { /* not answering → let it stop */ }
    await this.stop();
  }
}

export default {
  async fetch(request, env) {
    return getContainer(env.SQUOOK, 'main').fetch(request);
  },
};
