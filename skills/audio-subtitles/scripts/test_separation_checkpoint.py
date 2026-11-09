import argparse
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import generate_subtitles as pipeline


class SeparationCheckpointTests(unittest.TestCase):
    def test_reuse_and_invalidation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            vocal, backing = root / "Vocals.wav", root / "Instrumental.wav"
            vocal.write_bytes(b"test vocal")
            backing.write_bytes(b"test backing")
            signature = {"source": "audio-hash", "model": "model-hash"}
            self.assertIsNone(pipeline.load_separation_checkpoint(root, signature))
            pipeline.save_separation_checkpoint(root, signature, vocal, [vocal, backing])
            self.assertEqual(pipeline.load_separation_checkpoint(root, signature)[0], vocal)
            self.assertIsNone(pipeline.load_separation_checkpoint(root, {**signature, "model": "changed"}))
            backing.write_bytes(b"corrupt backing")
            self.assertIsNone(pipeline.load_separation_checkpoint(root, signature))
            backing.unlink()
            self.assertIsNone(pipeline.load_separation_checkpoint(root, signature))

    def test_malformed_and_escaping_paths_are_not_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            manifest = root / ".vocalflow-separation.json"
            for content in ['broken', '{"signature":{},"outputs":null}',
                            '{"signature":{},"vocal":"../outside","outputs":{"../outside":"x","second":"x"}}']:
                manifest.write_text(content)
                self.assertIsNone(pipeline.load_separation_checkpoint(root, {}))
                self.assertEqual(manifest.read_text(), content)

    def test_second_attempt_skips_subprocess(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = argparse.Namespace(separator_output_dir=None, separator_format="WAV",
                                      separator_model="model.onnx", separator_preset=None, separator_model_dir=folder)
            source = root / "song.wav"
            source.write_bytes(b"input")

            def create_stems(*_args, **_kwargs):
                (root / "stems" / "song_(Vocals).wav").write_bytes(b"vocals")
                (root / "stems" / "song_(Instrumental).wav").write_bytes(b"backing")

            with patch.object(pipeline, "audio_separator_command", return_value=["unused"]), \
                 patch.object(pipeline, "separation_signature", return_value={"source": "same"}), \
                 patch.object(pipeline.subprocess, "run", side_effect=create_stems) as run:
                first = pipeline.separate_source(source, root, args)
                second = pipeline.separate_source(source, root, args)
                self.assertEqual(first, second)
                self.assertEqual(run.call_count, 1)
                first.write_bytes(b"damaged")
                pipeline.separate_source(source, root, args)
                self.assertEqual(run.call_count, 2)

    def test_signature_changes_with_input_or_model(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, model = root / "song.wav", root / "model.onnx"
            source.write_bytes(b"first input")
            model.write_bytes(b"first model")
            args = argparse.Namespace(separator_preset=None, separator_model=model.name,
                                      separator_model_dir=folder, separator_format="WAV")
            with patch.object(pipeline.importlib.metadata, "version", return_value="test-version"):
                first = pipeline.separation_signature(source, args)
                source.write_bytes(b"new input")
                self.assertNotEqual(first, pipeline.separation_signature(source, args))
                source.write_bytes(b"first input")
                model.write_bytes(b"new model")
                self.assertNotEqual(first, pipeline.separation_signature(source, args))
                args.separator_preset = "unknown dependencies"
                self.assertIsNone(pipeline.separation_signature(source, args))


if __name__ == "__main__":
    unittest.main()
