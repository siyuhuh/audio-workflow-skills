# VocalFlow Agent

VocalFlow Agent turns a private Mac mini into the processing backend for the iPhone client. It runs one job at a time, stores results under `~/Movies/VocalFlow/Remote`, advertises `_vocalflow._tcp` over Bonjour, and exposes a token-authenticated API on port `8766`.

## Recommended install

Install VocalFlow for Mac from the DMG, open **Remote**, and click **Install Agent**. The native app includes this Agent, the processing script, Python runtime, and default models.

## Source-checkout install

```bash
chmod +x setup-runtime.sh install-agent.sh enable-tailscale.sh vocalflow_agent.py
./setup-runtime.sh
./install-agent.sh
./enable-tailscale.sh
```

`install-agent.sh` resolves the bundled runtime when invoked from the app and falls back to `~/.local/share/audio-subtitles-venv` for a source checkout.

Useful checks:

```bash
curl http://127.0.0.1:8766/health
launchctl print gui/$(id -u)/com.gottaegbert.vocalflow.agent
tailscale serve status
tail -f ~/Library/Logs/VocalFlow/agent.log
```

Tailscale Serve should remain private to the signed-in tailnet. Do not enable public Funnel for this Agent.
