# Squook — landing page → video (public MVP image).
# One service: the Express API + the built webapp + Claude Code + HyperFrames.
# The prompt pipeline (CrewAI + Ollama + Remotion) is not included: LANDING_ONLY.

# ---- webapp build ---------------------------------------------------------
FROM node:22-bookworm-slim AS web
# The fast-mode page plays videos live by importing the Remotion templates from
# ../renderer/src (vite alias), so the renderer and its deps sit beside it.
COPY renderer/package*.json /renderer/
RUN cd /renderer && npm ci
COPY renderer/src /renderer/src
WORKDIR /web
COPY webapp/package*.json ./
RUN npm ci
COPY webapp/ ./
# Public values baked into the browser bundle (Railway passes service
# variables with these names as build args).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_LANDING_ONLY=true
RUN npm run build

# ---- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim
# ffmpeg + git for HyperFrames, the libraries headless Chrome needs, fonts for
# rendering, python for the local Kokoro voice.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg git ca-certificates curl python3 python3-pip \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 libx11-xcb1 libxshmfence1 \
      fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages kokoro-onnx soundfile
RUN npm install -g @anthropic-ai/claude-code hyperframes@0.8.150

# Never run the agent as root.
USER node
ENV HOME=/home/node
# Pre-fetch the render browser and the HyperFrames workflow skills so the
# first video doesn't pay for it.
RUN hyperframes browser ensure \
 && hyperframes skills update product-launch-video motion-graphics

WORKDIR /app
COPY --chown=node server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY --chown=node server/ server/
COPY --chown=node .agents/ .agents/
COPY --chown=node .claude/skills/ .claude/skills/
COPY --from=web --chown=node /web/dist webapp/dist
# Fast mode renders its MP4s with Remotion (and screenshots sites with its Chrome).
COPY --chown=node renderer/package*.json renderer/
RUN cd renderer && npm ci && npx remotion browser ensure
COPY --chown=node renderer/ renderer/
RUN mkdir -p renderer/public renderer/out

# Skills are baked in above (skip the per-run refresh); local Kokoro voice.
ENV NODE_ENV=production PIPELINE_MODE=real LANDING_ONLY=true PORT=8787 \
    HF_SKILLS_PREINSTALLED=1 HF_TTS_PROVIDER=kokoro
EXPOSE 8787
CMD ["node", "server/src/index.js"]
