#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MIN_SEPARATOR_BYTES = 50 * 1024 * 1024;
const MIN_WHISPER_BYTES = 400 * 1024 * 1024;
const MAX_SCAN_DEPTH = 6;

function findResourceRoots(root, depth = 0) {
  if (depth > MAX_SCAN_DEPTH || !existsSync(root)) {
    return [];
  }

  const basename = path.basename(root).toLowerCase();
  if (basename === "resources" && existsSync(path.join(root, "audio-subtitles"))) {
    return [root];
  }

  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => findResourceRoots(path.join(root, entry.name), depth + 1));
}

function firstExisting(root, relativePaths) {
  return relativePaths
    .map((relativePath) => path.join(root, relativePath))
    .find((candidate) => existsSync(candidate));
}

function requireFile(root, relativePath, minimumBytes = 1) {
  const target = path.join(root, relativePath);
  if (!existsSync(target)) {
    throw new Error(`Missing bundled file: ${target}`);
  }
  const bytes = statSync(target).size;
  if (bytes < minimumBytes) {
    throw new Error(
      `Bundled file is unexpectedly small: ${target} (${bytes} bytes, expected at least ${minimumBytes})`
    );
  }
  return { target, bytes };
}

function requireOneOf(root, relativePaths) {
  const target = firstExisting(root, relativePaths);
  if (!target) {
    throw new Error(
      `Missing bundled executable under ${root}; expected one of: ${relativePaths.join(", ")}`
    );
  }
  return target;
}

const scanRoot = path.resolve(process.argv[2] ?? "release");
const resourceRoots = findResourceRoots(scanRoot);

if (resourceRoots.length === 0) {
  throw new Error(`Could not find a packaged Resources directory under ${scanRoot}`);
}

for (const resources of resourceRoots) {
  const separator = requireFile(
    resources,
    path.join("separator-models", "UVR-MDX-NET-Inst_HQ_3.onnx"),
    MIN_SEPARATOR_BYTES
  );
  const whisper = requireFile(
    resources,
    path.join("whisper-models", "small", "model.bin"),
    MIN_WHISPER_BYTES
  );
  requireFile(resources, path.join("whisper-models", "small", "config.json"));
  requireFile(resources, path.join("audio-subtitles", "scripts", "generate_subtitles.py"));
  const python = requireOneOf(resources, [
    path.join("python-runtime", "python", "bin", "python3"),
    path.join("python-runtime", "python", "bin", "python"),
    path.join("python-runtime", "python", "python.exe")
  ]);
  const ffmpeg = requireOneOf(resources, [
    path.join("ffmpeg-static", "ffmpeg"),
    path.join("ffmpeg-static", "ffmpeg.exe"),
    path.join("bin", "ffmpeg")
  ]);

  console.log(`Verified offline bundle: ${resources}`);
  console.log(`  separator: ${separator.bytes} bytes`);
  console.log(`  whisper:   ${whisper.bytes} bytes`);
  console.log(`  python:    ${python}`);
  console.log(`  ffmpeg:    ${ffmpeg}`);
}
