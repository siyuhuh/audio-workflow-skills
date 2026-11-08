# Browser separator feasibility probe

Independent experiment; does not modify or replace the desktop app. No extension permissions, tab recording, remote deployment or cloud inference.

## Run

```sh
npm --prefix experiments/browser-separator ci
PYTHONNOUSERSITE=1 apps/desktop/vendor/python-runtime/python/bin/python3 -sB experiments/browser-separator/prepare.py /absolute/path/to/stereo-44100Hz-speech.wav
npm --prefix experiments/browser-separator run dev
```

Open the printed loopback URL in Chrome. Choose a local audio file and click the last button. Only the first 30 seconds are processed, although decoding currently reads the whole file; use short files to avoid excessive memory use. Without a file, the page expects `public/fixture.wav` (the local test used a 30-second repetition of synthesized speech). WAV outputs are available for playback/download. Input audio never leaves the browser. The local server serves only static model/runtime/test assets.

`prepare.py` is developer-only reference generation. End-user inference, STFT and inverse STFT execute in JavaScript/WebGPU, with no Python process. Public model/test assets and dependencies are ignored by Git. No model redistribution-license clearance is implied.

## Measurements — 2026-10-07

Host: Apple M4 Pro, 48 GB RAM, macOS, headed Chrome 154; ONNX Runtime Web 1.24.3. These are not minimum-hardware guarantees or internet download benchmarks.

- Existing `UVR-MDX-NET-Inst_HQ_3.onnx`: 66,759,214 bytes; primary output is instrumental.
- WebGPU session initialization from localhost: 0.73 s in initial probe.
- Real speech spectrum, six repeated inferences: 0.761 / 0.448 / 0.456 / 0.463 / 0.453 / 0.445 s.
- Relative output RMSE against native ONNX CPU: 0.0000100 (approximately 0.001%). All values finite.
- JavaScript STFT relative RMSE against PyTorch: 1.568e-7.
- Complete 30-second repeated-speech pipeline: 4.85 s processing, 5.06 s including model initialization and decoding; two finite PCM WAV outputs created.

## Limitations / 下一步

This validates model compatibility and a basic browser audio pipeline, not song separation quality. Chunk trimming is a simplified prototype, not parity with the desktop overlap/denoise pipeline. There is no persistent model cache, progress download, cancellation, worker isolation, memory benchmark, multi-device test, extension CSP test, recording or transcription yet. WASM CPU has a probe button but was not benchmarked. Production must bundle runtime code, validate/cache model assets, move heavy processing off the UI thread, and assess model licensing and extension-store requirements.

下一步应先用有权使用的真实音乐试听并比较桌面版，再测低配置机器；不要把本机 5 秒结果当成所有用户的性能承诺。
