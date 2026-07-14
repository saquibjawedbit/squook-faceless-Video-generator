"""Render → see → fix → see again: the visual feedback loop.

A one-shot pipeline designs graphics blind — the model never sees what it
made, which is why compositions ship cluttered, clipped, or meaningless.
This module closes the loop:

  1. Per-scene: render a still of every scene that carries a designed
     graphic, show it to a vision model together with the spec that produced
     it, and let the model revise the composition. The revision is re-synced,
     RE-RENDERED, and looked at again — up to DESIGN_CRITIQUE_ROUNDS times —
     so a fix is verified by eyes, not assumed.
  2. Whole-video: render one still per scene into a labelled contact sheet
     and have the model judge the video as a whole (consistency, clutter,
     readability). Its per-scene notes drive one more targeted revision pass,
     and the report is stored in metadata.critique for the product surface.

Vision providers, auto-detected in order of strength (override with
DESIGN_CRITIQUE_PROVIDER = claude|openai|cloudflare|ollama):

  anthropic   ANTHROPIC_API_KEY                    (claude-opus-4-8)
  openai      OPENAI_API_KEY                       (gpt-4o)
  cloudflare  CLOUDFLARE_ACCOUNT_ID+API_TOKEN      (@cf/meta/llama-3.2-11b-vision-instruct)
              — Workers AI via its OpenAI-compatible /ai/v1 endpoint
  ollama      any vision-capable local model       (qwen3-vl / llava / gemma3 …)

DESIGN_CRITIQUE_MODEL overrides the model for whichever provider is active.
The loop is ON by default when a provider exists; DESIGN_CRITIQUE=false turns
it off. Only frontier critics (claude/openai) may replace a polished template
graphic; smaller models are trusted to revise free-form motion compositions
only, and every revision passes the same _sanitize_motion clamps as first-pass
generation, so a bad critique can never produce an unrenderable layer.
"""
import base64
import io
import json
import os
import re
import subprocess
from pathlib import Path

from guide_creator_flow.ir_builder import _sanitize_motion, MOTION_SHAPE_KINDS

RENDERER = Path(__file__).resolve().parents[3] / "renderer"

# Layer types the critic may replace with a revised vector composition.
_REFINABLE = ("motion", "graphic")

# Providers strong enough to replace a hand-built template with a free-form
# drawing. Smaller critics only revise compositions that are already free-form.
_FRONTIER = ("anthropic", "openai")

# Ollama models that accept image input, by name substring.
_OLLAMA_VISION_HINTS = ("vl", "vision", "llava", "minicpm-v", "moondream", "gemma3", "bakllava")

# Compact schema doc so the model returns a spec our sanitizer accepts. Mirrors
# the CUSTOM-composition contract in ir_builder.design_graphics.
_SHAPE_DOC = (
    "A custom composition is a list of 3-16 shapes, each: "
    "{kind, x, y, ...props, keyframes:[...]}\n"
    f"- kind: one of {list(MOTION_SHAPE_KINDS)}\n"
    "- x,y: center in 0..100 (% of frame; 50,50 = middle). line uses x,y -> x2,y2\n"
    "- r: circle/ring/dot radius (% of min side). w,h: rect size (%). size: text px\n"
    "- text: label string (kind='text'). stroke_width: px for ring/line\n"
    "- fill / stroke: TOKENS 'accent'|'accent2'|'text'|'bg' (NOT raw hex)\n"
    "- keyframes: [{t, x?, y?, r?, scale?, rotate?, opacity?}], t in seconds\n"
    "- bg (optional): background token\n"
)

_PRINCIPLES = (
    "Design principles: one idea per scene; a single dominant focal point; "
    "3-8 shapes usually beats 16; generous whitespace; 'accent' for the hero, "
    "'accent2' sparingly, 'text' for labels; stagger entrances (opacity 0->1) so "
    "elements arrive in the order the narration explains them. Hard rules: "
    "keep every element's center inside x 10-90 / y 10-90; text shapes are "
    "SHORT labels (1-4 words, size 32-90) — never sentences, the narration is "
    "spoken aloud; never use emoji characters."
)


def _truthy(v) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _real_key(name: str) -> str | None:
    """Same placeholder guard as tools/tts.py — template .env files ship with
    literal "YOUR_API_KEY", which must read as "no key"."""
    key = os.getenv(name, "").strip()
    return key if key and key != "YOUR_API_KEY" else None


# ------------------------------------------------------------ provider pick

def _ollama_base() -> str:
    return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")


def _ollama_vision_model() -> str | None:
    """First installed Ollama model that accepts images (or the env override
    when it is actually installed)."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"{_ollama_base()}/api/tags", timeout=5) as r:
            models = [m["name"] for m in json.load(r).get("models", [])]
    except Exception:
        return None
    want = os.getenv("DESIGN_CRITIQUE_MODEL", "").strip()
    if want:
        for name in models:
            if name == want or name.split(":")[0] == want:
                return name
    for name in models:
        base = name.split(":")[0].lower()
        if any(h in base for h in _OLLAMA_VISION_HINTS):
            return name
    return None


def detect_provider() -> tuple[str, str] | None:
    """(provider, model) of the strongest available vision critic, or None."""
    def anthropic_ok():
        if not _real_key("ANTHROPIC_API_KEY"):
            return None
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return None
        return ("anthropic", os.getenv("DESIGN_CRITIQUE_MODEL", "claude-opus-4-8"))

    def openai_ok():
        if not _real_key("OPENAI_API_KEY"):
            return None
        try:
            import openai  # noqa: F401
        except ImportError:
            return None
        return ("openai", os.getenv("DESIGN_CRITIQUE_MODEL", "gpt-4o"))

    def cloudflare_ok():
        if not (_real_key("CLOUDFLARE_API_TOKEN") and os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()):
            return None
        try:
            import openai  # noqa: F401  (Workers AI speaks the OpenAI protocol)
        except ImportError:
            return None
        return ("cloudflare",
                os.getenv("DESIGN_CRITIQUE_MODEL", "@cf/meta/llama-3.2-11b-vision-instruct"))

    def ollama_ok():
        m = _ollama_vision_model()
        return ("ollama", m) if m else None

    forced = os.getenv("DESIGN_CRITIQUE_PROVIDER", "").strip().lower()
    if forced in ("claude", "anthropic"):
        return anthropic_ok()
    if forced == "openai":
        return openai_ok()
    if forced == "cloudflare":
        return cloudflare_ok()
    if forced == "ollama":
        return ollama_ok()
    return anthropic_ok() or openai_ok() or cloudflare_ok() or ollama_ok()


def enabled() -> bool:
    """The loop runs by default whenever a vision critic is reachable.
    DESIGN_CRITIQUE=false opts out."""
    flag = os.getenv("DESIGN_CRITIQUE", "").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    prov = detect_provider()
    if not prov:
        print(
            "Critique loop off: no vision model available. Set "
            "CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (Workers AI), or an "
            "ANTHROPIC/OPENAI key, or `ollama pull qwen3-vl:2b`."
        )
        return False
    print(f"Critique loop on: {prov[0]} / {prov[1]}")
    return True


# ---------------------------------------------------------------- rendering

def render_still(scene_index: int, frame_no: int, out_name: str) -> Path | None:
    """Render one PNG still via the Remotion CLI (same subprocess pattern as
    tools/mastering.py). Returns the path, or None if the render failed —
    callers must degrade gracefully so a render hiccup never aborts the flow."""
    out_rel = f"out/{out_name}"
    try:
        subprocess.run(
            ["npx", "remotion", "still", "Explainer", out_rel,
             "--frame", str(frame_no), "--image-format", "png"],
            cwd=RENDERER, check=True, capture_output=True, timeout=300,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"  still render failed for scene {scene_index} (frame {frame_no}): {e}")
        return None
    path = RENDERER / out_rel
    return path if path.is_file() else None


def _encode_image(path: Path, max_w: int = 1024) -> tuple[str, str]:
    """Downscale + JPEG-encode a still for the vision call. Smaller images are
    dramatically faster to encode on every provider and lose nothing the
    critic needs at this size."""
    try:
        from PIL import Image
        im = Image.open(path).convert("RGB")
        if im.width > max_w:
            im = im.resize((max_w, int(im.height * max_w / im.width)))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
        return "image/jpeg", base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return "image/png", base64.b64encode(path.read_bytes()).decode("ascii")


# ---------------------------------------------------------------- vision call

def _vision_call(prompt: str, image_path: Path) -> str | None:
    """Send one image + prompt to the detected provider; return the reply text
    or None on any failure (network, refusal, no provider) — never fatal."""
    prov = detect_provider()
    if not prov:
        return None
    provider, model = prov
    media_type, b64 = _encode_image(image_path)
    try:
        if provider == "anthropic":
            import anthropic
            resp = anthropic.Anthropic().messages.create(
                model=model, max_tokens=4096,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {
                        "type": "base64", "media_type": media_type, "data": b64}},
                    {"type": "text", "text": prompt},
                ]}],
            )
            if resp.stop_reason == "refusal":
                return None
            return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
        if provider == "openai":
            from openai import OpenAI
            resp = OpenAI().chat.completions.create(
                model=model, max_tokens=4096,
                messages=[{"role": "user", "content": [
                    {"type": "image_url", "image_url": {
                        "url": f"data:{media_type};base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ]}],
            )
            return resp.choices[0].message.content
        if provider == "cloudflare":
            # The OpenAI-compat /ai/v1 layer rejects image content parts for
            # this model ("Unable to add image…"); the native /ai/run endpoint
            # accepts prompt + the raw image as a byte array.
            import urllib.request
            account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
            req = urllib.request.Request(
                f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}",
                data=json.dumps({
                    "prompt": prompt,
                    "image": list(base64.b64decode(b64)),
                    "max_tokens": 2048,
                }).encode(),
                headers={
                    "Authorization": f"Bearer {_real_key('CLOUDFLARE_API_TOKEN')}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=180) as r:
                out = json.load(r)
            if not out.get("success", True):
                print(f"  vision call failed (cloudflare): {out.get('errors')}")
                return None
            return (out.get("result") or {}).get("response")
        if provider == "ollama":
            import urllib.request
            req = urllib.request.Request(
                f"{_ollama_base()}/api/chat",
                data=json.dumps({
                    "model": model, "stream": False,
                    "messages": [{"role": "user", "content": prompt, "images": [b64]}],
                    "options": {"temperature": 0.2},
                }).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=600) as r:
                return (json.load(r).get("message") or {}).get("content")
    except Exception as e:  # rate limit, network, bad key — never fatal
        print(f"  vision call failed ({provider}/{model}): {e}")
        return None
    return None


def parse_critique(text) -> dict | None:
    """Extract the JSON verdict from the model's reply, tolerating markdown
    fences, surrounding prose, and providers (Cloudflare) that return the
    JSON already parsed."""
    if isinstance(text, dict):
        return text
    if not text or not isinstance(text, str):
        return None
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    else:
        # Fall back to the outermost {...} span if there's leading/trailing prose.
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        if brace:
            text = brace.group(0)
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return data if isinstance(data, dict) else None


# ---------------------------------------------------------------- per-scene

def _scene_prompt(scene: dict, layer: dict, theme: dict | None, steer: str = "") -> str:
    palette = (theme or {}).get("palette", {})
    narration = (scene.get("narration") or "").strip()[:400]
    duration = scene.get("duration_s") or round(
        (scene.get("duration_frames") or 90) / 30, 1)
    spec = json.dumps(layer, ensure_ascii=False)
    if len(spec) > 2500:
        spec = spec[:2500] + "…"
    return (
        "You are a senior motion-graphics designer reviewing one rendered frame "
        "of an explainer-video scene, together with the exact spec that "
        "produced it. You may keep it or redraw it.\n\n"
        f"Scene narration (spoken aloud): \"{narration}\"\n"
        f"Scene duration: {duration}s\n"
        f"Palette: accent={palette.get('accent', '?')} "
        f"accent2={palette.get('accent2', '?')}\n"
        f"Current graphic spec:\n{spec}\n\n"
        + (f"A whole-video review flagged this scene: {steer}\n\n" if steer else "")
        + f"{_PRINCIPLES}\n\n"
        "Judge the RENDERED FRAME (the image) against those principles and "
        "whether it conveys the scene's idea. If it already reads cleanly, "
        'respond with RAW JSON ONLY: {"verdict": "keep"}.\n'
        "If it is cluttered, unbalanced, clipped, unreadable, or fails to "
        "convey the idea, respond with a REVISED composition, RAW JSON ONLY:\n"
        '{"verdict": "revise", "shapes": [ ... ], "bg": "<token or omit>", '
        '"note": "<one line on what you fixed>"}\n\n'
        f"{_SHAPE_DOC}"
    )


def _critique_scene(scene: dict, layer: dict, image_path: Path,
                    theme: dict | None, steer: str = "") -> dict | None:
    return parse_critique(_vision_call(_scene_prompt(scene, layer, theme, steer), image_path))


def _scene_frame(scene: dict, fps: int) -> int:
    """A frame roughly mid-scene so entrance animations have resolved."""
    start = int(scene.get("start_frame", 0))
    dur = int(scene.get("duration_frames", fps))
    return start + min(max(dur // 2, 1), max(dur - 1, 1))


def _refinable_layer_index(layers: list) -> int | None:
    for i, layer in enumerate(layers):
        if isinstance(layer, dict) and layer.get("type") in _REFINABLE:
            return i
    return None


def refine_ir(
    ir: dict,
    theme: dict | None = None,
    *,
    max_scenes: int | None = None,
    rounds: int | None = None,
    sync_fn=None,
    steer: dict | None = None,
    render_fn=render_still,
    critique_fn=_critique_scene,
) -> tuple[dict, int]:
    """The per-scene feedback loop: render → critique → revise → RE-RENDER →
    re-critique, in place. Returns (ir, revised_count).

    sync_fn(ir) persists the IR to the renderer between rounds — without it a
    revision can't be re-rendered, so the loop degrades to a single blind
    revision per scene (the old behaviour).

    steer, when given, is {scene_number: issue} from the whole-video review:
    only those scenes are considered and the issue is quoted to the critic.

    Only scenes carrying a motion/graphic layer are considered, capped at
    max_scenes (env DESIGN_CRITIQUE_MAX, default 4) to bound cost/time. A
    polished template ('graphic' layer) may only be replaced by a frontier
    critic. Any per-scene failure is swallowed so the pipeline output is
    never worse than the pre-critique IR."""
    prov = detect_provider()
    if not prov:
        return ir, 0
    frontier = prov[0] in _FRONTIER
    if max_scenes is None:
        try:
            max_scenes = int(os.getenv("DESIGN_CRITIQUE_MAX", "4"))
        except ValueError:
            max_scenes = 4
    if rounds is None:
        try:
            rounds = int(os.getenv("DESIGN_CRITIQUE_ROUNDS", "2"))
        except ValueError:
            rounds = 2
    fps = int((ir.get("metadata") or {}).get("fps", 30))
    scenes = ir.get("scenes") or []

    candidates = []
    for i, s in enumerate(scenes):
        li = _refinable_layer_index(s.get("layers") or [])
        if li is None:
            continue
        if steer is not None and s.get("scene") not in steer:
            continue
        # A hand-built template beats anything a small critic would draw.
        if s["layers"][li].get("type") == "graphic" and not frontier:
            continue
        candidates.append((i, s, li))

    revised = 0
    for i, scene, li in candidates[:max_scenes]:
        layers = scene["layers"]
        note = (steer or {}).get(scene.get("scene"), "")
        frame_no = _scene_frame(scene, fps)
        for rnd in range(max(1, rounds)):
            img = render_fn(i, frame_no, f"critique_s{i}_r{rnd}.png")
            if not img:
                break
            verdict = critique_fn(scene, layers[li], img, theme, note)
            if not verdict or verdict.get("verdict") != "revise":
                if rnd > 0:
                    print(f"  scene {scene.get('scene', i)}: revision verified — reads cleanly")
                break
            motion = _sanitize_motion(verdict.get("shapes"), verdict.get("bg"))
            if not motion:
                break
            layers[li] = motion  # swap the graphic/motion layer for the revision
            revised += 1
            what = str(verdict.get("note", "")).strip()[:120]
            print(f"  scene {scene.get('scene', i)}: revised graphic"
                  + (f" — {what}" if what else ""))
            if sync_fn:
                sync_fn(ir)   # persist so the next round renders the revision
                note = ""     # the steer note is addressed; judge fresh next round
            else:
                break         # can't re-render without a sync; stop here
    return ir, revised


# ---------------------------------------------------------------- whole video

def _contact_sheet(stills: list[tuple[int, Path]], out_path: Path,
                   cols: int = 4, tile_w: int = 480) -> Path | None:
    """Compose labelled scene stills into one grid image (Pillow)."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        tiles = []
        for label, p in stills:
            im = Image.open(p).convert("RGB")
            im = im.resize((tile_w, int(im.height * tile_w / im.width)))
            d = ImageDraw.Draw(im)
            try:
                f = ImageFont.load_default(size=28)
            except TypeError:  # older Pillow
                f = ImageFont.load_default()
            d.rectangle([0, 0, 150, 40], fill=(0, 0, 0))
            d.text((10, 6), f"scene {label}", fill=(255, 255, 255), font=f)
            tiles.append(im)
        if not tiles:
            return None
        th = tiles[0].height
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (tile_w * min(cols, len(tiles)), th * rows), (12, 12, 14))
        for n, im in enumerate(tiles):
            sheet.paste(im, ((n % cols) * tile_w, (n // cols) * th))
        sheet.save(out_path, format="PNG")
        return out_path
    except Exception as e:
        print(f"  contact sheet failed: {e}")
        return None


def review_video(ir: dict, theme: dict | None = None, *,
                 max_tiles: int | None = None,
                 render_fn=render_still,
                 vision_fn=_vision_call) -> dict | None:
    """Whole-video feedback: one labelled still per scene → one vision call →
    {"summary": str, "scene_notes": [{"scene": n, "issue": str}]}.

    The report is stored in ir.metadata.critique so the product can show it;
    the caller feeds scene_notes back into refine_ir as `steer`. Local ollama
    critics skip this (a contact sheet needs more acuity than a small local
    model has) unless DESIGN_CRITIQUE_SHEET=true forces it."""
    prov = detect_provider()
    if not prov:
        return None
    if prov[0] == "ollama" and not _truthy(os.getenv("DESIGN_CRITIQUE_SHEET")):
        return None
    if max_tiles is None:
        try:
            max_tiles = int(os.getenv("DESIGN_CRITIQUE_TILES", "8"))
        except ValueError:
            max_tiles = 8
    fps = int((ir.get("metadata") or {}).get("fps", 30))
    scenes = (ir.get("scenes") or [])[:max_tiles]
    stills = []
    for i, s in enumerate(scenes):
        img = render_fn(i, _scene_frame(s, fps), f"sheet_s{i}.png")
        if img:
            stills.append((s.get("scene", i + 1), img))
    if len(stills) < 2:
        return None
    sheet = _contact_sheet(stills, RENDERER / "out" / "contact_sheet.png")
    if not sheet:
        return None
    palette = (theme or {}).get("palette", {})
    narrations = "\n".join(
        f'  scene {s.get("scene", i + 1)}: "{(s.get("narration") or "").strip()[:120]}"'
        for i, s in enumerate(scenes)
    )
    prompt = (
        "You are a senior motion-graphics director reviewing an explainer "
        "video. The image is a contact sheet: one mid-scene frame per scene, "
        "labelled in story order.\n\n"
        f"Palette: accent={palette.get('accent', '?')} accent2={palette.get('accent2', '?')}\n"
        f"Narration per scene:\n{narrations}\n\n"
        "Judge the video AS A WHOLE: visual consistency (palette, type, "
        "density), per-scene readability (clutter, clipped or unreadable "
        "text, empty frames), and whether each frame serves its narration. "
        "No emoji anywhere is a hard brand rule.\n\n"
        "Respond with RAW JSON ONLY:\n"
        '{"summary": "<2-3 sentences on the overall look>", '
        '"scene_notes": [{"scene": <number>, "issue": "<one actionable line>"}]}\n'
        "List a scene in scene_notes ONLY if it has a real problem worth "
        "redrawing; an empty list is a fine answer."
    )
    report = parse_critique(vision_fn(prompt, sheet))
    if not isinstance(report, dict):
        return None
    notes = [
        {"scene": int(n["scene"]), "issue": str(n.get("issue", "")).strip()[:200]}
        for n in (report.get("scene_notes") or [])
        if isinstance(n, dict) and str(n.get("scene", "")).strip().lstrip("-").isdigit()
    ]
    report = {"summary": str(report.get("summary", "")).strip()[:600], "scene_notes": notes}
    ir.setdefault("metadata", {})["critique"] = report
    if report["summary"]:
        print(f"  video review: {report['summary']}")
    for n in notes:
        print(f"  video review flag — scene {n['scene']}: {n['issue']}")
    return report
