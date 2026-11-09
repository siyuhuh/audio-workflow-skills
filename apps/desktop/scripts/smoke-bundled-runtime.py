#!/usr/bin/env python3
"""Exercise packaged tools and models without user-installed dependencies.

Run with the bundled Python, passing Resources and a short local speech WAV.
On macOS, run under sandbox-exec with network access denied.
"""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import functools
import http.server
import threading
from types import SimpleNamespace
from urllib.parse import quote


def main():
    if not sys.flags.no_user_site:
        raise SystemExit("Run bundled Python with -s (disable user-installed packages).")
    resources = Path(sys.argv[1]).resolve()
    fixture = Path(sys.argv[2]).resolve()
    script = resources / "audio-subtitles/scripts/generate_subtitles.py"
    ffmpeg_dir = resources / "ffmpeg-static"
    if not ffmpeg_dir.exists():
        ffmpeg_dir = resources / "bin"
    with tempfile.TemporaryDirectory(prefix="vocalflow-clean-smoke-") as temporary:
        root = Path(temporary)
        os.environ.update({
            "PATH": str(ffmpeg_dir),
            "AUDIO_SUBTITLES_PYTHON": sys.executable,
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "HF_HOME": str(root / "hf"),
            "XDG_CACHE_HOME": str(root / "cache"),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "VOCALFLOW_WHISPER_MODEL_DIR": str(resources / "whisper-models"),
        })
        pipeline = runpy.run_path(str(script), run_name="smoke_pipeline")
        pipeline["require_binary"]("yt-dlp")
        result = pipeline["_run_with_live_stderr"](["yt-dlp", "--version"], check=True)
        print(f"Downloader started through packaged Python: {result.stdout.strip()}", flush=True)
        if "--download-only" in sys.argv[3:]:
            handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(fixture.parent))
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/{quote(fixture.name)}"
                downloaded, cleanup = pipeline["download_url_audio"](
                    url, root, SimpleNamespace(save_audio=True, browser=None, cookies=None)
                )
                if downloaded.stat().st_size == 0:
                    raise RuntimeError("Downloader created an empty file")
                cleanup()
                print("PASS: URL download and audio extraction with packaged tools", flush=True)
            finally:
                server.shutdown()
                server.server_close()
            return
        subprocess.run([*pipeline["audio_separator_command"](), "--version"], check=True, timeout=120)
        output = root / "output"
        command = [
            sys.executable, str(script), str(fixture), "--output-dir", str(output),
            "--separate", "--separator-model", "UVR-MDX-NET-Inst_HQ_3.onnx",
            "--separator-format", "MP3",
            "--separator-model-dir", str(resources / "separator-models"),
            "--model", "small", "--device", "cpu", "--compute-type", "int8",
            "--language", "en", "--force-local", "--no-preload-whisper",
            "--formats", "srt,txt,json", "--word-engine", "faster_whisper",
        ]
        if "--recovery" in sys.argv[3:]:
            broken = command.copy()
            broken[broken.index("--model") + 1] = str(root / "deliberately-missing-model")
            failed = subprocess.run(broken, capture_output=True, text=True, timeout=600)
            if failed.returncode == 0 or len(list((output / "stems").glob("*.mp3"))) < 2:
                raise RuntimeError("Failure fixture did not retain completed stems")
            if not (output / "stems/.vocalflow-separation.json").is_file():
                raise RuntimeError("Failed job did not retain its separation checkpoint")
            retried = subprocess.run(command, capture_output=True, text=True, timeout=600)
            if retried.returncode != 0:
                raise RuntimeError(f"Recovery failed: {retried.stderr[-3000:]}")
            if "Reusing verified separation outputs." not in retried.stderr:
                raise RuntimeError("Retry did not reuse the completed separation")
            print("PASS: transcription failure retained stems; retry reused separation", flush=True)
        else:
            subprocess.run(command, check=True, timeout=600)
        stems = list((output / "stems").glob("*.mp3"))
        transcripts = list(output.glob("*.json"))
        if len(stems) < 2 or not transcripts:
            raise RuntimeError("Pipeline did not create both stems and transcript")
        if not any(json.loads(transcript.read_text()).get("cues") for transcript in transcripts):
            raise RuntimeError("Speech fixture produced no subtitle cues")
        texts = list(output.glob("*.txt"))
        if not texts or not any(path.read_text().strip() for path in texts):
            raise RuntimeError("Speech fixture produced an empty transcript")
        print(f"PASS: {len(stems)} stems and {len(transcripts)} transcript JSON file(s)", flush=True)


if __name__ == "__main__":
    main()
