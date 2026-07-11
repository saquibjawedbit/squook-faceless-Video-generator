"""Unit tests for the content-preset media policy (presets.apply_media_policy).

Pure logic, no LLM / network — runnable under pytest (`uv run pytest`) or
directly (`python tests/test_presets.py`), since the project has no pytest dep
wired up yet.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from guide_creator_flow import presets as P  # noqa: E402


def _plan(*items):
    return [
        {"scene_index": i + 1, "media_type": mt, "query": q}
        for i, (mt, q) in enumerate(items)
    ]


class MediaPolicyTest(unittest.TestCase):
    def test_images_forces_every_scene_to_photo(self):
        plan = _plan(
            ("video", "city timelapse"),
            ("graphic", "40% growth"),
            ("lottie", "robot thinking"),
            ("upload", "me.mp4"),          # user footage is never rewritten
        )
        P.apply_media_policy(plan, P.resolve("images"))
        self.assertEqual(
            [e["media_type"] for e in plan], ["photo", "photo", "photo", "upload"]
        )

    def test_animation_drops_photo_and_video(self):
        plan = _plan(
            ("photo", "portrait of Ada"),   # -> lottie (no data hint)
            ("video", "rocket launch"),     # -> lottie
            ("photo", "35% growth chart"),  # -> graphic (data hint)
            ("upload", "clip.mov"),
        )
        P.apply_media_policy(plan, P.resolve("animation"))
        self.assertEqual(
            [e["media_type"] for e in plan],
            ["lottie", "lottie", "graphic", "upload"],
        )

    def test_educational_prefer_is_soft_noop(self):
        plan = _plan(("photo", "forest"), ("video", "waves"))
        P.apply_media_policy(plan, P.resolve("educational"))
        self.assertEqual([e["media_type"] for e in plan], ["photo", "video"])

    def test_custom_block_neutralizes_and_coerces_faces(self):
        bundle = P.resolve("custom", {"media_policy": {"block": ["portrait", "logo"]}})
        plan = _plan(
            ("photo", "portrait of Elon Musk"),
            ("photo", "logo of Nvidia"),
            ("photo", "desert dunes"),       # not a name -> untouched
        )
        P.apply_media_policy(plan, bundle)
        self.assertEqual(plan[0]["media_type"], "graphic")
        self.assertEqual(plan[0]["query"], "")
        self.assertEqual(plan[1]["media_type"], "graphic")
        self.assertEqual(plan[1]["query"], "")
        self.assertEqual(plan[2]["media_type"], "photo")
        self.assertEqual(plan[2]["query"], "desert dunes")

    def test_auto_is_a_noop(self):
        plan = _plan(("video", "x"), ("graphic", "y"))
        P.apply_media_policy(plan, P.resolve("auto"))
        self.assertEqual([e["media_type"] for e in plan], ["video", "graphic"])

    def test_resolve_merges_custom_onto_auto(self):
        # A partial custom bundle inherits auto's shape for the keys it omits.
        bundle = P.resolve("custom", {"media_policy": {"force": ["photo"]}})
        self.assertEqual(bundle["media_policy"]["force"], ["photo"])
        self.assertIn("guidance", bundle)
        self.assertEqual(bundle["theme"]["mood_pool"], None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
