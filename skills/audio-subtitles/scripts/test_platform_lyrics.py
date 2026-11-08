"""Offline regression tests for captions in the separated karaoke workflow."""
import argparse
from contextlib import ExitStack
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import generate_subtitles as pipeline


class PlatformLyricsTests(unittest.TestCase):
    def options(self, **overrides):
        values = dict(separate=True, subtitle_source="auto", language=None, sub_langs=None)
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_karaoke_selects_original_manual_not_english_translation(self):
        info = dict(language="ja", subtitles={"en": [{"url": "https://example/en"}],
                                            "ja": [{"url": "https://example/ja"}]})
        self.assertEqual(pipeline.choose_subtitle_language(info, self.options()), ("ja", "manual"))

    def test_unknown_or_automatic_language_falls_back(self):
        for info in [dict(subtitles={"en": [{"url": "https://example/en"}]}),
                     dict(language="ja", automatic_captions={"ja": [{}]}),
                     dict(language="ja", subtitles={"ja": [{"url": "https://example/?tlang=ja"}]})]:
            self.assertIsNone(pipeline.choose_subtitle_language(info, self.options()))

    def test_non_karaoke_keeps_automatic_captions(self):
        info = dict(automatic_captions={"en": [{}]})
        self.assertEqual(pipeline.choose_subtitle_language(info, self.options(separate=False)), ("en", "automatic"))

    def test_invalid_timing_is_rejected(self):
        for cues in [[], [pipeline.Cue(float("nan"), 2, "hello")],
                     [pipeline.Cue(2, 1, "hello")], [pipeline.Cue(0, 1, " ")]]:
            self.assertFalse(pipeline.valid_platform_cues(cues))
        self.assertTrue(pipeline.valid_platform_cues([pipeline.Cue(0, 2, "hello")]))

    def run_workflow(self, captions=None, failure=None, source="auto", observed=None, asr_failure=None):
        with tempfile.TemporaryDirectory() as folder, ExitStack() as stack:
            argv = ["generate_subtitles", "https://example.com/song", "--separate",
                    "--local-fallback", "--subtitle-source", source, "--output-dir", folder]
            stack.enter_context(patch("sys.argv", argv))
            stack.enter_context(patch.object(pipeline, "maybe_reexec_venv"))
            stack.enter_context(patch.object(pipeline, "emit_progress"))
            stack.enter_context(patch.object(pipeline, "download_url_subtitles", return_value=captions, side_effect=failure))
            stack.enter_context(patch.object(pipeline, "_start_whisper_preload", return_value=None))
            stack.enter_context(patch.object(pipeline, "resolve_source", return_value=(Path(folder)/"song.mp3", lambda: None)))
            separate = stack.enter_context(patch.object(pipeline, "separate_source", return_value=Path(folder)/"vocals.wav"))
            stack.enter_context(patch.object(pipeline, "prepare_audio", return_value=(Path(folder)/"ready.wav", lambda: None)))
            transcribe = stack.enter_context(patch.object(pipeline, "transcribe", return_value=(
                observed if observed is not None else [pipeline.Cue(0, 2, "draft")], {}), side_effect=asr_failure))
            stack.enter_context(patch.object(pipeline, "maybe_simplify_chinese", side_effect=lambda cues, *_: cues))
            write = stack.enter_context(patch.object(pipeline, "write_outputs", return_value=[]))
            self.assertEqual(pipeline.main(), 0)
            separate.assert_called_once()
            return transcribe.call_count, write.call_args.args

    def test_captions_do_not_skip_separation_and_are_checked(self):
        cues = [pipeline.Cue(0, 2, "original lyrics from this recording")]
        count, written = self.run_workflow(captions=("song", cues, {"source": "platform-subtitles"}), observed=cues)
        self.assertEqual(count, 1)
        self.assertEqual(written[2], cues)
        self.assertEqual(written[3]["lyrics_validation"]["status"], "supported")
        self.assertTrue(written[3]["lyrics_needs_review"])

    def test_platform_only_does_not_load_asr(self):
        cues = [pipeline.Cue(0, 2, "original lyrics")]
        count, written = self.run_workflow(captions=("song", cues, {}), source="platform")
        self.assertEqual(count, 0)
        self.assertEqual(written[2], cues)

    def test_mismatched_captions_fall_back_to_draft(self):
        observed = [pipeline.Cue(0, 2, "这是实际演唱的中文歌词内容不会是英文翻译")]
        count, written = self.run_workflow(captions=("song", [pipeline.Cue(0, 2, "unrelated translated lyrics")], {}), observed=observed)
        self.assertEqual(count, 1)
        self.assertEqual(written[2], observed)
        self.assertEqual(written[3]["lyrics_source"], "local_asr")
        self.assertEqual(written[3]["lyrics_validation"]["status"], "mismatch")

    def test_failed_check_preserves_captions(self):
        cues = [pipeline.Cue(0, 2, "original lyrics")]
        for failure in [RuntimeError("model unavailable"), SystemExit("model unavailable")]:
            _, written = self.run_workflow(captions=("song", cues, {}), asr_failure=failure)
            self.assertEqual(written[2], cues)
            self.assertEqual(written[3]["lyrics_validation"]["status"], "unavailable")

    def test_support_normalizes_without_rewriting(self):
        captions = [pipeline.Cue(0, 3, "Hello, WORLD! Sing with me.")]
        observed = [pipeline.Cue(0, 3, "hello world sing with me")]
        report = pipeline.assess_caption_support(captions, observed)
        self.assertEqual(report["status"], "supported")
        self.assertEqual(captions[0].text, "Hello, WORLD! Sing with me.")

    def test_missing_repetitions_are_not_deduplicated(self):
        line = "sing this chorus again and again"
        captions = [pipeline.Cue(0, 3, line)]
        observed = [pipeline.Cue(i * 5, i * 5 + 3, line) for i in range(3)]
        self.assertEqual(pipeline.assess_caption_support(captions, observed)["status"], "mismatch")

    def test_wrong_offset_is_not_supported(self):
        line = "sing this chorus again and again"
        self.assertEqual(pipeline.assess_caption_support(
            [pipeline.Cue(0, 3, line)], [pipeline.Cue(30, 33, line)])["status"], "timing_review")

    def test_sparse_evidence_is_inconclusive(self):
        self.assertEqual(pipeline.assess_caption_support(
            [pipeline.Cue(0, 3, "la")], [pipeline.Cue(0, 3, "la")])["status"], "inconclusive")

    def test_missing_captions_and_metadata_failure_fall_back(self):
        for failure in [None, SystemExit("metadata unavailable"), RuntimeError("invalid metadata")]:
            count, written = self.run_workflow(failure=failure)
            self.assertEqual(count, 1)
            self.assertEqual(written[3]["lyrics_source"], "local_asr")

    def test_platform_only_remains_strict(self):
        with self.assertRaises(SystemExit):
            self.run_workflow(source="platform")


if __name__ == "__main__":
    unittest.main()
