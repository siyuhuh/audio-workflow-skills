#!/usr/bin/env python3
"""VocalFlow's private Mac processing agent.

The agent intentionally uses only the Python standard library. It accepts
authenticated jobs from the iPhone client, runs the existing audio-subtitles
pipeline one job at a time, persists state across restarts, and serves the
finished karaoke package back to the phone.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hmac
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import signal
import socket
import subprocess
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse


VERSION = "0.8.0-beta.5"
SERVICE_TYPE = "_vocalflow._tcp"
DEFAULT_PORT = 8766
MAX_REQUEST_BYTES = 64 * 1024
MAX_LOG_LINES = 240
ALLOWED_MODELS = {"small", "medium", "large-v3-turbo"}
ALLOWED_SUBTITLE_SOURCES = {"auto", "platform", "local"}
ALLOWED_BROWSERS = {"chrome", "safari"}
ALLOWED_FILE_SUFFIXES = {
    ".aac",
    ".aif",
    ".aiff",
    ".ass",
    ".caf",
    ".flac",
    ".json",
    ".lrc",
    ".m4a",
    ".m4v",
    ".mov",
    ".mp3",
    ".mp4",
    ".ogg",
    ".opus",
    ".srt",
    ".txt",
    ".vtt",
    ".wav",
    ".webm",
}
STAGE_RANGES = {
    "queued": (0.00, 0.00),
    "prepare": (0.00, 0.04),
    "download": (0.04, 0.24),
    "preview": (0.24, 0.34),
    "captions": (0.34, 0.44),
    "separate": (0.44, 0.62),
    "convert": (0.62, 0.67),
    "transcribe": (0.67, 0.91),
    "write": (0.91, 0.97),
    "manifest": (0.97, 0.99),
    "complete": (1.00, 1.00),
    "failed": (1.00, 1.00),
    "cancelled": (1.00, 1.00),
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_json_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def safe_title(value: str | None) -> str:
    compact = re.sub(r"\s+", " ", (value or "").strip())[:120]
    return compact or "Remote karaoke"


def normalize_source(value: Any) -> str:
    source = str(value or "").strip()
    if re.fullmatch(r"BV[0-9A-Za-z]{10}", source, flags=re.IGNORECASE):
        return f"https://www.bilibili.com/video/{source}"
    if re.fullmatch(r"av\d+", source, flags=re.IGNORECASE):
        return f"https://www.bilibili.com/video/{source}"
    if len(source) > 2048:
        raise ValueError("The source URL is too long.")
    parsed = urlparse(source)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Paste a YouTube/Bilibili/media URL or a Bilibili BV number.")
    return source


def normalize_options(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    model = str(raw.get("model", "small"))
    subtitle_source = str(raw.get("subtitleSource", "auto"))
    browser_value = raw.get("browser")
    browser = str(browser_value).strip().lower() if browser_value else None
    language_value = raw.get("language")
    language = str(language_value).strip().lower() if language_value else None

    if model not in ALLOWED_MODELS:
        raise ValueError("Unsupported transcription model.")
    if subtitle_source not in ALLOWED_SUBTITLE_SOURCES:
        raise ValueError("Unsupported subtitle source.")
    if browser and browser not in ALLOWED_BROWSERS:
        raise ValueError("Unsupported browser cookie source.")
    if language and not re.fullmatch(r"[a-z]{2,3}(?:-[a-z0-9]{2,8})?", language):
        raise ValueError("Language must be a code such as en, zh, or ja.")

    return {
        "separateVocals": bool(raw.get("separateVocals", True)),
        "saveVideoPreview": bool(raw.get("saveVideoPreview", True)),
        "localFallback": bool(raw.get("localFallback", True)),
        "simplifiedChinese": bool(raw.get("simplifiedChinese", False)),
        "model": model,
        "subtitleSource": subtitle_source,
        "browser": browser,
        "language": language,
    }


def overall_progress(stage: str, progress: float) -> float:
    start, end = STAGE_RANGES.get(stage, STAGE_RANGES["prepare"])
    if progress < 0:
        return start
    return min(1.0, max(0.0, start + (end - start) * min(1.0, progress)))


def load_or_create_config(home: Path) -> dict[str, Any]:
    config_path = home / "config.json"
    home.mkdir(parents=True, exist_ok=True)
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            if config.get("token") and config.get("pairingCode"):
                return config
        except (OSError, json.JSONDecodeError):
            pass

    hostname = socket.gethostname().split(".")[0]
    config = {
        "version": 1,
        "name": f"VocalFlow on {hostname}",
        "token": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("="),
        "pairingCode": f"{secrets.randbelow(1_000_000):06d}",
        "createdAt": utc_now(),
    }
    atomic_json_write(config_path, config)
    return config


class AgentState:
    def __init__(self, home: Path, output_root: Path, cli_path: str) -> None:
        self.home = home
        self.output_root = output_root
        self.jobs_root = home / "jobs"
        self.cli_path = cli_path
        self.separator_models = home.parent / "separator-models"
        self.lock = threading.RLock()
        self.jobs: dict[str, dict[str, Any]] = {}
        self.work_queue: queue.Queue[str | None] = queue.Queue()
        self.active_process: subprocess.Popen[str] | None = None
        self.active_job_id: str | None = None
        self.cancel_requested: set[str] = set()
        self.stop_event = threading.Event()
        self.pair_attempts: dict[str, list[float]] = {}
        self.config = load_or_create_config(self.home)
        self._load_jobs()
        self.worker = threading.Thread(target=self._worker_loop, name="vocalflow-worker", daemon=True)
        self.worker.start()

    def _load_jobs(self) -> None:
        self.jobs_root.mkdir(parents=True, exist_ok=True)
        for path in sorted(self.jobs_root.glob("*/job.json")):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            job_id = job.get("id")
            if not isinstance(job_id, str):
                continue
            if job.get("status") in {"queued", "running"}:
                job.update(
                    status="queued",
                    stage="queued",
                    progress=0.0,
                    overallProgress=0.0,
                    message="Restored after Mac restart.",
                )
                self._persist_job(job)
            self.jobs[job_id] = job

        for job in sorted(self.jobs.values(), key=lambda item: item.get("createdAt", "")):
            if job.get("status") == "queued":
                self.work_queue.put(job["id"])

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        source = normalize_source(payload.get("source"))
        options = normalize_options(payload.get("options"))
        job_id = uuid.uuid4().hex[:12]
        output_dir = self.output_root / f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{job_id}"
        job = {
            "id": job_id,
            "title": safe_title(payload.get("title")),
            "source": source,
            "options": options,
            "status": "queued",
            "stage": "queued",
            "progress": 0.0,
            "overallProgress": 0.0,
            "message": "Waiting for the Mac mini.",
            "etaSec": None,
            "createdAt": utc_now(),
            "updatedAt": utc_now(),
            "outputDirectory": str(output_dir),
            "files": [],
            "logs": [],
        }
        with self.lock:
            self.jobs[job_id] = job
            self._persist_job(job)
        self.work_queue.put(job_id)
        return self.public_job(job)

    def list_jobs(self) -> list[dict[str, Any]]:
        with self.lock:
            jobs = sorted(self.jobs.values(), key=lambda item: item["createdAt"], reverse=True)
            return [self.public_job(job) for job in jobs]

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
            return self.public_job(job) if job else None

    def cancel_job(self, job_id: str) -> dict[str, Any] | None:
        process: subprocess.Popen[str] | None = None
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            if job["status"] not in {"queued", "running"}:
                return self.public_job(job)
            self.cancel_requested.add(job_id)
            if job_id == self.active_job_id:
                process = self.active_process
            else:
                self._update_job(
                    job,
                    status="cancelled",
                    stage="cancelled",
                    progress=1.0,
                    overallProgress=1.0,
                    message="Cancelled.",
                    completedAt=utc_now(),
                )
        if process and process.poll() is None:
            self._terminate_process_tree(process)
        return self.get_job(job_id)

    def delete_job(self, job_id: str, delete_output: bool = False) -> bool:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job.get("status") in {"queued", "running"}:
                return False
            self.jobs.pop(job_id)
        shutil.rmtree(self.jobs_root / job_id, ignore_errors=True)
        if delete_output:
            shutil.rmtree(Path(job["outputDirectory"]), ignore_errors=True)
        return True

    def register_pairing_failure(self, client_address: str) -> bool:
        now = time.monotonic()
        with self.lock:
            attempts = [stamp for stamp in self.pair_attempts.get(client_address, []) if now - stamp < 60]
            if len(attempts) >= 8:
                return False
            attempts.append(now)
            self.pair_attempts[client_address] = attempts
            return True

    def token_matches(self, candidate: str) -> bool:
        return hmac.compare_digest(candidate, str(self.config["token"]))

    def pairing_code_matches(self, candidate: str) -> bool:
        return hmac.compare_digest(candidate.strip(), str(self.config["pairingCode"]))

    def public_job(self, job: dict[str, Any]) -> dict[str, Any]:
        result = {key: value for key, value in job.items() if key not in {"outputDirectory", "logs"}}
        if job.get("status") == "complete":
            result["files"] = self._public_files(job)
        return result

    def resolve_job_file(self, job_id: str, relative_path: str) -> Path | None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job.get("status") != "complete":
                return None
            output = Path(job["outputDirectory"]).resolve()
        candidate = (output / relative_path).resolve()
        try:
            candidate.relative_to(output)
        except ValueError:
            return None
        if not candidate.is_file() or candidate.suffix.lower() not in ALLOWED_FILE_SUFFIXES:
            return None
        return candidate

    def shutdown(self) -> None:
        self.stop_event.set()
        with self.lock:
            process = self.active_process
        if process and process.poll() is None:
            self._terminate_process_tree(process)
        self.work_queue.put(None)

    def _worker_loop(self) -> None:
        while not self.stop_event.is_set():
            job_id = self.work_queue.get()
            if job_id is None:
                return
            with self.lock:
                job = self.jobs.get(job_id)
                if not job or job.get("status") != "queued":
                    continue
            self._run_job(job_id)

    def _run_job(self, job_id: str) -> None:
        with self.lock:
            job = self.jobs[job_id]
            output_dir = Path(job["outputDirectory"])
            output_dir.mkdir(parents=True, exist_ok=True)
            self.active_job_id = job_id
            self._update_job(
                job,
                status="running",
                stage="prepare",
                progress=0.0,
                overallProgress=0.0,
                message="Starting on the Mac mini.",
                startedAt=utc_now(),
            )

        command = self._build_command(job)
        environment = os.environ.copy()
        extra_paths = [
            str(Path(self.cli_path).parent),
            str(Path.home() / ".local/share/audio-subtitles-venv/bin"),
            str(Path.home() / ".local/bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
        ]
        environment["PATH"] = ":".join(extra_paths + [environment.get("PATH", "")])

        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=environment,
                start_new_session=True,
            )
            with self.lock:
                self.active_process = process

            assert process.stdout is not None
            for raw_line in process.stdout:
                line = raw_line.rstrip("\r\n")
                if line:
                    self._handle_process_line(job_id, line)
            return_code = process.wait()

            with self.lock:
                cancelled = job_id in self.cancel_requested
            if cancelled:
                self._finish_cancelled(job_id)
            elif return_code == 0:
                self._finish_complete(job_id)
            else:
                self._finish_failed(job_id, f"audio-subtitles exited with status {return_code}.")
        except Exception as error:  # Keep the queue alive after any one failed job.
            self._finish_failed(job_id, str(error))
        finally:
            with self.lock:
                self.active_process = None
                self.active_job_id = None
                self.cancel_requested.discard(job_id)

    def _build_command(self, job: dict[str, Any]) -> list[str]:
        options = job["options"]
        command = [
            self.cli_path,
            "--output-dir",
            job["outputDirectory"],
            "--formats",
            "lrc,json,srt,ass",
            "--subtitle-source",
            "youtube" if options["subtitleSource"] == "platform" else options["subtitleSource"],
            "--model",
            options["model"],
            "--word-engine",
            "faster_whisper",
            "--save-audio",
        ]
        if options["saveVideoPreview"]:
            command.append("--save-video-preview")
        if options["localFallback"]:
            command.append("--local-fallback")
        if options["separateVocals"]:
            command.extend(
                [
                    "--separate",
                    "--separator-model",
                    "UVR-MDX-NET-Inst_HQ_3.onnx",
                    "--separator-model-dir",
                    str(self.separator_models),
                    "--separator-format",
                    "MP3",
                ]
            )
        if options["simplifiedChinese"]:
            command.append("--simplified-chinese")
        if options.get("language"):
            command.extend(["--language", options["language"]])
        if options.get("browser"):
            command.extend(["--browser", options["browser"]])
        command.append(job["source"])
        if Path("/usr/bin/caffeinate").is_file():
            command = ["/usr/bin/caffeinate", "-i", *command]
        return command

    @staticmethod
    def _terminate_process_tree(process: subprocess.Popen[str]) -> None:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except (OSError, ProcessLookupError):
            try:
                process.terminate()
            except OSError:
                pass

    def _handle_process_line(self, job_id: str, line: str) -> None:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            event = None

        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return
            if isinstance(event, dict) and event.get("event") == "stage":
                stage = str(event.get("name", "prepare"))
                progress = float(event.get("progress", -1))
                message = str(event.get("message") or stage.title())
                self._update_job(
                    job,
                    stage=stage,
                    progress=progress,
                    overallProgress=overall_progress(stage, progress),
                    message=message,
                    etaSec=event.get("etaSec"),
                )
            else:
                logs = job.setdefault("logs", [])
                logs.append(line[-2000:])
                del logs[:-MAX_LOG_LINES]
                inferred_progress = self._progress_from_log(job, line)
                if inferred_progress is not None:
                    job["progress"] = inferred_progress
                    job["overallProgress"] = overall_progress(job["stage"], inferred_progress)
                    job["updatedAt"] = utc_now()
                self._persist_job(job)

    @staticmethod
    def _progress_from_log(job: dict[str, Any], line: str) -> float | None:
        stage = job.get("stage")
        pattern = r"(?<!\d)(\d{1,3})%\|" if stage == "separate" else r"\[download\]\s+(\d+(?:\.\d+)?)%"
        if stage not in {"separate", "download", "preview"}:
            return None
        match = re.search(pattern, line)
        if not match:
            return None
        return min(1.0, max(0.0, float(match.group(1)) / 100.0))

    def _finish_complete(self, job_id: str) -> None:
        with self.lock:
            job = self.jobs[job_id]
            self._write_package_manifest(job)
            job["files"] = self._scan_files(job)
            if not any(item["role"] in {"audio", "backing", "vocal", "video"} for item in job["files"]):
                self._finish_failed(job_id, "The pipeline finished without playable media.")
                return
            self._update_job(
                job,
                status="complete",
                stage="complete",
                progress=1.0,
                overallProgress=1.0,
                message="Ready to download to iPhone.",
                etaSec=None,
                completedAt=utc_now(),
            )

    def _finish_failed(self, job_id: str, fallback: str) -> None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return
            logs = job.get("logs", [])
            detail = next((line for line in reversed(logs) if line.strip()), fallback)
            self._update_job(
                job,
                status="failed",
                stage="failed",
                progress=1.0,
                overallProgress=1.0,
                message=detail[-600:],
                completedAt=utc_now(),
            )

    def _finish_cancelled(self, job_id: str) -> None:
        with self.lock:
            job = self.jobs[job_id]
            self._update_job(
                job,
                status="cancelled",
                stage="cancelled",
                progress=1.0,
                overallProgress=1.0,
                message="Cancelled.",
                completedAt=utc_now(),
            )

    def _write_package_manifest(self, job: dict[str, Any]) -> None:
        manifest = {
            "title": job["title"],
            "createdAt": job["createdAt"],
            "source": job["source"],
            "remoteJobID": job["id"],
            "options": job["options"],
        }
        atomic_json_write(Path(job["outputDirectory"]) / "vocalflow-package.json", manifest)

    def _scan_files(self, job: dict[str, Any]) -> list[dict[str, Any]]:
        output = Path(job["outputDirectory"])
        files: list[dict[str, Any]] = []
        for path in sorted(output.rglob("*")):
            if not path.is_file() or path.name.startswith(".") or path.suffix.lower() not in ALLOWED_FILE_SUFFIXES:
                continue
            relative = path.relative_to(output).as_posix()
            files.append(
                {
                    "path": relative,
                    "name": path.name,
                    "size": path.stat().st_size,
                    "contentType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                    "role": self._file_role(path),
                }
            )
        return files

    def _public_files(self, job: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            {
                **file,
                "url": f"/v1/jobs/{job['id']}/files/{quote(file['path'], safe='/')}",
            }
            for file in job.get("files", [])
        ]

    @staticmethod
    def _file_role(path: Path) -> str:
        name = path.stem.lower()
        suffix = path.suffix.lower()
        if suffix in {".mp4", ".mov", ".m4v", ".webm"}:
            return "video"
        if suffix in {".lrc", ".srt", ".ass", ".vtt"}:
            return "lyrics"
        if suffix == ".json":
            return "manifest" if path.name == "vocalflow-package.json" else "lyrics"
        if "instrumental" in name or "no_vocals" in name or "no-vocals" in name or "backing" in name:
            return "backing"
        if "vocals" in name or "vocal" in name or "acapella" in name:
            return "vocal"
        if suffix in {".mp3", ".m4a", ".wav", ".aac", ".aiff", ".flac", ".ogg", ".opus"}:
            return "audio"
        return "other"

    def _update_job(self, job: dict[str, Any], **changes: Any) -> None:
        job.update(changes)
        job["updatedAt"] = utc_now()
        self._persist_job(job)

    def _persist_job(self, job: dict[str, Any]) -> None:
        atomic_json_write(self.jobs_root / job["id"] / "job.json", job)


class VocalFlowHandler(BaseHTTPRequestHandler):
    server_version = f"VocalFlowAgent/{VERSION}"

    @property
    def state(self) -> AgentState:
        return self.server.state  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "name": self.state.config["name"],
                    "version": VERSION,
                    "pairingRequired": True,
                },
            )
            return
        if not self.require_authentication():
            return
        if path == "/v1/capabilities":
            self.send_json(
                HTTPStatus.OK,
                {
                    "version": VERSION,
                    "service": self.state.config["name"],
                    "sources": ["youtube", "bilibili", "http-media"],
                    "models": sorted(ALLOWED_MODELS),
                    "features": ["video-preview", "lyrics", "word-timing", "vocal-separation"],
                    "maxConcurrentJobs": 1,
                },
            )
            return
        if path == "/v1/jobs":
            self.send_json(HTTPStatus.OK, {"jobs": self.state.list_jobs()})
            return

        job_match = re.fullmatch(r"/v1/jobs/([a-f0-9]{12})", path)
        if job_match:
            job = self.state.get_job(job_match.group(1))
            if job:
                self.send_json(HTTPStatus.OK, job)
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "Job not found.")
            return

        file_match = re.fullmatch(r"/v1/jobs/([a-f0-9]{12})/files/(.+)", path)
        if file_match:
            file_path = self.state.resolve_job_file(file_match.group(1), unquote(file_match.group(2)))
            if file_path:
                self.send_file(file_path)
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "File not found.")
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found.")

    def do_HEAD(self) -> None:
        path = urlparse(self.path).path
        if not self.require_authentication():
            return
        file_match = re.fullmatch(r"/v1/jobs/([a-f0-9]{12})/files/(.+)", path)
        if not file_match:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found.")
            return
        file_path = self.state.resolve_job_file(file_match.group(1), unquote(file_match.group(2)))
        if not file_path:
            self.send_error_json(HTTPStatus.NOT_FOUND, "File not found.")
            return
        self.send_file(file_path, include_body=False)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/v1/pair":
            payload = self.read_json()
            if payload is None:
                return
            if not self.state.pairing_code_matches(str(payload.get("code", ""))):
                if not self.state.register_pairing_failure(self.client_address[0]):
                    self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, "Try pairing again in one minute.")
                    return
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "Pairing code is incorrect.")
                return
            self.send_json(
                HTTPStatus.OK,
                {
                    "token": self.state.config["token"],
                    "name": self.state.config["name"],
                    "version": VERSION,
                },
            )
            return

        if not self.require_authentication():
            return
        if path == "/v1/jobs":
            payload = self.read_json()
            if payload is None:
                return
            try:
                job = self.state.create_job(payload)
            except ValueError as error:
                self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
                return
            self.send_json(HTTPStatus.ACCEPTED, job)
            return

        cancel_match = re.fullmatch(r"/v1/jobs/([a-f0-9]{12})/cancel", path)
        if cancel_match:
            job = self.state.cancel_job(cancel_match.group(1))
            if job:
                self.send_json(HTTPStatus.OK, job)
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "Job not found.")
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found.")

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if not self.require_authentication():
            return
        job_match = re.fullmatch(r"/v1/jobs/([a-f0-9]{12})", parsed.path)
        if not job_match:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found.")
            return
        delete_output = parsed.query == "deleteOutput=true"
        if self.state.delete_job(job_match.group(1), delete_output=delete_output):
            self.send_json(HTTPStatus.OK, {"deleted": True})
        else:
            self.send_error_json(HTTPStatus.CONFLICT, "Only finished jobs can be deleted.")

    def require_authentication(self) -> bool:
        authorization = self.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and self.state.token_matches(token):
            return True
        self.send_error_json(HTTPStatus.UNAUTHORIZED, "Pair this iPhone with the Mac mini first.")
        return False

    def read_json(self) -> dict[str, Any] | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid request body.")
            return None
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Request body must be JSON.")
            return None
        if not isinstance(value, dict):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Request body must be a JSON object.")
            return None
        return value

    def send_json(self, status: HTTPStatus, value: Any) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json(status, {"error": message})

    def send_file(self, path: Path, include_body: bool = True) -> None:
        total_size = path.stat().st_size
        start = 0
        end = total_size - 1
        status = HTTPStatus.OK
        range_header = self.headers.get("Range")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{total_size}")
                self.end_headers()
                return
            start_text, end_text = match.groups()
            if start_text:
                start = int(start_text)
                end = min(int(end_text), total_size - 1) if end_text else total_size - 1
            elif end_text:
                suffix_length = min(int(end_text), total_size)
                start = total_size - suffix_length
            if start < 0 or start > end or start >= total_size:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{total_size}")
                self.end_headers()
                return
            status = HTTPStatus.PARTIAL_CONTENT

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(path.name)}")
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{total_size}")
        self.end_headers()
        if not include_body or self.command == "HEAD":
            return

        remaining = length
        with path.open("rb") as handle:
            handle.seek(start)
            while remaining > 0:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def log_message(self, format_string: str, *args: Any) -> None:
        message = format_string % args
        print(f"{self.address_string()} {message}", flush=True)


class VocalFlowHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], state: AgentState) -> None:
        self.state = state
        super().__init__(address, VocalFlowHandler)


def start_bonjour(name: str, port: int) -> subprocess.Popen[str] | None:
    executable = shutil.which("dns-sd")
    if not executable:
        return None
    try:
        return subprocess.Popen(
            [executable, "-R", name, SERVICE_TYPE, "local", str(port), "version=1", "path=/"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except OSError:
        return None


def default_paths() -> tuple[Path, Path]:
    home = Path(os.environ.get(
        "VOCALFLOW_AGENT_HOME",
        Path.home() / "Library/Application Support/VocalFlow/Agent",
    )).expanduser()
    output = Path(os.environ.get(
        "VOCALFLOW_AGENT_OUTPUT",
        Path.home() / "Movies/VocalFlow/Remote",
    )).expanduser()
    return home, output


def find_cli() -> str:
    configured = os.environ.get("VOCALFLOW_AUDIO_SUBTITLES")
    repository_script = Path(__file__).resolve().parents[3] / "skills/audio-subtitles/scripts/generate_subtitles.py"
    candidates = [
        configured,
        str(repository_script),
        shutil.which("audio-subtitles"),
        str(Path.home() / ".local/bin/audio-subtitles"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise SystemExit("audio-subtitles is not installed. Run the audio-subtitles setup first.")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the VocalFlow private Mac processing agent.")
    parser.add_argument("--bind", default=os.environ.get("VOCALFLOW_AGENT_BIND", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOCALFLOW_AGENT_PORT", DEFAULT_PORT)))
    parser.add_argument("--no-bonjour", action="store_true")
    parser.add_argument("--print-pairing", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()
    home, output_root = default_paths()
    if args.print_pairing:
        config = load_or_create_config(home)
        print(json.dumps(
            {
                "name": config["name"],
                "pairingCode": config["pairingCode"],
                "port": args.port,
            },
            ensure_ascii=False,
            indent=2,
        ))
        return 0

    state = AgentState(home, output_root, find_cli())
    server = VocalFlowHTTPServer((args.bind, args.port), state)
    bonjour = None if args.no_bonjour else start_bonjour(state.config["name"], args.port)

    def stop(_signal: int, _frame: Any) -> None:
        state.shutdown()
        if bonjour and bonjour.poll() is None:
            bonjour.terminate()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    print(f"VocalFlow Agent {VERSION} listening on {args.bind}:{args.port}", flush=True)
    print(f"Pairing code: {state.config['pairingCode']}", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        state.shutdown()
        if bonjour and bonjour.poll() is None:
            bonjour.terminate()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
