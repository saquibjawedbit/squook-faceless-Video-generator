# Squook — Architecture

Four codebases: `webapp/` (React UI), `server/` (Node/Express orchestrator), `guide_creator_flow/` (Python CrewAI generation flow), `renderer/` (Remotion project). The **IR JSON** (`render_ir.json`) is the central contract: the Python flow produces it, the Remotion renderer consumes it, and the editor + edit agents mutate it.

## 1. System overview

```mermaid
flowchart TB
    subgraph CLIENT["Webapp — React + Vite, hash router"]
        HOME["SquookHome<br/>prompt · format 16:9/9:16 · length<br/>preset picker · voice picker · uploads"]
        REVIEW["ScriptReview<br/>edit narration + on-screen text<br/>AI revise bar"]
        EDITOR["SquookEditor<br/>MP4 preview in plain video tag<br/>IR-derived timeline/layers/inspector<br/>mutateIr → retimeLocal → undo → autosave"]
        APILIB["lib/api.js — REST + SSE client"]
        HOME --> REVIEW
        REVIEW --> APILIB
        EDITOR --> APILIB
        HOME --> APILIB
    end

    subgraph SRV["Server — Node/Express :8787"]
        IDX["index.js — /api routes<br/>Supabase JWT auth"]
        JOBS["jobs.js — single-worker FIFO queue<br/>kinds: generate · rerender · revoice"]
        PIPE["pipeline.js — spawns stages<br/>directing → rendering → mastering"]
        AIE["aiEdit.js — runAiEdit<br/>ops-DSL · sanitizers · retime"]
        DIR["directorAgent.js — squook-director<br/>ToolLoopAgent, max 6 steps"]
        SREV["scriptRevise.js — reviseScript"]
        PRE["presets.js — builtin + custom bundles"]
        STK["stock.js + icons.js"]
        SNAPJ["snapshot.js + ir.js<br/>snapshot/restore · validateIr · retime"]
        CHATS["chatStore.js — per-project chat JSONL"]
        IDX --> JOBS
        JOBS --> PIPE
        IDX --> AIE
        IDX --> DIR
        IDX --> SREV
        IDX --> PRE
        IDX --> SNAPJ
        DIR --> CHATS
        DIR --> STK
        DIR -.reuses ops-DSL + applyOps.-> AIE
    end

    subgraph PY["guide_creator_flow — Python CrewAI Flow"]
        CF["ContentFlow — main.py<br/>plan_content → generate_content →<br/>narration ∥ assets → music → compile_ir → save_content"]
        CREW["ContentCrew — sequential<br/>researcher → writer → director → asset_curator"]
        IRB["ir_builder.py — 3-pass IR compiler<br/>estimate → LLM treatment → resolve_ir"]
        PTOOLS["tools/ — tts (Kokoro/OpenAI) · sfx synth ·<br/>music bed + ducking · stock · icons · mastering"]
        CRIT["critique.py — render still → Claude vision<br/>keep/revise loop (opt-in)"]
        REVO["revoice.py — re-synth narration per voice"]
        CF --> CREW
        CF --> IRB
        CF --> PTOOLS
        CF --> CRIT
    end

    subgraph REND["renderer — Remotion 4.0.484"]
        COMP["Composition 'Explainer'<br/>Root → MainVideo → SceneRenderer"]
        LAY["Layer types: video · image · solid · audio · text ·<br/>captions · graphic · shader · motion · lottie"]
        GFX["Graphic kinds: node_graph · bar_chart · counter ·<br/>icon_row · title_card · annotate"]
        IRJSON[("public/render_ir.json<br/>+ assets/ audio/ lottie/")]
        OUTMP4[("out/video.mp4 → out/final.mp4")]
        IRJSON --> COMP
        COMP --> LAY
        LAY --> GFX
        COMP --> OUTMP4
    end

    subgraph EXT["External services"]
        OLL["Ollama<br/>gpt-oss:120b-cloud + gpt-oss:20b fast_llm"]
        CLD["Claude claude-opus-4-8<br/>design LLM + vision critique — opt-in"]
        TTSX["Kokoro-82M local TTS<br/>or OpenAI tts-1-hd"]
        SB["Supabase — Auth · Postgres · Storage"]
        STOCKP["Pexels · Pixabay · NASA · Wikimedia · logo.dev"]
        ICOP["Iconify icons · LottieFiles"]
        HFP["HF MusicGen — opt-in, non-commercial weights"]
        SERP["Serper web search — opt-in"]
    end

    ART[("server/artifacts/<br/>id.mp4 · id.jpg · id.ir.json ·<br/>id-assets/ · id.chat.jsonl")]

    APILIB -->|REST + SSE| IDX
    PIPE -->|"uv run run_with_trigger"| CF
    PIPE -->|"npx remotion render Explainer --scale 0.5"| COMP
    PIPE -->|"uv run master — LUFS normalize + mux"| PTOOLS
    JOBS -->|"uv run revoice"| REVO
    CF -->|"_sync_renderer copies output/"| IRJSON
    PIPE --> ART
    SNAPJ <--> ART
    CHATS --> ART

    CREW --- OLL
    AIE --- OLL
    DIR --- OLL
    SREV --- OLL
    IRB --- OLL
    IRB -.design_llm opt-in.- CLD
    CRIT -.vision.- CLD
    PTOOLS --- TTSX
    PTOOLS --- STOCKP
    PTOOLS --- ICOP
    PTOOLS -.MUSICGEN_OPTIN.- HFP
    CREW -.RESEARCH_WEB.- SERP
    IDX --- SB
    STK --- STOCKP
    STK --- ICOP
```

## 2. Prompt → Video (generation pipeline)

```mermaid
sequenceDiagram
    actor U as User
    participant W as Webapp
    participant S as Server (Express)
    participant Q as jobs.js queue
    participant F as ContentFlow (Python)
    participant A as ContentCrew agents
    participant R as Remotion CLI

    U->>W: Prompt + format + length + preset + voice + files
    W->>S: POST /api/script/preview
    S->>F: uv run run_with_trigger (preview=true)
    F->>F: plan_content — intent inference via fast_llm
    F->>A: researcher → writer → director → asset_curator
    A-->>F: DirectionScript + AssetPlan (pydantic)
    F-->>S: output/preview_script.json
    S-->>W: {script, asset_plan} → ScriptReview screen

    opt AI script revision
        U->>W: revise instruction
        W->>S: POST /api/script/revise
        S->>S: scriptRevise.js → Ollama chatJSON
        S-->>W: rewritten scenes (count preserved)
    end

    U->>W: Approve script
    W->>S: POST /api/projects (multipart + editedScript + assetPlan)
    S->>Q: enqueueProject — kind generate
    W->>S: poll GET /api/projects/:id every 1.5s

    Note over Q,F: stage 1 — directing
    Q->>F: uv run run_with_trigger (full payload)
    Note over F: generate_content SKIPS the crew when<br/>editedScript present — uses user's words verbatim
    par narration
        F->>F: generate_narration — Kokoro/OpenAI TTS per scene
    and assets
        F->>F: fetch_assets — stock + Lottie + icons
    end
    F->>F: fetch_music — synth bed (ducked -8dB) or MusicGen
    F->>F: compile_ir — Technical Director + Design Director +<br/>Motion Graphics Designer → ir_builder.resolve_ir
    F->>F: save_content + optional critique loop (Claude vision)
    F-->>R: _sync_renderer → renderer/public/render_ir.json + media

    Note over Q,R: stage 2 — rendering
    Q->>R: npx remotion render Explainer out/video.mp4 --scale 0.5
    R-->>Q: draft MP4 (half scale)

    Note over Q,F: stage 3 — mastering
    Q->>F: uv run master — two-pass LUFS -14 + AAC remux
    F-->>Q: out/final.mp4

    Q->>S: copy artifacts/id.mp4 + thumb + snapshotProject(IR + assets)
    S-->>W: status done
    W->>S: GET /url + GET /ir
    W-->>U: Editor opens — MP4 preview + editable IR
```

## 3. Agents, models, and tools

```mermaid
flowchart LR
    subgraph MODELS["LLM providers"]
        L120["Ollama gpt-oss:120b-cloud<br/>(OLLAMA_MODEL)"]
        L20["Ollama gpt-oss:20b-cloud<br/>(FAST_LLM_MODEL)"]
        CLA["Claude claude-opus-4-8<br/>(DESIGN_LLM_PROVIDER / DESIGN_CRITIQUE)"]
    end

    subgraph CREWA["ContentCrew — CrewAI sequential"]
        RES["Researcher<br/>tool: SerperDevTool (RESEARCH_WEB)"]
        WRI["Writer"]
        DIRC["Creative Video Director<br/>→ DirectionScript"]
        CUR["Asset Curator<br/>→ AssetPlan"]
        RES --> WRI --> DIRC --> CUR
    end

    subgraph ADHOC["ir_builder ad-hoc agents"]
        INT["Intent inference<br/>aspect/duration/voice/music"]
        TECH["Technical Director<br/>→ RenderPlan per scene"]
        DES["Design Director<br/>→ theme: mood/palette/font"]
        MOG["Motion Graphics Designer<br/>→ GraphicSpec / custom motion"]
    end

    subgraph SRVA["Server edit agents"]
        EDT["aiEdit — runAiEdit<br/>part / layer / global ops contracts"]
        DAG["Director chat agent — ToolLoopAgent<br/>tools: inspect_ir · propose_edit · add_stock ·<br/>set_icons · compose_animation · set_shader"]
        SRA["Script reviser — chatJSON"]
    end

    VIS["critique.py vision critique<br/>render still → keep/revise"]

    L120 --> RES & WRI & DIRC & CUR
    L120 --> EDT & DAG & SRA
    L120 -->|default| DES & MOG
    L20 --> INT & TECH
    CLA -.opt-in.-> DES & MOG
    CLA -.opt-in.-> VIS
```

## 4. Prompt → Edit (editor + Director agent)

```mermaid
sequenceDiagram
    actor U as User
    participant E as SquookEditor
    participant S as Server
    participant D as Director agent (ToolLoopAgent)
    participant O as Ollama gpt-oss:120b

    Note over E: loads MP4 (GET /url) + IR (GET /ir)<br/>timeline/layers derived from IR (irView.deriveView)

    rect rgb(240,240,240)
        Note over U,O: Path A — Director chat (conversational, tool loop)
        U->>E: "make scene 2 punchier"
        E->>S: POST /api/projects/:id/chat/stream (SSE)<br/>message + IR + selection description
        S->>D: runDirectorChatStream + chat JSONL history
        loop max 6 steps or until proposal
            D->>O: turn (system: film-editor persona + OPS_DOCS)
            O-->>D: tool call
            alt inspect_ir
                D->>D: read IR at path
            else propose_edit
                D->>D: applyOps sandbox → retime → irDiff<br/>SUCCESS diff or REJECTED errors
            else add_stock / set_icons / compose_animation / set_shader
                D->>D: fetch stock/Iconify · build motion/shader layer (sanitized)
            end
        end
        S-->>E: SSE status → delta → done {reply, proposal: ir+summary+diff}
        U->>E: Apply proposal
        E->>S: PUT /api/projects/:id/ir + POST /chat/note (APPLIED)
    end

    rect rgb(240,240,240)
        Note over U,O: Path B — stateless AI edit
        E->>S: POST /api/projects/:id/edit {ir, instruction, selection}
        alt selection.part
            S->>O: restyle one part → {text?, style} (sanitizePartStyle)
        else selection (layer)
            S->>O: echo full layer → {layer} (sanitizeLayerPatch)
        else global
            S->>O: compactIr + OPS_SPEC → {ops[], summary}<br/>applyOps, 1 guided retry, else 422
        end
        S-->>E: {ir, summary} — retimed
    end

    Note over E: Manual edits: mutateIr → retimeLocal →<br/>undo history → debounced PUT /ir (900ms)

    opt Bake changes
        U->>E: Re-render / Export HD
        E->>S: POST /render {ir, quality: draft|hd}
        S->>S: queue rerender — restoreProject snapshot →<br/>npx remotion render Explainer → uv run master
    end

    opt Change voice
        U->>E: pick voice
        E->>S: PUT /ir then POST /revoice {voice}
        S->>S: queue revoice — uv run revoice →<br/>scene_N.voice.wav + rewritten captions/timing
    end
```

## 5. Ops-DSL (the edit contract)

Applied by `applyOps` in `server/src/aiEdit.js` (max 20 ops, whitelisted + clamped, every path ends in `retime`):

| Op | Effect |
|---|---|
| `set_layer` | Patch editable fields of one layer (`src`/`words` untouchable) |
| `set_scene` | duration_s, narration, transition_out |
| `set_theme` | palette + font sizes |
| `set_music` | volume or remove |
| `reorder_scenes` | full permutation only |
| `remove_scene` / `remove_layer` | delete (never the last scene) |
| `add_layer` | text/solid/video/image — media must reuse existing project files |

## 6. Key env vars

| Var | Effect |
|---|---|
| `PIPELINE_MODE=real` | run the actual flow (default `mock`) |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `FAST_LLM_MODEL` | LLM endpoints/models |
| `DESIGN_LLM_PROVIDER=claude` + `ANTHROPIC_API_KEY` | Claude for design agents |
| `DESIGN_CRITIQUE=true` (+ `DESIGN_CRITIQUE_MODEL`, `_MAX`) | vision critique loop |
| `OPENAI_API_KEY` | OpenAI TTS over local Kokoro |
| `MUSICGEN_OPTIN=true` + `HF_TOKEN` | MusicGen track (non-commercial weights) |
| `RESEARCH_WEB=true` + `SERPER_API_KEY` | researcher web search |
| `SUPABASE_URL` / keys | auth + persistence + storage |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` / `LOGO_DEV_TOKEN` | stock providers |
