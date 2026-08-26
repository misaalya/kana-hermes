# Kana advanced configuration

Kana keeps technical runtime controls out of the everyday interface. Optional
self-hosting overrides live in one server-owned file:

```text
$KANA_DATA_DIR/config.json
```

When `KANA_DATA_DIR` is not set, Kana follows the same XDG/HOME data-directory
resolution used by authentication and the activity store. The Settings screen
shows the resolved absolute path for the current installation.

All fields are optional. Paths must be absolute and ports must be between 1024
and 65535.

```json
{
  "hermes": {
    "executable": "/home/user/.local/bin/hermes",
    "port": 9119,
    "workingDirectory": "/home/user"
  },
  "tts": {
    "projectDirectory": "/opt/kana/services/qwen3-tts",
    "uvExecutable": "/home/user/.local/bin/uv",
    "port": 7860,
    "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "device": "cpu"
  }
}
```

Environment variables keep precedence over matching file values. Restart Kana
after editing the file so every server runtime reloads the configuration.
