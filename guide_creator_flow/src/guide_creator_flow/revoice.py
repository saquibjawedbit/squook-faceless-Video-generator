#!/usr/bin/env python
"""Re-voice a project's narration in place — the editor's "change voice".

Takes a JSON payload {"ir": <render_ir path>, "assets": <asset dir>, "voice": <id>}
and, for every scene with narration, synthesizes a fresh wav with the requested
voice into <assets>/audio/scene_N.<voice>.wav, then updates the IR to match:
audio layer src, caption word timings, scene duration (narration length drives
it, same rule as generation), and the derived frame fields.

New files are voice-suffixed so the old voice's wavs survive — the editor's
undo can restore the previous IR and still find its audio.
"""
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from guide_creator_flow.tools import tts

# Narration layers point at output/audio/scene_N[.voice].wav; SFX layers also
# have type "audio" but live under output/audio/sfx/ — never touch those.
def _is_narration_layer(layer: dict) -> bool:
    src = layer.get("src") or ""
    return (
        layer.get("type") == "audio"
        and "/audio/scene_" in src
        and "/sfx/" not in src
    )


def _retime(ir: dict) -> None:
    """Recompute derived timing from duration_s (mirrors server ir.js retime)."""
    fps = ir["metadata"]["fps"]
    cursor = 0
    for i, scene in enumerate(ir["scenes"]):
        scene["scene"] = i + 1
        scene["duration_frames"] = max(1, round(scene["duration_s"] * fps))
        scene["start_frame"] = cursor
        cursor += scene["duration_frames"]
        t = scene.get("transition_out")
        if t and t.get("type") != "cut":
            t["duration_s"] = min(t["duration_s"], round(scene["duration_s"] / 2, 2))
        for layer in scene.get("layers") or []:
            if layer.get("type") == "text" and layer.get("exit"):
                layer["exit"]["at_s"] = min(
                    layer["exit"]["at_s"], max(1, round(scene["duration_s"] - 0.5, 2))
                )
    ir["metadata"]["scene_count"] = len(ir["scenes"])
    ir["metadata"]["total_frames"] = cursor
    ir["metadata"]["total_duration_seconds"] = round(cursor / fps, 2)


def revoice(ir_path: Path, assets_dir: Path, voice_id: str) -> dict:
    ir = json.loads(ir_path.read_text(encoding="utf-8"))
    audio_dir = assets_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    jobs = []  # (scene, narration) — scenes that actually speak
    for scene in ir["scenes"]:
        narration = tts.clean_narration(scene.get("narration") or "")
        if narration:
            jobs.append((scene, narration))
    print(f"Re-voicing {len(jobs)}/{len(ir['scenes'])} scenes with '{voice_id}'")

    def _speak(job):
        scene, narration = job
        n = scene["scene"]
        out_path = audio_dir / f"scene_{n}.{voice_id}.wav"
        duration, words = tts.synthesize(narration, out_path, voice_id=voice_id)
        print(f"  scene {n}: {duration:.1f}s")
        return scene, duration, words, f"output/audio/scene_{n}.{voice_id}.wav"

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(_speak, jobs))

    for scene, duration, words, src in results:
        # Same duration rule as generation: audio length + breathing room.
        scene["duration_s"] = max(3, math.ceil(duration + 0.6))
        had_audio = False
        for layer in scene.get("layers") or []:
            if _is_narration_layer(layer):
                layer["src"] = src
                had_audio = True
            elif layer.get("type") == "captions":
                layer["words"] = words
        if not had_audio:
            # The project was generated without a voiceover — add one.
            scene.setdefault("layers", []).append(
                {"type": "audio", "src": src, "volume": 1.0}
            )

    _retime(ir)
    ir_path.write_text(json.dumps(ir, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Re-voiced IR written: {ir_path} ({ir['metadata']['total_duration_seconds']}s total)")
    return ir


def run():
    if len(sys.argv) < 2:
        raise SystemExit('usage: revoice \'{"ir": ..., "assets": ..., "voice": ...}\'')
    payload = json.loads(sys.argv[1])
    voice = (payload.get("voice") or "").strip().lower()
    if voice not in tts.VOICES:
        raise SystemExit(f"unknown voice '{voice}' (have: {', '.join(tts.VOICES)})")
    revoice(Path(payload["ir"]), Path(payload["assets"]), voice)


if __name__ == "__main__":
    run()
