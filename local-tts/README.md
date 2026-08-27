# LUMÍR Local TTS V1

This directory contains the local text-to-speech adapter used by LUMÍR Audio
Console V2. It exposes Polish speech generation from the console UI while the
voice reference, model cache, and generated files remain on the local machine.

## Licence and permitted use

V1 uses Coqui **XTTS-v2** only under the Coqui Public Model License (CPML) for
**non-commercial use**. The user must explicitly accept those terms in the
local Voice panel before generation. Do not use this V1 integration for a
commercial product, service, or distribution without first replacing the model
with an engine whose licence permits that use.

## Privacy and local storage

- The service binds only to `127.0.0.1:8788`.
- A reference voice is sent only from the local browser UI to that loopback
  service; it is never sent to a remote API.
- `references/`, `outputs/`, `model-cache/`, `.runtime/`, and `.venv/` are
  deliberately ignored by Git.
- The original voice recording is never modified. Use
  `prepare-reference.py` to make a separate 24 kHz mono PCM WAV work copy.

## Replaceable engine contract

XTTS-v2 is an implementation behind a small local adapter, not a dependency
of the console shell. The browser only relies on these local endpoints:

- `GET /health` — reports the local engine, cache, and CUDA availability.
- `POST /api/tts` — accepts `text`, `voice`, `output_format`, and
  `accept_cpml_terms`, then returns WAV or MP3 bytes.

A future approved TTS engine should preserve this loopback contract (or adapt
it in `server.py`) so the console UI does not need to be rebuilt. It must also
keep reference audio and generated speech local unless the user explicitly
approves another design.

## Local start

Run `start-local-tts.ps1` from this directory. It starts the loopback backend
and a local console frontend. With an already cached model, setting
`HF_HUB_OFFLINE=1` is a valid verification that no new model download is
required.
