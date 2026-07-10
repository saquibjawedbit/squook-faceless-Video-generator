#!/usr/bin/env python
import json
import math
import os
import shutil
import sys
import time
from pathlib import Path

from pydantic import BaseModel

from crewai.flow import Flow, and_, listen, start

from guide_creator_flow import ir_builder
from guide_creator_flow.crews.content_crew.content_crew import (
    AssetPlan,
    ContentCrew,
    DirectionScript,
)
from guide_creator_flow.tools import lottie, music, musicgen, sfx, stock, tts

DEFAULT_PROMPT = "AI Agents"

# Wall-clock per flow stage, printed as '⏱ stage ... took Ns' so slow parts
# are visible in every run's log.
_CLOCK = {"last": None}


def _mark(stage: str) -> None:
    now = time.monotonic()
    if _CLOCK["last"] is not None:
        prev_stage, t = _CLOCK["prev"], now - _CLOCK["last"]
        print(f"⏱ stage '{prev_stage}' took {t:.0f}s")
    _CLOCK["last"] = now
    _CLOCK["prev"] = stage

PRESETS = {
    "landscape": {
        "width": 1920,
        "height": 1080,
        "orientation": None,
        "word_count": "300-500",
        "runtime": "60-90 seconds",
    },
    "reel": {
        "width": 1080,
        "height": 1920,
        "orientation": "portrait",
        "word_count": "100-140",
        "runtime": "45-60 seconds",
    },
}


class ContentState(BaseModel):
    prompt: str = ""
    preset: str = "landscape"
    script: dict = {}
    asset_plan: list = []
    render_ir: dict = {}
    direction_script: str = ""
    # Production settings — explicit (payload/CLI) or inferred from the prompt.
    music: str = ""              # beat | warm | score | none | "" (no music)
    voice: str = ""              # tts voice id (nova | atlas | juno | …)
    duration_s: int = 0          # target runtime; 0 = the preset's default
    sfx: bool = False            # transition/impact sound design — prompt opt-in
    uploads: list = []           # [{path, name, type}] — the user's own footage
    # Attribution for a fetched CC track (required credit); empty for the
    # synthesised bed, which is ours and needs none.
    music_credit: dict = {}


# The composer's music chips map onto the synthesised bed moods (music.MOODS).
MUSIC_CHOICE_MOODS = {
    "beat": "uplifting",
    "warm": "warm",
    "score": "calm",
}

# Where a fetched (real) music track lands, if the Asset stage sources one.
MUSIC_TRACK = "output/audio/music_track.mp3"

_VOICE_IDS = ("nova", "atlas", "juno", "ryan", "sonia", "guy", "none")
_MUSIC_IDS = ("beat", "warm", "score", "none")


def _infer_intent(prompt: str) -> dict:
    """Pull the production settings out of the prompt itself — the composer
    has no knobs, so "a 5 minute vertical explainer with calm piano and no
    voiceover" must carry everything. One LLM call; anything the prompt
    doesn't specify comes back null and falls to the defaults."""
    import json as _json
    import re as _re

    from guide_creator_flow.crews.content_crew.content_crew import llm

    ask = (
        "Extract production settings from this video request. Respond with RAW JSON ONLY:\n"
        '{"aspect": "9:16"|"16:9"|null, "duration_s": <int seconds>|null, '
        '"voice": "nova"|"atlas"|"juno"|"ryan"|"sonia"|"guy"|"none"|null, '
        '"music": "beat"|"warm"|"score"|"none"|null, "sfx": true|false}\n'
        "Set a field ONLY when the request clearly implies it; otherwise null.\n"
        '- aspect: reel/short/TikTok/vertical/story → "9:16"; YouTube/landscape/widescreen → "16:9".\n'
        '- duration_s: "5 minute video" → 300, "about 30s" → 30.\n'
        '- voice: "no voiceover/silent" → "none"; a US female narrator → "nova", US male → "atlas", '
        'energetic female → "juno", British male → "ryan", British female → "sonia".\n'
        '- music: "no music" → "none"; upbeat/energetic/beat → "beat"; acoustic/organic/warm → "warm"; '
        'calm/piano/cinematic score → "score".\n'
        '- sfx: true ONLY when sound effects / whooshes / impacts are asked for.\n'
        f'Request: "{prompt[:600]}"'
    )
    text = str(llm.call(ask)).strip()
    fence = _re.search(r"```(?:json)?\s*(.*?)```", text, _re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    data = _json.loads(text)
    out = {}
    if data.get("aspect") in ("9:16", "16:9"):
        out["preset"] = "reel" if data["aspect"] == "9:16" else "landscape"
    try:
        d = int(data.get("duration_s") or 0)
        if d > 0:
            out["duration_s"] = max(10, min(600, d))
    except (TypeError, ValueError):
        pass
    if data.get("voice") in _VOICE_IDS:
        out["voice"] = data["voice"]
    if data.get("music") in _MUSIC_IDS:
        out["music"] = data["music"]
    out["sfx"] = bool(data.get("sfx"))
    return out


def _music_plan(ui_music: str, brief: dict) -> tuple[bool, str, str]:
    """Resolve the final music decision. Audio is opt-in: music plays ONLY
    when the prompt asked for it (parsed into a music id by intent
    inference); the Director's brief just refines mood/search wording.
    Returns (needed, mood_hint, search_query)."""
    ui = (ui_music or "").lower()
    brief = brief or {}
    desc = (brief.get("description") or "").strip()
    if ui in MUSIC_CHOICE_MOODS:          # the prompt asked for music → play it
        mood = MUSIC_CHOICE_MOODS[ui]
        return True, mood, " ".join(filter(None, [mood, desc])).strip()
    # "none" or unspecified → silence under the narration.
    return False, "", ""


def _match_upload(query: str, uploads: list) -> dict | None:
    """Resolve an asset-curator 'upload' query back to an uploaded file.
    The curator is handed the exact filenames, so match on name first, then
    fall back to a loose substring match."""
    q = (query or "").strip().lower()
    if not q:
        return None
    for u in uploads:
        if (u.get("name") or "").strip().lower() == q:
            return u
    for u in uploads:
        name = (u.get("name") or "").strip().lower()
        if name and (q in name or name in q):
            return u
    return None


class ContentFlow(Flow[ContentState]):

    @start()
    def plan_content(self, crewai_trigger_payload: dict = None):
        _mark("plan_content")
        print("Planning content")
        # Warm Kokoro (torch + weights, ~10s) in the background while the
        # crew writes — narration then starts instantly.
        import threading
        threading.Thread(target=tts.warmup, daemon=True).start()

        # Fresh workspace: previous runs' media otherwise accumulates in
        # output/ and gets re-copied to the renderer on every save (measured
        # 45s of pure stale-file copying). The SFX kit stays — deterministic.
        for sub in ("assets", "lottie"):
            shutil.rmtree(Path("output") / sub, ignore_errors=True)
        audio = Path("output/audio")
        if audio.is_dir():
            for f in audio.glob("scene_*.wav"):
                f.unlink(missing_ok=True)
            for name in ("music_bed.wav", "music_track.mp3"):
                (audio / name).unlink(missing_ok=True)

        explicit_preset = None
        if crewai_trigger_payload:
            self.state.prompt = crewai_trigger_payload.get("prompt", DEFAULT_PROMPT)
            p = crewai_trigger_payload.get("preset") or ""
            if p and p in PRESETS:
                explicit_preset = p
            elif p:
                print(f"Unknown preset '{p}'; will infer from the prompt")
            self.state.music = (crewai_trigger_payload.get("music") or "").lower()
            self.state.voice = (crewai_trigger_payload.get("voice") or "").lower()
            # Legacy payloads carried duration as "15s"/"30s".
            d = str(crewai_trigger_payload.get("duration") or "")
            if d.rstrip("s").isdigit():
                self.state.duration_s = int(d.rstrip("s"))
            self.state.uploads = crewai_trigger_payload.get("uploads") or []
            print(f"Using trigger payload: {crewai_trigger_payload}")
        else:
            if len(sys.argv) > 1:
                self.state.prompt = sys.argv[1]
            else:
                self.state.prompt = DEFAULT_PROMPT
            if len(sys.argv) > 2 and sys.argv[2] in PRESETS:
                explicit_preset = sys.argv[2]

        # There are no composer knobs — the prompt IS the brief. Whatever the
        # caller didn't pin explicitly gets read out of the prompt; anything
        # the prompt doesn't say falls to defaults (landscape, auto voice,
        # Director-decided music, preset runtime).
        try:
            intent = _infer_intent(self.state.prompt)
        except Exception as e:
            print(f"Intent inference unavailable ({e}); using defaults")
            intent = {}
        self.state.preset = explicit_preset or intent.get("preset") or "landscape"
        self.state.voice = self.state.voice or intent.get("voice", "")
        self.state.music = self.state.music or intent.get("music", "")
        self.state.duration_s = self.state.duration_s or intent.get("duration_s", 0)
        self.state.sfx = bool(intent.get("sfx"))

        print(
            f"Prompt: {self.state.prompt} | Preset: {self.state.preset}"
            + (f" | ~{self.state.duration_s}s" if self.state.duration_s else "")
            + (f" | voice={self.state.voice}" if self.state.voice else "")
            + (f" | music={self.state.music}" if self.state.music else "")
        )

    @listen(plan_content)
    def generate_content(self):
        _mark("generate_content")
        print(f"Generating content for: {self.state.prompt}")
        preset = dict(PRESETS[self.state.preset])
        # A prompt-specified runtime overrides the preset's default targets.
        # Narration lands around 2.0–2.6 words/second at Kokoro's pace.
        if self.state.duration_s:
            d = self.state.duration_s
            preset["runtime"] = f"about {d} seconds"
            preset["word_count"] = f"{int(d * 2.0)}-{int(d * 2.6)}"
            print(f"Runtime target from prompt: ~{d}s → {preset['word_count']} words")

        # Tell the crew about the user's own footage so the writer can lean on
        # it and the asset-curator can assign it to scenes instead of stock.
        upload_names = [u.get("name") for u in self.state.uploads if u.get("name")]
        if upload_names:
            uploads_brief = (
                "The user uploaded these files to use in this video: "
                + ", ".join(upload_names)
                + ". Prefer them for scenes where they fit."
            )
        else:
            uploads_brief = "The user did not upload any of their own footage."
        music_brief = self.state.music or "auto"

        # A local model occasionally emits a directing script that fails
        # validation; that's a dice roll, not a config problem, so one fresh
        # attempt rescues the run instead of failing the whole generation.
        script = None
        for attempt in (1, 2):
            result = (
                ContentCrew()
                .crew()
                .kickoff(inputs={
                    "prompt": self.state.prompt,
                    "word_count": preset["word_count"],
                    "runtime": preset["runtime"],
                    "uploads": uploads_brief,
                    "music": music_brief,
                })
            )
            for task_output in result.tasks_output:
                if isinstance(task_output.pydantic, DirectionScript):
                    script = task_output.pydantic
            if script is not None:
                break
            print(f"Directing task did not produce a valid DirectionScript (attempt {attempt})")
        if script is None:
            raise RuntimeError("Directing task did not produce a valid DirectionScript")
        print("Direction script generated")

        # Strip any direction the director leaked into the spoken line (section
        # labels, bracketed cues, markdown) so it never reaches the voice-over,
        # the captions, or the duration estimate. Visual/production intent stays
        # in `scene.visual`, which we leave untouched.
        for scene in script.scenes:
            scene.narration = tts.sanitize_narration(scene.narration)

        # Director-guessed durations are fiction; retime from the narration
        # (word-count estimate until real TTS audio lengths replace it).
        for scene in script.scenes:
            scene.duration_seconds = ir_builder.estimate_narration_seconds(scene.narration)
        script.metadata.prompt = self.state.prompt
        script.metadata.scene_count = len(script.scenes)
        script.metadata.total_duration_seconds = sum(
            scene.duration_seconds for scene in script.scenes
        )
        self.state.script = script.model_dump()

        if isinstance(result.pydantic, AssetPlan):
            self.state.asset_plan = result.pydantic.model_dump()["assets"]
        else:
            print("Warning: asset task did not produce a valid AssetPlan, skipping assets")
            self.state.asset_plan = []

    @listen(generate_content)
    def generate_narration(self):
        _mark("generate_narration")
        # "none" = no voiceover: keep the word-count durations, no audio track.
        if self.state.voice == "none":
            print("Voiceover disabled by user choice (no narration audio)")
            for scene in self.state.script["scenes"]:
                scene["audio"] = None
            return
        voice_id = self.state.voice or tts.DEFAULT_VOICE_ID
        print(f"Generating narration audio ({voice_id}) for {len(self.state.script['scenes'])} scenes")
        audio_dir = Path("output/audio")
        done = 0
        for scene in self.state.script["scenes"]:
            scene["audio"] = None
            if not tts.clean_narration(scene["narration"]):
                continue  # visual-only beat: no audio, minimum duration applies
            out_path = audio_dir / f"scene_{scene['index']}.wav"
            try:
                audio_len, words = tts.synthesize(scene["narration"], out_path, voice_id=voice_id)
            except Exception as e:
                out_path.unlink(missing_ok=True)
                print(f"  scene {scene['index']}: TTS failed ({e}); keeping word-count estimate")
                continue
            scene["audio"] = {
                "src": str(out_path),
                "duration_s": round(audio_len, 2),
                "words": words,
            }
            scene["duration_seconds"] = max(3, math.ceil(audio_len + 0.6))
            done += 1
        self.state.script["metadata"]["total_duration_seconds"] = sum(
            s["duration_seconds"] for s in self.state.script["scenes"]
        )
        print(f"Narration generated: {done}/{len(self.state.script['scenes'])}")

    @listen(generate_content)
    def fetch_assets(self):
        _mark("fetch_assets")
        print(f"Fetching assets for {len(self.state.asset_plan)} scenes")
        assets_dir = Path("output/assets")
        scenes_by_index = {scene["index"]: scene for scene in self.state.script["scenes"]}
        for scene in scenes_by_index.values():
            scene["asset"] = None

        fetched = 0
        stock_ok = True   # flips off once we learn no stock provider is configured
        used_hits = set()  # ids/page-urls already assigned — no clip twice per video
        stock_jobs = []    # (entry, scene) pairs resolved in one batched pass
        for entry in self.state.asset_plan:
            scene = scenes_by_index.get(entry["scene_index"])
            if scene is None:
                continue
            if entry["media_type"] == "upload":
                # The curator picked one of the user's own uploaded files.
                match = _match_upload(entry.get("query", ""), self.state.uploads)
                if match is None:
                    print(f"  scene {entry['scene_index']}: no matching upload for "
                          f"'{entry.get('query')}'; falling back to graphic")
                    entry["media_type"] = "graphic"
                    continue
                ext = (Path(match["name"]).suffix.lstrip(".") or "bin").lower()
                local_path = assets_dir / f"scene_{entry['scene_index']}.{ext}"
                try:
                    assets_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(match["path"], local_path)
                except Exception as e:
                    print(f"  scene {entry['scene_index']}: upload copy failed ({e}); "
                          f"falling back to graphic")
                    entry["media_type"] = "graphic"
                    continue
                is_video = (str(match.get("type", "")).startswith("video")
                            or ext in ("mp4", "mov", "webm", "m4v", "mkv"))
                scene["asset"] = {
                    "media_type": "video" if is_video else "photo",
                    "query": match["name"],
                    "local_path": str(local_path),
                    "source_url": "",
                    "page_url": "",
                    "credit": "user upload",
                    "clip_duration_s": None,  # unknown -> video layer loops to fit
                    "width": None,
                    "height": None,
                }
                fetched += 1
                continue
            if entry["media_type"] == "graphic":
                continue  # rendered as motion graphics, nothing to fetch
            if entry["media_type"] == "lottie":
                try:
                    hit = lottie.search(entry["query"])
                    if hit is None:
                        raise ValueError("no result")
                    local_path = Path("output/lottie") / f"scene_{entry['scene_index']}.json"
                    lottie.download(hit["json_url"], local_path)
                    scene["asset"] = {
                        "media_type": "lottie",
                        "query": entry["query"],
                        "name": hit["name"],
                        "local_path": str(local_path),
                        "source_url": hit["json_url"],
                        "page_url": hit["page_url"],
                    }
                    fetched += 1
                except Exception as e:
                    # Fall back to a designed graphic so the scene never goes bare.
                    print(f"  scene {entry['scene_index']}: lottie failed ({e}); falling back to graphic")
                    entry["media_type"] = "graphic"
                continue
            # Stock scenes are collected and resolved together below — one
            # batched ranking call instead of an LLM round-trip per scene.
            stock_jobs.append((entry, scene))

        preset = PRESETS[self.state.preset]
        hits = {}
        if stock_jobs and stock_ok:
            requests = [{
                "key": entry["scene_index"],
                "query": entry["query"],
                "media_type": entry["media_type"],
                "orientation": preset["orientation"],
                "visual": scene.get("visual", ""),
                "target": (preset["width"], preset["height"]),
            } for entry, scene in stock_jobs]
            try:
                hits = stock.search_batch(requests, exclude=used_hits)
            except stock.NoProvidersConfigured as e:
                print(f"Stock unavailable ({e}); stock scenes → graphics")
                stock_ok = False

        # Downloads are pure network wait — run them concurrently.
        from concurrent.futures import ThreadPoolExecutor

        def _fetch(job):
            entry, scene = job
            hit = hits.get(entry["scene_index"])
            if hit is None:
                return (entry, scene, None, None)
            local_path = assets_dir / f"scene_{entry['scene_index']}.{hit['ext']}"
            try:
                stock.download(hit["url"], local_path)
                return (entry, scene, hit, local_path)
            except Exception as e:
                print(f"  scene {entry['scene_index']}: download failed ({e})")
                return (entry, scene, None, None)

        if stock_jobs and stock_ok:
            with ThreadPoolExecutor(max_workers=4) as pool:
                outcomes = list(pool.map(_fetch, stock_jobs))
        else:
            outcomes = [(entry, scene, None, None) for entry, scene in stock_jobs]

        for entry, scene, hit, local_path in outcomes:
            if hit is None:
                print(f"  scene {entry['scene_index']}: no fitting result for '{entry['query']}'; falling back to graphic")
                entry["media_type"] = "graphic"
                continue
            scene["asset"] = {
                "media_type": entry["media_type"],
                "query": entry["query"],
                "local_path": str(local_path),
                "source_url": hit["url"],
                "page_url": hit["page_url"],
                "credit": hit["credit"],
                "clip_duration_s": hit["duration_s"],
                "width": hit["width"],
                "height": hit["height"],
                # CC BY sources make on-screen credit legally required.
                "license": hit.get("license", ""),
                "attribution_required": bool(hit.get("attribution_required")),
            }
            print(f"  scene {entry['scene_index']}: {hit['provider']} "
                  f"{entry['media_type']} ({hit.get('width')}x{hit.get('height')})")
            fetched += 1

        print(f"Assets fetched: {fetched}/{len(self.state.asset_plan)}")

    @listen(fetch_assets)
    def fetch_music(self):
        _mark("fetch_music")
        """Generate an original background track from the Director's brief with
        MusicGen (Hugging Face, Asset stage). The output is ours — no
        attribution. Falls back silently to a synthesised bed (in compile_ir)
        when music isn't wanted, no HF token is set, or generation fails."""
        track = Path(MUSIC_TRACK)
        track.unlink(missing_ok=True)  # never reuse a previous run's track
        self.state.music_credit = {}   # AI-generated music is ours — no credit
        brief = (self.state.script or {}).get("music") or {}
        needed, _mood, query = _music_plan(self.state.music, brief)
        if not needed:
            print("Music: not needed for this video")
            return
        # MusicGen's weights are CC-BY-NC (Meta) — NOT cleared for commercial
        # use. The owned synthesised bed is the default; MusicGen is opt-in
        # for non-commercial experiments only.
        if os.getenv("MUSICGEN_OPTIN", "").lower() != "true":
            print("Music: MusicGen skipped (CC-BY-NC weights, not commercial-safe); "
                  "using the owned synthesised bed")
            return
        # The Director's mood+description IS the text-to-music prompt.
        prompt = query or "calm ambient instrumental background music"
        total_s = int((self.state.script.get("metadata") or {}).get("total_duration_seconds") or 0)
        print(f"Music: generating an AI track (MusicGen) — '{prompt}'")
        try:
            musicgen.generate(prompt, track, duration_s=total_s or musicgen.MAX_DURATION_S)
            print(f"Music: generated {MUSIC_TRACK}")
        except musicgen.HFTokenMissing as e:
            print(f"Music: {e} Falling back to a synthesised bed.")
        except Exception as e:
            print(f"Music: generation failed ({e}); will synthesise a bed")

    @listen(and_(generate_narration, fetch_music))
    def compile_ir(self):
        _mark("compile_ir")
        print("Compiling render IR")
        scene_facts = [
            {
                "index": scene["index"],
                "duration_s": scene["duration_seconds"],
                "visual": scene["visual"],
                "on_screen_text": scene["on_screen_text"],
                "media": (scene.get("asset") or {}).get("media_type", "none"),
                "clip_duration_s": (scene.get("asset") or {}).get("clip_duration_s"),
            }
            for scene in self.state.script["scenes"]
        ]
        try:
            plan = ir_builder.compile_render_plan(scene_facts)
        except Exception as e:
            print(f"Technical Director failed ({e}); using default treatment")
            plan = ir_builder.RenderPlan(
                scenes=[ir_builder.default_scene_plan(f) for f in scene_facts]
            )

        graphic_indexes = {
            e["scene_index"] for e in self.state.asset_plan if e["media_type"] == "graphic"
        }
        graphic_facts = [
            {
                "index": scene["index"],
                "visual": scene["visual"],
                "narration": scene["narration"],
                "on_screen_text": scene["on_screen_text"],
            }
            for scene in self.state.script["scenes"]
            if scene["index"] in graphic_indexes
        ]
        print(f"Designing graphics for {len(graphic_facts)} scenes")
        graphics = ir_builder.design_graphics(graphic_facts)

        theme = ir_builder.build_theme(self.state.prompt)
        # Music ladder: honour the decision (user chip > Director brief); when
        # music is wanted, use the fetched track, else synthesise a bed.
        brief = (self.state.script or {}).get("music") or {}
        needed, mood_hint, _query = _music_plan(self.state.music, brief)
        music_src = None
        music_volume = ir_builder.MUSIC_VOLUME
        music_credit: dict = {}
        if not needed:
            print("Music: disabled for this video")
        elif Path(MUSIC_TRACK).exists():
            # A fetched commercial track is ~10 dB hotter than the synth bed, so
            # it plays at a lower gain to stay under the narration.
            music_src = MUSIC_TRACK
            music_volume = ir_builder.MUSIC_TRACK_VOLUME
            music_credit = self.state.music_credit or {}
            print(f"Music: using fetched track {MUSIC_TRACK}")
            if music_credit.get("artist"):
                lic = music_credit.get("license_name") or "CC"
                print(f"Music credit: {music_credit['name']} — {music_credit['artist']} ({lic})")
        else:
            mood = ir_builder._pick(mood_hint, ir_builder.MUSIC_MOODS, theme["music"]["mood"])
            theme["music"]["mood"] = mood
            print(f"Music: synthesising a '{mood}' bed")
            music.generate_bed(
                Path(ir_builder.MUSIC_SRC),
                mood=mood,
                transpose=theme["music"]["transpose"],
            )
            music_src = ir_builder.MUSIC_SRC

        # Sidechain-style ducking: dip the bed under every narration span so
        # the voice always leads. Baked into the wav (Remotion mixes at fixed
        # volumes). Only the synthesised bed is processed — it's a wav we own.
        if music_src == ir_builder.MUSIC_SRC:
            spans, cursor_s = [], 0.0
            for scene in self.state.script["scenes"]:
                audio = scene.get("audio")
                if audio:
                    spans.append((cursor_s, cursor_s + audio["duration_s"]))
                cursor_s += scene["duration_seconds"]
            if spans:
                print(f"Music: ducking bed under {len(spans)} narration spans")
                music.fit_and_duck(Path(music_src), spans, cursor_s)

        # Sound design is opt-in — only when the prompt asked for it.
        sfx_kit = None
        if self.state.sfx:
            print("SFX: prompt asked for sound design — ensuring synthesized kit")
            sfx_kit = sfx.ensure_kit()

        preset = PRESETS[self.state.preset]
        self.state.render_ir = ir_builder.resolve_ir(
            self.state.script, plan, graphics,
            width=preset["width"], height=preset["height"],
            theme=theme, music_enabled=needed, music_src=music_src,
            music_volume=music_volume, music_credit=music_credit,
            sfx=sfx_kit,
        )
        print(f"Render IR compiled: {self.state.render_ir['metadata']['total_frames']} frames")

    @listen(compile_ir)
    def save_content(self):
        _mark("save_content")
        print("Saving direction script")
        output_dir = Path("output")
        output_dir.mkdir(exist_ok=True)
        self.state.direction_script = json.dumps(
            self.state.script, indent=2, ensure_ascii=False
        )
        with open(output_dir / "direction_script.json", "w") as f:
            f.write(self.state.direction_script)
        with open(output_dir / "render_ir.json", "w") as f:
            json.dump(self.state.render_ir, f, indent=2, ensure_ascii=False)
        print("Saved output/direction_script.json and output/render_ir.json")
        self._sync_renderer()
        _mark("end")  # flush the final stage's timing

    def _sync_renderer(self):
        renderer_public = Path("../renderer/public")
        if not renderer_public.parent.is_dir():
            return
        renderer_public.mkdir(exist_ok=True)
        shutil.copy2("output/render_ir.json", renderer_public / "render_ir.json")
        for sub in ("assets", "audio", "lottie"):
            src = Path("output") / sub
            if src.is_dir():
                shutil.copytree(src, renderer_public / sub, dirs_exist_ok=True)
        print(f"Synced IR + media to {renderer_public.resolve()}")


def kickoff():
    content_flow = ContentFlow()
    content_flow.kickoff()


def plot():
    content_flow = ContentFlow()
    content_flow.plot()


def run_with_trigger():
    """
    Run the flow with trigger payload.
    """
    if len(sys.argv) < 2:
        raise Exception("No trigger payload provided. Please provide JSON payload as argument.")

    try:
        trigger_payload = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        raise Exception("Invalid JSON payload provided as argument")

    content_flow = ContentFlow()

    try:
        result = content_flow.kickoff({"crewai_trigger_payload": trigger_payload})
        return result
    except Exception as e:
        raise Exception(f"An error occurred while running the flow with trigger: {e}")


if __name__ == "__main__":
    kickoff()
