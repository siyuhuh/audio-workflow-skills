#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
from html import unescape
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlparse


# Force line-buffered text I/O so the desktop main process sees progress lines
# (yt-dlp --newline, ffmpeg -progress pipe:1, our own emit_progress envelopes,
# faster-whisper per-segment events) the moment they are produced rather than
# waiting for a full block buffer to flush. Belt-and-suspenders for older
# Pythons and for environments where stdout/stderr are not a TTY.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)


AUDIO_EXTS = {
    ".wav",
    ".waw",
    ".mp3",
    ".m4a",
    ".flac",
    ".aac",
    ".ogg",
    ".opus",
    ".aiff",
    ".aif",
}
VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
MEDIA_EXTS = AUDIO_EXTS | VIDEO_EXTS
SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_VENV = Path.home() / ".local/share/audio-subtitles-venv"


def emit_progress(
    name: str,
    *,
    progress: float = -1.0,
    message: str | None = None,
    done: bool = False,
    failed: bool = False,
    eta_sec: float | None = None,
) -> None:
    """Emit a structured pipeline event on stderr for the desktop main process.

    The Electron main process parses each stderr line: lines that successfully
    JSON-decode and carry an ``event`` field are routed to ``onJobProgress``;
    everything else stays as a plain log chunk. CLI users still see normal text
    output because non-JSON prints are unaffected.
    """
    payload: dict[str, object] = {
        "event": "stage",
        "name": name,
        "progress": float(progress),
    }
    if message is not None:
        payload["message"] = message
    if eta_sec is not None:
        payload["etaSec"] = float(eta_sec)
    if done:
        payload["done"] = True
    if failed:
        payload["failed"] = True
    try:
        print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)
    except Exception:
        # Never let progress reporting break a real job.
        pass


@dataclass
class TimedWord:
    text: str
    start: float
    end: float
    confidence: float | None = None


@dataclass
class Cue:
    start: float
    end: float
    text: str
    words: list[TimedWord] | None = None


def main() -> int:
    emit_progress("prepare", progress=0.0, message="Preparing job")
    maybe_reexec_venv()
    args = parse_args()
    if args.subtitle_source == "youtube":
        args.subtitle_source = "platform"
    if args.force_local:
        args.subtitle_source = "local"

    output_dir = Path(args.output_dir).expanduser() if args.output_dir else default_output_dir(args.input)
    output_dir.mkdir(parents=True, exist_ok=True)
    emit_progress("prepare", progress=1.0, message=f"Output: {output_dir}", done=True)

    formats = parse_formats(args.formats)
    is_url_input = is_url(args.input)
    # Kick off the whisper model load in a background daemon thread so the
    # ~5-20 s load overlaps with download + separation + convert. The
    # `transcribe()` call later joins the thread before running.
    # If the captions branch returns early without transcribing, the daemon
    # thread is killed on process exit — wasted RAM is bounded by the
    # selection rules in `should_preload_whisper`.
    preload_thread = (
        _start_whisper_preload(args)
        if should_preload_whisper(args, is_url_input)
        else None
    )
    if is_url_input and args.subtitle_source != "local" and not args.separate:
        emit_progress("download", progress=0.0, message="Fetching platform subtitles")
        platform_result = download_url_subtitles(args.input, output_dir, args)
        if platform_result is not None:
            base_name, cues, metadata = platform_result
            emit_progress("download", progress=1.0, message="Platform subtitles ready", done=True)
            cues = maybe_simplify_chinese(cues, metadata, args)
            emit_progress("write", progress=0.0, message="Writing subtitle files")
            outputs = write_outputs(output_dir, base_name, cues, metadata, formats)
            emit_progress("write", progress=1.0, done=True)
            if args.save_audio:
                emit_progress("download", progress=0.0, message="Saving audio copy")
                saved_audio, saved_audio_cleanup = download_url_audio(args.input, output_dir, args)
                outputs.append(saved_audio)
                saved_audio_cleanup()
                emit_progress("download", progress=1.0, done=True)
            if args.save_video_preview:
                emit_progress("preview", progress=0.0, message="Downloading preview video")
                saved_video = maybe_download_url_video_preview(args.input, output_dir, args)
                if saved_video:
                    outputs.append(saved_video)
                emit_progress("preview", progress=1.0, done=True)
            print(f"Source: {args.input}")
            print("Subtitle source: Platform")
            print(f"Output directory: {output_dir}")
            for path in outputs:
                print(path)
            return 0
        local_fallback = args.local_fallback or should_default_to_local_fallback(args.input, args)
        if args.subtitle_source == "platform" or not local_fallback:
            emit_progress("download", progress=1.0, message="No platform subtitles", failed=True, done=True)
            raise SystemExit(
                "No platform subtitles found for the requested language(s). "
                "Rerun with --local-fallback to use the local Whisper model, "
                "or use --subtitle-source local to skip platform subtitles."
            )
        emit_progress("download", progress=1.0, message="No platform subtitles, using local transcription", done=True)
        print("No platform subtitles found; falling back to local transcription.", file=sys.stderr)

    cleanups: list[Callable[[], None]] = []
    emit_progress("download", progress=0.0, message="Fetching media")
    source, source_cleanup = resolve_source(args.input, args.stem, output_dir, args)
    cleanups.append(source_cleanup)
    emit_progress("download", progress=1.0, message="Media ready", done=True)
    if args.separate:
        stem_kind = separated_stem_kind(source)
        if stem_kind is not None:
            replacement = choose_vocal_sibling(source) if stem_kind == "instrumental" else None
            if replacement is not None:
                source = replacement
                message = "Input was an instrumental stem; using sibling vocal stem"
            else:
                message = "Input is already a separated stem; skipping separation"
            print(message, file=sys.stderr)
            emit_progress("separate", progress=1.0, done=True, message=message)
        else:
            emit_progress("separate", progress=0.0, message="Separating vocals")
            try:
                source = separate_source(source, output_dir, args)
                emit_progress("separate", progress=1.0, done=True)
            except subprocess.CalledProcessError as exc:
                # Vocal separation is an enhancement, not a hard requirement.
                # Common runtime failures here: audio-separator's first-run model
                # download (HF Hub flaky for some networks), ONNX runtime version
                # mismatch, or model file corruption. Falling back to the original
                # source still yields usable lyrics + karaoke-ready outputs; the
                # only thing the user loses is isolated vocal/instrumental stems.
                warning = (
                    f"Vocal separation failed (audio-separator exit {exc.returncode}); "
                    "continuing with original source so subtitles can still be produced."
                )
                print(warning, file=sys.stderr)
                emit_progress(
                    "separate",
                    progress=1.0,
                    failed=True,
                    done=True,
                    message="Separation skipped",
                )
            except SystemExit:
                # Missing-binary / no-output paths re-raise so the desktop app's
                # error classifier can surface a localized "install audio-separator"
                # hint instead of silently degrading the output.
                emit_progress("separate", progress=1.0, failed=True, done=True)
                raise
    base_name = safe_stem(source)
    emit_progress("convert", progress=0.0, message="Converting to 16 kHz mono")
    audio_path, cleanup = prepare_audio(source, output_dir, base_name, args.save_audio)
    cleanups.append(cleanup)
    emit_progress("convert", progress=1.0, done=True)
    try:
        emit_progress("transcribe", progress=0.0, message="Running speech-to-text")
        cues, metadata = transcribe(audio_path, args, preload_thread=preload_thread)
        emit_progress("transcribe", progress=1.0, done=True)
    except SystemExit:
        emit_progress("transcribe", progress=1.0, failed=True, done=True)
        raise
    except Exception:
        emit_progress("transcribe", progress=1.0, failed=True, done=True)
        raise
    finally:
        for cleanup_func in reversed(cleanups):
            cleanup_func()

    cues = maybe_simplify_chinese(cues, metadata, args)
    emit_progress("write", progress=0.0, message="Writing subtitle files")
    outputs = write_outputs(output_dir, base_name, cues, metadata, formats)
    emit_progress("write", progress=1.0, done=True)
    if args.save_audio:
        outputs.append(audio_path)
    if args.save_video_preview and is_url(args.input):
        emit_progress("preview", progress=0.0, message="Downloading preview video")
        saved_video = maybe_download_url_video_preview(args.input, output_dir, args)
        if saved_video:
            outputs.append(saved_video)
        emit_progress("preview", progress=1.0, done=True)

    print(f"Source: {source}")
    print(f"Output directory: {output_dir}")
    for path in outputs:
        print(path)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate SRT, VTT, LRC, TXT, JSON, and ASS subtitles from audio, video, or UVR vocal stems."
    )
    parser.add_argument("input", help="Audio/video file, UVR output folder, or media URL such as YouTube or Bilibili.")
    parser.add_argument("--output-dir", help="Directory for generated subtitle files.")
    parser.add_argument("--model", default="medium", help="Whisper model name, e.g. small, medium, large-v3-turbo.")
    parser.add_argument("--language", help="Language code such as en, zh, ja. Omit for auto-detect.")
    parser.add_argument("--task", choices=["transcribe", "translate"], default="transcribe")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--compute-type", default="auto", help="auto, int8, float16, float32, int8_float16.")
    parser.add_argument("--formats", default="srt,vtt,lrc,txt,json,ass", help="Comma list: srt,vtt,lrc,txt,json,ass.")
    parser.add_argument(
        "--word-engine",
        choices=["auto", "whisper_timestamped", "faster_whisper"],
        default="auto",
        help="Word timing engine for local transcription. auto prefers whisper_timestamped and falls back to faster_whisper.",
    )
    parser.add_argument("--stem", choices=["auto", "vocals", "instrumental", "none"], default="auto")
    parser.add_argument("--separate", action="store_true", help="Separate vocals/instrumental first with audio-separator.")
    parser.add_argument("--separator-model", help="audio-separator model filename. Omit to use its default.")
    parser.add_argument("--separator-preset", help="audio-separator ensemble preset, e.g. vocal_balanced.")
    parser.add_argument("--separator-output-dir", help="Directory for separated stems. Defaults to output-dir/stems.")
    parser.add_argument("--separator-format", default="WAV", help="Stem output format for audio-separator.")
    parser.add_argument(
        "--separator-model-dir",
        help=(
            "Folder where audio-separator should look for / cache model files. "
            "Useful for reusing an existing Ultimate Vocal Remover (UVR) model "
            "pool, or for users on networks where huggingface.co is unreachable."
        ),
    )
    parser.add_argument("--browser", help="Use yt-dlp cookies from browser, e.g. chrome or safari.")
    parser.add_argument("--cookies", help="Use a Netscape-format cookies.txt file with yt-dlp.")
    parser.add_argument(
        "--subtitle-source",
        choices=["auto", "platform", "youtube", "local"],
        default="auto",
        help="For URLs: auto/platform tries platform subtitles first; local uses Whisper directly. youtube is kept as a compatibility alias for platform.",
    )
    parser.add_argument("--sub-langs", help="yt-dlp subtitle language selector, e.g. zh.*,en.* or all,-live_chat.")
    parser.add_argument("--local-fallback", action="store_true", help="For URL auto mode, use local Whisper if no platform subtitles exist.")
    parser.add_argument("--force-local", action="store_true", help="Alias for --subtitle-source local.")
    parser.add_argument("--keep-platform-subs", action="store_true", help="Keep raw subtitle files downloaded by yt-dlp.")
    parser.add_argument("--max-line-chars", type=int, default=42)
    parser.add_argument("--max-line-words", type=int, default=10)
    parser.add_argument("--line-gap", type=float, default=1.15, help="Start a new lyric line after this word gap in seconds.")
    parser.add_argument("--no-word-timestamps", action="store_true", help="Use segment timestamps only.")
    parser.add_argument("--save-audio", action="store_true", help="Save extracted 16 kHz mono WAV next to outputs.")
    parser.add_argument("--save-video-preview", action="store_true", help="Save a low-resolution local video preview for in-app karaoke playback.")
    parser.add_argument("--vad-filter", action="store_true", help="Enable VAD filtering for the selected local word engine.")
    parser.add_argument(
        "--simplified-chinese",
        action="store_true",
        help="Convert Traditional Chinese subtitle text to Simplified Chinese before writing outputs.",
    )
    parser.add_argument(
        "--no-preload-whisper",
        action="store_true",
        help="Disable overlapping whisper model load with download/separation. Use on low-RAM systems.",
    )
    return parser.parse_args()


def maybe_reexec_venv() -> None:
    venv_python = Path(os.environ.get("AUDIO_SUBTITLES_PYTHON", DEFAULT_VENV / "bin/python")).expanduser()
    if not venv_python.exists():
        return
    if Path(sys.executable) != venv_python:
        os.execv(str(venv_python), [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])


def resolve_source(input_value: str, stem: str, output_dir: Path, args: argparse.Namespace) -> tuple[Path, Callable[[], None]]:
    if is_url(input_value):
        return download_url_audio(input_value, output_dir, args)

    path = Path(input_value).expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"Input not found: {path}")
    if path.is_file():
        if path.suffix.lower() not in MEDIA_EXTS:
            raise SystemExit(f"Unsupported media file: {path}")
        return path, lambda: None
    candidates = [p for p in path.rglob("*") if p.is_file() and p.suffix.lower() in MEDIA_EXTS]
    if not candidates:
        raise SystemExit(f"No supported media files found in: {path}")
    return choose_stem(candidates, stem), lambda: None


def choose_stem(candidates: list[Path], stem: str) -> Path:
    scored = sorted(((stem_score(path, stem), str(path).lower(), path) for path in candidates), reverse=True)
    best_score, _, best_path = scored[0]
    if stem in {"vocals", "instrumental"} and best_score < 50:
        raise SystemExit(f"No likely {stem} stem found. Pass the exact file instead.")
    return best_path


def separated_stem_kind(path: Path) -> str | None:
    vocal_score = stem_score(path, "vocals")
    instrumental_score = stem_score(path, "instrumental")
    if vocal_score >= 50 and vocal_score > instrumental_score:
        return "vocals"
    if instrumental_score >= 50 and instrumental_score > vocal_score:
        return "instrumental"
    return None


def choose_vocal_sibling(path: Path) -> Path | None:
    candidates = [p for p in path.parent.iterdir() if p.is_file() and p.suffix.lower() in MEDIA_EXTS]
    if not candidates:
        return None

    try:
        vocal = choose_stem(candidates, "vocals")
    except SystemExit:
        return None

    return vocal if vocal.resolve() != path.resolve() else None


def stem_score(path: Path, stem: str) -> int:
    name = path.stem.lower()
    score = 0

    # audio-separator's output naming is reliable: it always wraps the stem
    # type in parens, e.g. `<base>_(Vocals)_<modelName>.mp3` /
    # `<base>_(Instrumental)_<modelName>.mp3`. Match these parenthetical
    # markers FIRST, with decisive weight, so the model name itself
    # (often "MDX-NET-Inst_HQ_3", "BS-Roformer", "Voc_FT", etc.) doesn't
    # poison the heuristic via a naive substring match. This keeps the
    # picker correct across every UVR / audio-separator model preset.
    has_paren_vocals = "(vocals)" in name or "(vocal)" in name
    has_paren_instrumental = "(instrumental)" in name or "(inst)" in name

    if stem in {"auto", "vocals"}:
        if has_paren_vocals:
            score += 200
        elif has_paren_instrumental:
            score -= 200
    elif stem == "instrumental":
        if has_paren_instrumental:
            score += 200
        elif has_paren_vocals:
            score -= 200

    # Weaker substring fallbacks for non-paren naming conventions
    # (legacy demucs outputs, manual exports, "<song> vocals.wav"). Lower
    # weight than the paren rules above so they can't override a clean
    # paren match.
    vocal_markers = ["vocals", "vocal", "voice", "voices", "acapella", "a capella", "karaoke-vocal"]
    instrumental_markers = ["no_vocals", "no-vocals", "accompaniment", "karaoke", "instrumental", "inst"]

    if stem in {"auto", "vocals"}:
        if any(marker in name for marker in vocal_markers):
            score += 30
        if any(marker in name for marker in instrumental_markers):
            score -= 25
    elif stem == "instrumental":
        if any(marker in name for marker in instrumental_markers):
            score += 30
        if any(marker in name for marker in vocal_markers):
            score -= 25
    else:
        score += 10

    if path.suffix.lower() == ".wav":
        score += 8
    if path.suffix.lower() in VIDEO_EXTS:
        score -= 5
    return score


def default_output_dir(input_value: str) -> Path:
    if is_url(input_value):
        return Path.home() / "Downloads/VocalFlow Studio"
    original = Path(input_value).expanduser().resolve()
    return original if original.is_dir() else original.parent


def require_binary(name: str) -> None:
    if shutil.which(name) is None:
        raise SystemExit(f"Missing dependency: {name}. Install ffmpeg first.")


def is_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def should_default_to_local_fallback(input_value: str, args: argparse.Namespace) -> bool:
    return args.subtitle_source == "auto" and is_bilibili_url(input_value)


def is_bilibili_url(value: str) -> bool:
    parsed = urlparse(value)
    host = parsed.netloc.lower()
    return host == "b23.tv" or host.endswith(".bilibili.com") or host == "bilibili.com"


def _tee_stderr_to_real_stderr(proc: "subprocess.Popen[str]") -> tuple[list[str], threading.Thread]:
    """Forward ``proc.stderr`` to the real ``sys.stderr`` line-by-line.

    Each line is written to ``sys.stderr`` as soon as it arrives so the desktop
    main process sees yt-dlp / ffmpeg progress live. Each line is also appended
    to the returned buffer so the caller can recover the last error line for
    failure messages after the process exits. The reader runs in a daemon
    thread; the caller should ``thread.join()`` after ``proc.wait()`` so the
    final lines are captured before the buffer is consumed.
    """
    buffer: list[str] = []

    def _drain() -> None:
        if proc.stderr is None:
            return
        for line in proc.stderr:
            buffer.append(line)
            try:
                sys.stderr.write(line)
                sys.stderr.flush()
            except Exception:
                # Never let a tee failure crash a real job.
                pass

    thread = threading.Thread(target=_drain, daemon=True)
    thread.start()
    return buffer, thread


def _run_with_live_stderr(cmd: list[str], *, check: bool = True) -> "subprocess.CompletedProcess[str]":
    """Run ``cmd`` capturing stdout/stderr while teeing stderr to real stderr.

    Behaves like ``subprocess.run(cmd, check=check, text=True, stdout=PIPE,
    stderr=PIPE)`` but writes each stderr line through to ``sys.stderr`` as it
    arrives. Captured stderr is still available on the returned
    ``CompletedProcess`` (and on ``CalledProcessError.stderr`` when ``check``
    raises) so callers can keep producing the same failure messages they did
    before — the desktop just additionally sees the live progress stream.
    """
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    stderr_buffer, tee_thread = _tee_stderr_to_real_stderr(proc)
    stdout_text = proc.stdout.read() if proc.stdout is not None else ""
    if proc.stdout is not None:
        proc.stdout.close()
    returncode = proc.wait()
    tee_thread.join()
    if proc.stderr is not None:
        proc.stderr.close()
    stderr_text = "".join(stderr_buffer)
    if check and returncode != 0:
        raise subprocess.CalledProcessError(returncode, cmd, stdout_text, stderr_text)
    return subprocess.CompletedProcess(cmd, returncode, stdout_text, stderr_text)


def download_url_audio(url: str, output_dir: Path, args: argparse.Namespace) -> tuple[Path, Callable[[], None]]:
    require_binary("yt-dlp")
    if args.save_audio:
        download_dir = output_dir
        cleanup = lambda: None
    else:
        temp_dir = tempfile.TemporaryDirectory(prefix="audio-subtitles-url-")
        download_dir = Path(temp_dir.name)
        cleanup = temp_dir.cleanup

    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format",
        "wav",
        "--audio-quality",
        "0",
        "--no-playlist",
        "--newline",
        "-P",
        str(download_dir),
        "-o",
        "%(title).180B [%(id)s].%(ext)s",
        "--print",
        "after_move:filepath",
        url,
    ]
    if args.browser:
        cmd[1:1] = ["--cookies-from-browser", args.browser]
    if args.cookies:
        cmd[1:1] = ["--cookies", args.cookies]
    result = subprocess.run(cmd, check=True, text=True, stdout=subprocess.PIPE)
    paths = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]
    for path in reversed(paths):
        if path.exists():
            return path, cleanup
    media_files = sorted(download_dir.glob("*"))
    for path in media_files:
        if path.is_file() and path.suffix.lower() in MEDIA_EXTS:
            return path, cleanup
    cleanup()
    raise SystemExit("yt-dlp finished but no downloaded audio file was found.")


def maybe_download_url_video_preview(url: str, output_dir: Path, args: argparse.Namespace) -> Path | None:
    try:
        return download_url_video_preview(url, output_dir, args)
    except subprocess.CalledProcessError as exc:
        message = last_error_line(exc.stderr or exc.stdout or str(exc))
        print(f"Video preview download failed; continuing without local video preview: {message}", file=sys.stderr)
    except Exception as exc:
        print(f"Video preview download failed; continuing without local video preview: {exc}", file=sys.stderr)
    return None


def download_url_video_preview(url: str, output_dir: Path, args: argparse.Namespace) -> Path:
    require_binary("yt-dlp")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--newline",
        "-f",
        "bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720][ext=mp4]/b[height<=720]/best[height<=720]",
        "--merge-output-format",
        "mp4",
        "-P",
        str(output_dir),
        "-o",
        "%(title).180B [%(id)s].preview.%(ext)s",
        "--print",
        "after_move:filepath",
        url,
    ]
    if args.browser:
        cmd[1:1] = ["--cookies-from-browser", args.browser]
    if args.cookies:
        cmd[1:1] = ["--cookies", args.cookies]

    result = _run_with_live_stderr(cmd, check=True)
    paths = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]
    for path in reversed(paths):
        if path.exists() and path.suffix.lower() in VIDEO_EXTS:
            return path

    candidates = sorted(output_dir.glob("*.preview.*"))
    for path in candidates:
        if path.is_file() and path.suffix.lower() in VIDEO_EXTS:
            return path
    raise RuntimeError("yt-dlp finished but no downloaded video preview file was found.")


def download_url_subtitles(url: str, output_dir: Path, args: argparse.Namespace) -> tuple[str, list[Cue], dict] | None:
    require_binary("yt-dlp")
    if args.keep_platform_subs:
        subtitle_dir = output_dir
        cleanup = lambda: None
    else:
        temp_dir = tempfile.TemporaryDirectory(prefix="audio-subtitles-platform-")
        subtitle_dir = Path(temp_dir.name)
        cleanup = temp_dir.cleanup

    info = fetch_url_info(url, args)
    subtitle_choice = choose_subtitle_language(info, args)
    if subtitle_choice is None:
        cleanup()
        return None
    selected_lang, subtitle_kind = subtitle_choice
    cmd = [
        "yt-dlp",
        "--skip-download",
        "--no-playlist",
        "--newline",
        "--sub-format",
        "vtt",
        "--sub-langs",
        selected_lang,
        "-P",
        str(subtitle_dir),
        "-o",
        "%(title).180B [%(id)s].%(ext)s",
        url,
    ]
    if subtitle_kind == "manual":
        cmd.insert(3, "--write-subs")
    else:
        cmd.insert(3, "--write-auto-subs")
    if args.browser:
        cmd[1:1] = ["--cookies-from-browser", args.browser]
    if args.cookies:
        cmd[1:1] = ["--cookies", args.cookies]

    try:
        _run_with_live_stderr(cmd, check=True)
        candidates = [path for path in subtitle_dir.glob("*.vtt") if "live_chat" not in path.name]
        if not candidates:
            return None
        subtitle_path = choose_subtitle_file(candidates, args.language)
        cues = parse_vtt(subtitle_path)
        if not cues:
            return None
        base_name = strip_subtitle_suffix(subtitle_path)
        metadata = {
            "source": "platform-subtitles",
            "model": None,
            "device": None,
            "compute_type": None,
            "language": infer_subtitle_language(subtitle_path),
            "language_probability": None,
            "duration": cues[-1].end if cues else None,
            "subtitle_file": str(subtitle_path) if args.keep_platform_subs else None,
            "subtitle_language": selected_lang,
            "subtitle_kind": subtitle_kind,
            "subtitle_language_selector": args.sub_langs or args.language or "auto",
            "word_engine": "platform",
            "word_timing_source": "estimated",
            "has_word_timestamps": False,
        }
        return base_name, cues, metadata
    except subprocess.CalledProcessError as exc:
        message = last_error_line(exc.stderr or exc.stdout or str(exc))
        if (args.local_fallback or should_default_to_local_fallback(url, args)) and args.subtitle_source == "auto":
            print(f"Platform subtitle download failed; falling back to local transcription: {message}", file=sys.stderr)
            return None
        raise SystemExit(f"yt-dlp failed while downloading platform subtitle '{selected_lang}': {message}") from exc
    finally:
        if not args.keep_platform_subs:
            cleanup()


def fetch_url_info(url: str, args: argparse.Namespace) -> dict:
    cmd = ["yt-dlp", "--skip-download", "--no-playlist", "--newline", "--dump-single-json", url]
    if args.browser:
        cmd[1:1] = ["--cookies-from-browser", args.browser]
    if args.cookies:
        cmd[1:1] = ["--cookies", args.cookies]
    try:
        result = _run_with_live_stderr(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        message = last_error_line(exc.stderr or exc.stdout or str(exc))
        raise SystemExit(f"yt-dlp failed while reading URL metadata: {message}") from exc
    return json.loads(result.stdout)


def choose_subtitle_language(info: dict, args: argparse.Namespace) -> tuple[str, str] | None:
    manual = sorted(code for code in (info.get("subtitles") or {}) if "live_chat" not in code)
    automatic = sorted(code for code in (info.get("automatic_captions") or {}) if "live_chat" not in code)
    if not manual and not automatic:
        return None

    if args.sub_langs:
        selectors = [item.strip() for item in args.sub_langs.split(",") if item.strip() and not item.strip().startswith("-")]
        for selector in selectors:
            choice = match_subtitle_selector(selector, manual, automatic)
            if choice is not None:
                return choice

    if args.language:
        choice = match_subtitle_selector(args.language, manual, automatic)
        if choice is not None:
            return choice

    for selector in default_subtitle_priorities():
        choice = match_subtitle_selector(selector, manual, automatic)
        if choice is not None:
            return choice

    if manual:
        return manual[0], "manual"
    return automatic[0], "automatic"


def match_subtitle_selector(selector: str, manual: list[str], automatic: list[str]) -> tuple[str, str] | None:
    if selector == "all":
        for preferred in default_subtitle_priorities():
            choice = match_subtitle_selector(preferred, manual, automatic)
            if choice is not None:
                return choice
        if manual:
            return manual[0], "manual"
        if automatic:
            return automatic[0], "automatic"
        return None

    patterns = selector_patterns(selector)
    for code in manual:
        if any(subtitle_code_matches(code, pattern) for pattern in patterns):
            return code, "manual"
    for code in automatic:
        if any(subtitle_code_matches(code, pattern) for pattern in patterns):
            return code, "automatic"
    return None


def selector_patterns(selector: str) -> list[str]:
    selector = selector.strip()
    if not selector:
        return []
    if any(char in selector for char in "*?[]"):
        return [selector]
    return [selector, f"{selector}-*", f"{selector}_*"]


def subtitle_code_matches(code: str, pattern: str) -> bool:
    return code == pattern or fnmatch.fnmatchcase(code, pattern)


def default_subtitle_priorities() -> list[str]:
    return [
        "en",
        "en-*",
        "zh-Hans",
        "zh-CN",
        "zh",
        "zh-*",
        "zh-Hant",
        "zh-TW",
        "ja",
        "ja-*",
        "ko",
        "ko-*",
        "es",
        "es-*",
        "fr",
        "fr-*",
        "pt-BR",
        "pt-*",
        "fil",
        "fil-*",
    ]


def last_error_line(output: str) -> str:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    for line in reversed(lines):
        if "ERROR:" in line or "WARNING:" in line:
            return line
    return lines[-1] if lines else "unknown error"


def choose_subtitle_file(candidates: list[Path], language: str | None) -> Path:
    priorities = [language] if language else []
    priorities.extend(["zh-Hans", "zh-CN", "zh", "zh-Hant", "zh-TW", "en", "ja", "ko"])

    def score(path: Path) -> tuple[int, str]:
        lang = infer_subtitle_language(path)
        for index, priority in enumerate(priorities):
            if priority and lang.lower().startswith(priority.lower()):
                return (100 - index, path.name)
        return (0, path.name)

    return sorted(candidates, key=score, reverse=True)[0]


def infer_subtitle_language(path: Path) -> str:
    stem = path.stem
    if "." not in stem:
        return ""
    return stem.rsplit(".", 1)[1]


def strip_subtitle_suffix(path: Path) -> str:
    stem = path.stem
    if "." in stem:
        stem = stem.rsplit(".", 1)[0]
    return safe_name(stem)


def parse_vtt(path: Path) -> list[Cue]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    cues: list[Cue] = []
    current_start: float | None = None
    current_end: float | None = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_start, current_end, current_lines
        if current_start is not None and current_end is not None and current_lines:
            cue_text = clean_subtitle_text(" ".join(current_lines))
            if cue_text:
                cues.append(Cue(current_start, max(current_end, current_start + 0.25), cue_text))
        current_start = None
        current_end = None
        current_lines = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            flush()
            continue
        if line == "WEBVTT" or line.startswith(("NOTE", "STYLE", "REGION", "Kind:", "Language:")):
            continue
        match = re.match(r"(?P<start>\d{2}:\d{2}(?::\d{2})?[\.,]\d{3})\s+-->\s+(?P<end>\d{2}:\d{2}(?::\d{2})?[\.,]\d{3})", line)
        if match:
            flush()
            current_start = parse_subtitle_time(match.group("start"))
            current_end = parse_subtitle_time(match.group("end"))
            continue
        if current_start is None:
            continue
        current_lines.append(line)
    flush()
    return dedupe_adjacent_cues(cues)


def parse_subtitle_time(value: str) -> float:
    normalized = value.replace(",", ".")
    parts = normalized.split(":")
    if len(parts) == 3:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
    elif len(parts) == 2:
        hours = 0
        minutes = int(parts[0])
        seconds = float(parts[1])
    else:
        raise ValueError(f"Invalid subtitle timestamp: {value}")
    return hours * 3600 + minutes * 60 + seconds


def clean_subtitle_text(text: str) -> str:
    text = re.sub(r"<\d{2}:\d{2}(?::\d{2})?[\.,]\d{3}>", " ", text)
    text = re.sub(r"</?[^>]+>", " ", text)
    text = unescape(text)
    return clean_text(text)


def dedupe_adjacent_cues(cues: list[Cue]) -> list[Cue]:
    deduped: list[Cue] = []
    previous_text = ""
    for cue in cues:
        normalized = cue.text.casefold()
        if normalized == previous_text:
            continue
        deduped.append(cue)
        previous_text = normalized
    return deduped


def separate_source(source: Path, output_dir: Path, args: argparse.Namespace) -> Path:
    separator = find_audio_separator()
    stems_dir = Path(args.separator_output_dir).expanduser() if args.separator_output_dir else output_dir / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)
    before = {path.resolve() for path in stems_dir.rglob("*") if path.is_file()}
    cmd = [
        str(separator),
        str(source),
        "--output_dir",
        str(stems_dir),
        "--output_format",
        args.separator_format,
    ]
    if args.separator_model:
        cmd.extend(["--model_filename", args.separator_model])
    if args.separator_preset:
        cmd.extend(["--ensemble_preset", args.separator_preset])
    if args.separator_model_dir:
        # Reuse a pre-existing UVR / manually-downloaded model pool instead
        # of pulling from huggingface.co. Critical for offline / firewalled
        # environments where the default HF download would hang or fail.
        model_dir = Path(args.separator_model_dir).expanduser()
        model_dir.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--model_file_dir", str(model_dir)])
    started_at = time.time()
    subprocess.run(cmd, check=True)
    after = [
        path
        for path in stems_dir.rglob("*")
        if path.is_file()
        and (
            path.resolve() not in before
            or path.stat().st_mtime >= started_at - 2
        )
    ]
    candidates = [path for path in after if path.suffix.lower() in MEDIA_EXTS]
    if not candidates:
        candidates = [path for path in stems_dir.rglob("*") if path.is_file() and path.suffix.lower() in MEDIA_EXTS]
    if not candidates:
        raise SystemExit(f"audio-separator produced no supported stem files in: {stems_dir}")
    vocal = choose_stem(candidates, "vocals")
    print(f"Separated stems directory: {stems_dir}", file=sys.stderr)
    print(f"Transcribing vocal stem: {vocal}", file=sys.stderr)
    for path in sorted(candidates):
        print(path)
    return vocal


def find_audio_separator() -> Path:
    candidates = [
        Path(sys.executable).parent / "audio-separator",
        Path.home() / ".local/share/audio-subtitles-venv/bin/audio-separator",
    ]
    found = shutil.which("audio-separator")
    if found:
        candidates.append(Path(found))
    for candidate in candidates:
        if candidate.exists() and os.access(candidate, os.X_OK):
            return candidate
    setup_script = SKILL_DIR / "scripts/setup_audio_separator.sh"
    raise SystemExit(
        "Missing dependency: audio-separator\n"
        f"Install it with: {setup_script}\n"
        "Then rerun with --separate."
    )


def prepare_audio(source: Path, output_dir: Path, base_name: str, save_audio: bool) -> tuple[Path, Callable[[], None]]:
    if save_audio:
        audio_path = output_dir / f"{base_name}.transcribe.wav"
        convert_audio(source, audio_path)
        return audio_path, lambda: None

    temp_dir = tempfile.TemporaryDirectory(prefix="audio-subtitles-")
    audio_path = Path(temp_dir.name) / "audio.wav"
    convert_audio(source, audio_path)
    return audio_path, temp_dir.cleanup


def probe_duration_seconds(source: Path) -> float | None:
    if shutil.which("ffprobe") is None:
        return None

    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(source),
    ]
    try:
        result = subprocess.run(cmd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        duration = float(result.stdout.strip())
        return duration if duration > 0 else None
    except Exception:
        return None


def parse_ffmpeg_progress_seconds(value: str) -> float | None:
    """Convert ffmpeg's microsecond progress value into a safe timestamp.

    ffmpeg can emit AV_NOPTS_VALUE (a very large negative integer) before it
    has a usable output timestamp. Treat that and other invalid values as
    unavailable so implementation details never appear in progress copy.
    """
    try:
        current = float(value) / 1_000_000.0
    except ValueError:
        return None
    return current if math.isfinite(current) and current >= 0 else None


def convert_audio(source: Path, target: Path) -> None:
    duration = probe_duration_seconds(source)
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-progress",
        "pipe:1",
        "-nostats",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(target),
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    stderr_buffer, tee_thread = _tee_stderr_to_real_stderr(proc)
    stdout_lines: list[str] = []
    last_emit_at = 0.0

    try:
        if proc.stdout is not None:
            for line in proc.stdout:
                stdout_lines.append(line)
                key, _, value = line.strip().partition("=")
                if key not in {"out_time_ms", "out_time_us"}:
                    continue

                current = parse_ffmpeg_progress_seconds(value)
                if current is None:
                    continue

                now = time.monotonic()
                if duration and now - last_emit_at >= 0.5:
                    display_current = min(current, duration)
                    emit_progress(
                        "convert",
                        progress=min(0.99, display_current / duration),
                        message=f"{display_current:.0f}s / {duration:.0f}s",
                    )
                    last_emit_at = now
    finally:
        if proc.stdout is not None:
            proc.stdout.close()

    returncode = proc.wait()
    tee_thread.join()
    if proc.stderr is not None:
        proc.stderr.close()

    stderr_text = "".join(stderr_buffer)
    stdout_text = "".join(stdout_lines)
    if returncode != 0:
        raise subprocess.CalledProcessError(returncode, cmd, stdout_text, stderr_text)


@dataclass
class PreloadedWhisper:
    """Whisper model + bookkeeping handed off from the preload thread.

    `engine` lets `transcribe()` skip the load step in the engine that
    matches; if the runtime engine selection diverges (e.g. preloaded
    whisper_timestamped but `--word-engine faster_whisper`), the model is
    discarded and a fresh load runs on demand.
    """

    engine: str
    model: object


def should_preload_whisper(args: argparse.Namespace, is_url_input: bool) -> bool:
    """Decide whether to overlap model load with download/separation.

    The cost of a wasted preload is ~600 MB RAM (int8 large-v3-turbo) and
    a few seconds of CPU; the win is 5-20 s removed from the user-visible
    transcribe stage. We only preload when transcription is *almost
    certain* to run so we don't burn that on captions-success URL flows.
    """
    if getattr(args, "no_preload_whisper", False):
        return False
    if not is_url_input:
        return True
    if args.subtitle_source == "local" or args.force_local:
        return True
    if args.separate:
        return True
    if args.local_fallback:
        return True
    return False


def _load_faster_whisper_model(args: argparse.Namespace) -> PreloadedWhisper:
    from faster_whisper import WhisperModel  # type: ignore[import-not-found]

    device = "cpu" if args.device == "auto" else args.device
    compute_type = "int8" if args.compute_type == "auto" and device == "cpu" else args.compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"
    model = WhisperModel(args.model, device=device, compute_type=compute_type)
    return PreloadedWhisper(engine="faster_whisper", model=model)


def _load_whisper_timestamped_model(args: argparse.Namespace) -> PreloadedWhisper:
    import whisper_timestamped as whisper  # type: ignore[import-not-found]

    device = "cpu" if args.device == "auto" else args.device
    model = whisper.load_model(args.model, device=device)
    return PreloadedWhisper(engine="whisper_timestamped", model=model)


def preload_whisper_for_args(args: argparse.Namespace) -> PreloadedWhisper:
    """Mirror the engine-selection logic of `transcribe()` for preload.

    Falls back to faster_whisper when the preferred engine fails so the
    preload never hard-fails the job: any failure here just makes the
    runtime path do its own load.
    """
    if args.word_engine == "faster_whisper":
        return _load_faster_whisper_model(args)
    if args.no_word_timestamps:
        return _load_faster_whisper_model(args)
    try:
        return _load_whisper_timestamped_model(args)
    except ImportError:
        if args.word_engine == "whisper_timestamped":
            raise
        return _load_faster_whisper_model(args)
    except Exception:
        if args.word_engine == "whisper_timestamped":
            raise
        return _load_faster_whisper_model(args)


def _start_whisper_preload(args: argparse.Namespace) -> threading.Thread | None:
    """Launch a daemon thread that loads the whisper model in the background.

    Returns the running thread (with `_preloaded` / `_preload_error`
    attributes set on completion), or None when preload is disabled.
    Joining the thread is the caller's responsibility — `transcribe()`
    does this before kicking off the actual model run.
    """
    state: dict[str, object] = {}

    def runner() -> None:
        try:
            state["preloaded"] = preload_whisper_for_args(args)
        except BaseException as exc:  # noqa: BLE001 - propagate via thread state
            state["error"] = exc

    thread = threading.Thread(target=runner, name="whisper-preload", daemon=True)
    thread.state = state  # type: ignore[attr-defined]
    thread.start()
    return thread


def _consume_preload(
    thread: threading.Thread | None,
) -> tuple[PreloadedWhisper | None, BaseException | None]:
    """Block until the preload thread completes; return its result."""
    if thread is None:
        return None, None
    thread.join()
    state: dict[str, object] = getattr(thread, "state", {})
    return (
        state.get("preloaded"),  # type: ignore[return-value]
        state.get("error"),  # type: ignore[return-value]
    )


def transcribe(
    audio_path: Path,
    args: argparse.Namespace,
    preload_thread: threading.Thread | None = None,
) -> tuple[list[Cue], dict]:
    preloaded, preload_error = _consume_preload(preload_thread)
    if preload_error is not None:
        # Preload failures are non-fatal: log once so the user can correlate
        # the slower runtime load below, then continue with the original
        # engine-selection logic from scratch.
        print(
            f"whisper preload failed; loading model on demand instead: {preload_error}",
            file=sys.stderr,
        )
        preloaded = None

    if args.word_engine in {"auto", "whisper_timestamped"} and not args.no_word_timestamps:
        try:
            return transcribe_with_whisper_timestamped(
                audio_path,
                args,
                preloaded=preloaded if preloaded and preloaded.engine == "whisper_timestamped" else None,
            )
        except ImportError as exc:
            if args.word_engine == "whisper_timestamped":
                setup_script = SKILL_DIR / "scripts/setup_faster_whisper.sh"
                raise SystemExit(
                    "Missing Python package: whisper-timestamped\n"
                    f"Install it with: {setup_script}\n"
                    "Then rerun the same audio-subtitles command."
                ) from exc
            print("whisper-timestamped is not installed; falling back to faster-whisper.", file=sys.stderr)
        except Exception:
            if args.word_engine == "whisper_timestamped":
                raise
            print("whisper-timestamped failed; falling back to faster-whisper.", file=sys.stderr)

    return transcribe_with_faster_whisper(
        audio_path,
        args,
        preloaded=preloaded if preloaded and preloaded.engine == "faster_whisper" else None,
    )


def transcribe_with_whisper_timestamped(
    audio_path: Path,
    args: argparse.Namespace,
    preloaded: PreloadedWhisper | None = None,
) -> tuple[list[Cue], dict]:
    import whisper_timestamped as whisper

    device = "cpu" if args.device == "auto" else args.device
    if preloaded is not None and preloaded.engine == "whisper_timestamped":
        model = preloaded.model
        emit_progress(
            "transcribe",
            progress=0.05,
            message=f"Reusing preloaded whisper-timestamped model: {args.model}",
        )
    else:
        emit_progress("transcribe", progress=0.0, message=f"Loading whisper-timestamped model: {args.model}")
        model = whisper.load_model(args.model, device=device)
    # TODO(progress): whisper-timestamped's whisper.transcribe(...) returns a
    # complete result dict instead of an incremental segment iterator, so we
    # cannot emit per-segment progress here. If a future version yields segments
    # incrementally, mirror the throttled per-segment loop in
    # transcribe_with_faster_whisper. Until then we only emit start/end so the
    # desktop has a structured fallback when the underlying tool stays silent.
    result = whisper.transcribe(
        model,
        str(audio_path),
        language=args.language,
        task=args.task,
        beam_size=5,
        best_of=5,
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
        vad=args.vad_filter,
    )
    emit_progress("transcribe", progress=1.0, message="done")
    cues = cues_from_timestamped_segments(result.get("segments", []), args)
    metadata = {
        "model": args.model,
        "device": device,
        "compute_type": None,
        "language": result.get("language"),
        "language_probability": result.get("language_probability"),
        "duration": result.get("duration"),
        "word_engine": "whisper_timestamped",
        "word_timing_source": "aligned" if cues_have_word_timestamps(cues) else "none",
        "has_word_timestamps": cues_have_word_timestamps(cues),
    }
    return cues, metadata


def transcribe_with_faster_whisper(
    audio_path: Path,
    args: argparse.Namespace,
    preloaded: PreloadedWhisper | None = None,
) -> tuple[list[Cue], dict]:
    device = "cpu" if args.device == "auto" else args.device
    compute_type = "int8" if args.compute_type == "auto" and device == "cpu" else args.compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    if preloaded is not None and preloaded.engine == "faster_whisper":
        model = preloaded.model
        emit_progress(
            "transcribe",
            progress=0.05,
            message=f"Reusing preloaded faster-whisper model: {args.model}",
        )
    else:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            setup_script = SKILL_DIR / "scripts/setup_faster_whisper.sh"
            raise SystemExit(
                "Missing Python package: faster-whisper\n"
                f"Install it with: {setup_script}\n"
                "Then rerun the same audio-subtitles command."
            ) from exc

        emit_progress("transcribe", progress=0.0, message=f"Loading faster-whisper model: {args.model}")
        model = WhisperModel(args.model, device=device, compute_type=compute_type)
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=args.language,
        task=args.task,
        beam_size=5,
        vad_filter=args.vad_filter,
        word_timestamps=not args.no_word_timestamps,
        condition_on_previous_text=False,
    )
    total_duration = float(getattr(info, "duration", 0.0) or 0.0)
    segment_list: list = []
    last_emit_at = 0.0
    for seg in segments_iter:
        segment_list.append(seg)
        current = float(getattr(seg, "end", 0.0) or 0.0)
        now = time.monotonic()
        # Throttle to <= 2 emits/sec so very fast files do not flood stderr.
        if total_duration and (now - last_emit_at >= 0.5):
            emit_progress(
                "transcribe",
                progress=min(0.99, current / total_duration),
                message=f"{current:.0f}s / {total_duration:.0f}s",
            )
            last_emit_at = now
    emit_progress("transcribe", progress=1.0, message="done")
    cues = cues_from_segments(segment_list, args)
    metadata = {
        "model": args.model,
        "device": device,
        "compute_type": compute_type,
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "word_engine": "faster_whisper",
        "word_timing_source": "faster_whisper" if cues_have_word_timestamps(cues) else "none",
        "has_word_timestamps": cues_have_word_timestamps(cues),
    }
    return cues, metadata


def cues_from_timestamped_segments(segments: Iterable[dict], args: argparse.Namespace) -> list[Cue]:
    cues: list[Cue] = []
    for segment in segments:
        words = segment.get("words") or []
        if words:
            cues.extend(cues_from_word_dicts(words, args.max_line_chars, args.max_line_words, args.line_gap))
        else:
            text = clean_text(str(segment.get("text", "")))
            start = float(segment.get("start", 0.0) or 0.0)
            end = float(segment.get("end", start + 0.25) or start + 0.25)
            if text:
                cues.append(Cue(start, max(end, start + 0.25), text))
    return [cue for cue in cues if cue.text]


def cues_from_segments(segments: Iterable[object], args: argparse.Namespace) -> list[Cue]:
    cues: list[Cue] = []
    for segment in segments:
        words = getattr(segment, "words", None)
        if words:
            cues.extend(cues_from_words(words, args.max_line_chars, args.max_line_words, args.line_gap))
        else:
            text = clean_text(getattr(segment, "text", ""))
            if text:
                cues.append(Cue(float(segment.start), float(segment.end), text))
    return [cue for cue in cues if cue.text]


def cues_from_words(words: Iterable[object], max_chars: int, max_words: int, line_gap: float) -> list[Cue]:
    cues: list[Cue] = []
    current_words: list[TimedWord] = []
    start: float | None = None
    end: float | None = None
    previous_end: float | None = None

    def flush() -> None:
        nonlocal current_words, start, end
        text = join_lyric_words(word.text for word in current_words)
        if text and start is not None and end is not None:
            cue_end = max(end, start + 0.25)
            cues.append(Cue(start, cue_end, text, [word for word in current_words if word.end > word.start]))
        current_words = []
        start = None
        end = None

    for item in words:
        word = clean_text(getattr(item, "word", ""))
        if not word:
            continue
        word_start = float(getattr(item, "start", previous_end or 0.0) or 0.0)
        word_end = float(getattr(item, "end", word_start + 0.3) or word_start + 0.3)
        probability = getattr(item, "probability", None)
        confidence = float(probability) if probability is not None else None
        gap = 0.0 if previous_end is None else word_start - previous_end
        next_len = len(" ".join([current_word.text for current_word in current_words] + [word]))
        if current_words and (gap > line_gap or len(current_words) >= max_words or next_len > max_chars):
            flush()
        if start is None:
            start = word_start
        current_words.append(TimedWord(word, word_start, max(word_end, word_start + 0.05), confidence))
        end = word_end
        previous_end = word_end
    flush()
    return cues


def cues_from_word_dicts(words: Iterable[dict], max_chars: int, max_words: int, line_gap: float) -> list[Cue]:
    cues: list[Cue] = []
    current_words: list[TimedWord] = []
    start: float | None = None
    end: float | None = None
    previous_end: float | None = None

    def flush() -> None:
        nonlocal current_words, start, end
        text = join_lyric_words(word.text for word in current_words)
        if text and start is not None and end is not None:
            cue_end = max(end, start + 0.25)
            cues.append(Cue(start, cue_end, text, [word for word in current_words if word.end > word.start]))
        current_words = []
        start = None
        end = None

    for item in words:
        word = clean_text(str(item.get("text") or item.get("word") or ""))
        if not word:
            continue
        word_start = float(item.get("start", previous_end or 0.0) or 0.0)
        word_end = float(item.get("end", word_start + 0.3) or word_start + 0.3)
        confidence_value = item.get("confidence", item.get("probability"))
        confidence = float(confidence_value) if confidence_value is not None else None
        gap = 0.0 if previous_end is None else word_start - previous_end
        next_len = len(" ".join([current_word.text for current_word in current_words] + [word]))
        if current_words and (gap > line_gap or len(current_words) >= max_words or next_len > max_chars):
            flush()
        if start is None:
            start = word_start
        current_words.append(TimedWord(word, word_start, max(word_end, word_start + 0.05), confidence))
        end = word_end
        previous_end = word_end
    flush()
    return cues


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def join_lyric_words(words: Iterable[str]) -> str:
    output: list[str] = []
    previous = ""
    for index, word in enumerate(words):
        output.append(word_text_prefix(previous, word, index) + word)
        previous = word
    return clean_text("".join(output))


def word_text_prefix(previous: str, current: str, index: int) -> str:
    if index == 0 or not previous:
        return ""
    if re.match(r"^[,.;:!?，。！？；：、）】》」』”’]$", current):
        return ""
    if re.match(r"^[（【《「『“‘]$", previous):
        return ""
    if is_compact_token(previous) or is_compact_token(current):
        return ""
    return " "


def parse_formats(value: str) -> set[str]:
    formats = {item.strip().lower() for item in value.split(",") if item.strip()}
    allowed = {"srt", "vtt", "lrc", "txt", "json", "ass"}
    unknown = formats - allowed
    if unknown:
        raise SystemExit(f"Unsupported formats: {', '.join(sorted(unknown))}")
    return formats


def get_t2s_converter() -> Callable[[str], str]:
    """Return a Traditional→Simplified converter, preferring zhconv then OpenCC."""
    try:
        import zhconv

        return lambda text: zhconv.convert(text, "zh-cn")
    except ImportError:
        pass
    try:
        from opencc import OpenCC

        converter = OpenCC("t2s")
        return converter.convert
    except ImportError as exc:
        raise SystemExit(
            "Missing Chinese conversion package for --simplified-chinese.\n"
            "Install it with: pip install zhconv\n"
            "Then rerun the same audio-subtitles command."
        ) from exc


def maybe_simplify_chinese(cues: list[Cue], metadata: dict, args: argparse.Namespace) -> list[Cue]:
    if not args.simplified_chinese:
        return cues
    convert = get_t2s_converter()
    simplified: list[Cue] = []
    for cue in cues:
        words = None
        if cue.words:
            words = [
                TimedWord(
                    text=convert(word.text),
                    start=word.start,
                    end=word.end,
                    confidence=word.confidence,
                )
                for word in cue.words
            ]
        simplified.append(Cue(cue.start, cue.end, convert(cue.text), words))
    metadata["simplified_chinese"] = True
    print("Converted subtitle text to Simplified Chinese.", file=sys.stderr)
    return simplified


def write_outputs(output_dir: Path, base_name: str, cues: list[Cue], metadata: dict, formats: set[str]) -> list[Path]:
    outputs: list[Path] = []
    if "srt" in formats:
        path = output_dir / f"{base_name}.srt"
        path.write_text(render_srt(cues), encoding="utf-8")
        outputs.append(path)
    if "vtt" in formats:
        path = output_dir / f"{base_name}.vtt"
        path.write_text(render_vtt(cues), encoding="utf-8")
        outputs.append(path)
    if "lrc" in formats:
        path = output_dir / f"{base_name}.lrc"
        path.write_text(render_lrc(cues), encoding="utf-8")
        outputs.append(path)
    if "txt" in formats:
        path = output_dir / f"{base_name}.txt"
        path.write_text(render_txt(cues, metadata), encoding="utf-8")
        outputs.append(path)
    if "json" in formats:
        path = output_dir / f"{base_name}.json"
        payload = {"metadata": metadata, "cues": [asdict(cue) for cue in cues]}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        outputs.append(path)
    if "ass" in formats:
        path = output_dir / f"{base_name}.ass"
        path.write_text(render_ass(cues, metadata), encoding="utf-8")
        outputs.append(path)
    return outputs


def render_srt(cues: list[Cue]) -> str:
    blocks = []
    for index, cue in enumerate(cues, 1):
        blocks.append(f"{index}\n{srt_time(cue.start)} --> {srt_time(cue.end)}\n{cue.text}")
    return "\n\n".join(blocks) + "\n"


def render_vtt(cues: list[Cue]) -> str:
    blocks = ["WEBVTT\n"]
    for cue in cues:
        blocks.append(f"{vtt_time(cue.start)} --> {vtt_time(cue.end)}\n{cue.text}")
    return "\n\n".join(blocks) + "\n"


def render_lrc(cues: list[Cue]) -> str:
    return "".join(f"[{lrc_time(cue.start)}] {cue.text}\n" for cue in cues)


def render_txt(cues: list[Cue], metadata: dict) -> str:
    lines = [
        f"source: {metadata.get('source', 'local-transcription')}",
        f"model: {metadata.get('model')}",
        f"language: {metadata.get('language')} ({metadata.get('language_probability')})",
        "",
    ]
    lines.extend(f"[{vtt_time(cue.start)} --> {vtt_time(cue.end)}] {cue.text}" for cue in cues)
    return "\n".join(lines) + "\n"


def render_ass(cues: list[Cue], metadata: dict) -> str:
    title = ass_escape(str(metadata.get("source") or "VocalFlow Karaoke"))
    header = [
        "[Script Info]",
        f"Title: {title}",
        "ScriptType: v4.00+",
        "PlayResX: 1280",
        "PlayResY: 720",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Arial,58,&H00FFFFFF,&H000078FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,80,80,54,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    events = []
    for cue in cues:
        words = cue.words if cue.words else infer_timed_words(cue)
        text = render_ass_karaoke_text(cue, words)
        events.append(f"Dialogue: 0,{ass_time(cue.start)},{ass_time(cue.end)},Default,,0,0,0,,{text}")
    return "\n".join([*header, *events, ""])


def render_ass_karaoke_text(cue: Cue, words: list[TimedWord]) -> str:
    if not words:
        duration = max(1, ass_centiseconds(cue.end - cue.start))
        return f"{{\\kf{duration}}}{ass_escape(cue.text)}"

    parts: list[str] = []
    cursor = cue.start
    previous_text = ""
    for index, word in enumerate(words):
        gap = max(0, ass_centiseconds(word.start - cursor))
        if gap:
            parts.append(f"{{\\k{gap}}}")
        duration = max(1, ass_centiseconds(word.end - word.start))
        text = word.text
        prefix = ass_word_prefix(previous_text, text, index)
        parts.append(f"{{\\kf{duration}}}{ass_escape(prefix + text)}")
        previous_text = text
        cursor = word.end
    return "".join(parts)


def infer_timed_words(cue: Cue) -> list[TimedWord]:
    tokens = tokenize_lyric_text(cue.text)
    if not tokens:
        return []
    duration = max(0.05, cue.end - cue.start)
    weights = [estimated_token_weight(token) for token in tokens]
    total_weight = sum(weights) or len(tokens)
    cursor = cue.start
    words: list[TimedWord] = []
    for index, token in enumerate(tokens):
        start = cursor if index > 0 else cue.start
        end = cue.end if index == len(tokens) - 1 else min(cue.end, start + duration * (weights[index] / total_weight))
        words.append(TimedWord(token, start, max(end, start + 0.01)))
        cursor = end
    return words


def tokenize_lyric_text(text: str) -> list[str]:
    return re.findall(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?|[^\s]", text)


def estimated_token_weight(token: str) -> float:
    if re.match(r"^[^\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+$", token):
        return 0.35
    if re.match(r"^[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]$", token):
        return 1.0
    return max(0.8, min(3.6, len(token) / 3))


def ass_word_prefix(previous: str, current: str, index: int) -> str:
    return word_text_prefix(previous, current, index)


def is_compact_token(token: str) -> bool:
    return bool(re.match(r"^[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]$", token))


def ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\r\n", "\\N").replace("\n", "\\N")


def ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    centis = int(round((seconds - int(seconds)) * 100))
    whole = int(seconds)
    if centis == 100:
        whole += 1
        centis = 0
    hrs = whole // 3600
    mins = (whole % 3600) // 60
    secs = whole % 60
    return f"{hrs}:{mins:02d}:{secs:02d}.{centis:02d}"


def ass_centiseconds(seconds: float) -> int:
    return max(0, int(round(seconds * 100)))


def cues_have_word_timestamps(cues: list[Cue]) -> bool:
    return any(bool(cue.words) for cue in cues)


def srt_time(seconds: float) -> str:
    return timestamp(seconds, comma=True, hours=True)


def vtt_time(seconds: float) -> str:
    return timestamp(seconds, comma=False, hours=True)


def lrc_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    minutes = int(seconds // 60)
    secs = seconds - minutes * 60
    return f"{minutes:02d}:{secs:05.2f}"


def timestamp(seconds: float, comma: bool, hours: bool) -> str:
    seconds = max(0.0, seconds)
    millis = int(round((seconds - int(seconds)) * 1000))
    whole = int(seconds)
    if millis == 1000:
        whole += 1
        millis = 0
    hrs = whole // 3600
    mins = (whole % 3600) // 60
    secs = whole % 60
    sep = "," if comma else "."
    if hours:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}{sep}{millis:03d}"
    return f"{mins:02d}:{secs:02d}{sep}{millis:03d}"


def safe_stem(path: Path) -> str:
    return safe_name(path.stem)


def safe_name(value: str) -> str:
    stem = re.sub(r"[\\/:*?\"<>|]+", "_", value).strip()
    return stem or "subtitles"


if __name__ == "__main__":
    raise SystemExit(main())
