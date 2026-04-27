#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
from html import unescape
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlparse


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
    maybe_reexec_venv()
    args = parse_args()
    if args.subtitle_source == "youtube":
        args.subtitle_source = "platform"
    if args.force_local:
        args.subtitle_source = "local"

    output_dir = Path(args.output_dir).expanduser() if args.output_dir else default_output_dir(args.input)
    output_dir.mkdir(parents=True, exist_ok=True)

    formats = parse_formats(args.formats)
    if is_url(args.input) and args.subtitle_source != "local" and not args.separate:
        platform_result = download_url_subtitles(args.input, output_dir, args)
        if platform_result is not None:
            base_name, cues, metadata = platform_result
            outputs = write_outputs(output_dir, base_name, cues, metadata, formats)
            if args.save_audio:
                saved_audio, saved_audio_cleanup = download_url_audio(args.input, output_dir, args)
                outputs.append(saved_audio)
                saved_audio_cleanup()
            if args.save_video_preview:
                saved_video = maybe_download_url_video_preview(args.input, output_dir, args)
                if saved_video:
                    outputs.append(saved_video)
            print(f"Source: {args.input}")
            print("Subtitle source: Platform")
            print(f"Output directory: {output_dir}")
            for path in outputs:
                print(path)
            return 0
        local_fallback = args.local_fallback or should_default_to_local_fallback(args.input, args)
        if args.subtitle_source == "platform" or not local_fallback:
            raise SystemExit(
                "No platform subtitles found for the requested language(s). "
                "Rerun with --local-fallback to use the local Whisper model, "
                "or use --subtitle-source local to skip platform subtitles."
            )
        print("No platform subtitles found; falling back to local transcription.", file=sys.stderr)

    cleanups: list[Callable[[], None]] = []
    source, source_cleanup = resolve_source(args.input, args.stem, output_dir, args)
    cleanups.append(source_cleanup)
    if args.separate:
        source = separate_source(source, output_dir, args)
    base_name = safe_stem(source)
    audio_path, cleanup = prepare_audio(source, output_dir, base_name, args.save_audio)
    cleanups.append(cleanup)
    try:
        cues, metadata = transcribe(audio_path, args)
    finally:
        for cleanup_func in reversed(cleanups):
            cleanup_func()

    outputs = write_outputs(output_dir, base_name, cues, metadata, formats)
    if args.save_audio:
        outputs.append(audio_path)
    if args.save_video_preview and is_url(args.input):
        saved_video = maybe_download_url_video_preview(args.input, output_dir, args)
        if saved_video:
            outputs.append(saved_video)

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


def stem_score(path: Path, stem: str) -> int:
    name = path.stem.lower()
    score = 0
    vocal_markers = ["vocals", "vocal", "voice", "voices", "acapella", "a capella", "karaoke-vocal"]
    instrumental_markers = ["instrumental", "inst", "no_vocals", "no-vocals", "accompaniment", "karaoke"]

    if stem in {"auto", "vocals"}:
        if any(marker in name for marker in vocal_markers):
            score += 100
        if any(marker in name for marker in instrumental_markers):
            score -= 80
    elif stem == "instrumental":
        if any(marker in name for marker in instrumental_markers):
            score += 100
        if any(marker in name for marker in vocal_markers):
            score -= 80
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
        "-f",
        "bv*[height<=720][ext=mp4]/bv*[height<=720]/bestvideo[height<=720][ext=mp4]/bestvideo[height<=720]/best[height<=720][ext=mp4]/best[height<=720]",
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

    result = subprocess.run(cmd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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
        subprocess.run(cmd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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
    cmd = ["yt-dlp", "--skip-download", "--no-playlist", "--dump-single-json", url]
    if args.browser:
        cmd[1:1] = ["--cookies-from-browser", args.browser]
    if args.cookies:
        cmd[1:1] = ["--cookies", args.cookies]
    try:
        result = subprocess.run(cmd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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
    subprocess.run(cmd, check=True)
    after = [path for path in stems_dir.rglob("*") if path.is_file() and path.resolve() not in before]
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


def convert_audio(source: Path, target: Path) -> None:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
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
    subprocess.run(cmd, check=True)


def transcribe(audio_path: Path, args: argparse.Namespace) -> tuple[list[Cue], dict]:
    if args.word_engine in {"auto", "whisper_timestamped"} and not args.no_word_timestamps:
        try:
            return transcribe_with_whisper_timestamped(audio_path, args)
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

    return transcribe_with_faster_whisper(audio_path, args)


def transcribe_with_whisper_timestamped(audio_path: Path, args: argparse.Namespace) -> tuple[list[Cue], dict]:
    import whisper_timestamped as whisper

    device = "cpu" if args.device == "auto" else args.device
    model = whisper.load_model(args.model, device=device)
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


def transcribe_with_faster_whisper(audio_path: Path, args: argparse.Namespace) -> tuple[list[Cue], dict]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        setup_script = SKILL_DIR / "scripts/setup_faster_whisper.sh"
        raise SystemExit(
            "Missing Python package: faster-whisper\n"
            f"Install it with: {setup_script}\n"
            "Then rerun the same audio-subtitles command."
        ) from exc

    device = "cpu" if args.device == "auto" else args.device
    compute_type = "int8" if args.compute_type == "auto" and device == "cpu" else args.compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    model = WhisperModel(args.model, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        str(audio_path),
        language=args.language,
        task=args.task,
        beam_size=5,
        vad_filter=args.vad_filter,
        word_timestamps=not args.no_word_timestamps,
        condition_on_previous_text=False,
    )
    segment_list = list(segments)
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
