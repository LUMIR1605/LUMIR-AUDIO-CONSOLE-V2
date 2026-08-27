"""Create an XTTS-ready local reference WAV without modifying its source."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import av


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def convert(source: Path, destination: Path) -> dict[str, object]:
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if source == destination:
        raise ValueError("The destination must not overwrite the original voice recording.")

    before_hash = sha256(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    samples = 0

    with av.open(source) as input_container, av.open(destination, mode="w", format="wav") as output_container:
        source_stream = next((stream for stream in input_container.streams if stream.type == "audio"), None)
        if source_stream is None:
            raise ValueError("The source file contains no audio stream.")

        target_stream = output_container.add_stream("pcm_s16le", rate=24_000)
        target_stream.layout = "mono"
        resampler = av.AudioResampler(format="s16", layout="mono", rate=24_000)

        def write_frames(frames: list[av.AudioFrame]) -> None:
            nonlocal samples
            for frame in frames:
                samples += frame.samples
                for packet in target_stream.encode(frame):
                    output_container.mux(packet)

        for frame in input_container.decode(source_stream):
            write_frames(resampler.resample(frame))
        write_frames(resampler.resample(None))
        for packet in target_stream.encode(None):
            output_container.mux(packet)

    after_hash = sha256(source)
    if before_hash != after_hash:
        raise RuntimeError("The source hash changed during conversion; refusing to use the recording.")
    return {
        "source": str(source),
        "source_sha256": before_hash,
        "output": str(destination),
        "sample_rate": 24_000,
        "channels": 1,
        "codec": "PCM_S16LE",
        "duration_seconds": round(samples / 24_000, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(json.dumps(convert(args.source, args.destination), ensure_ascii=False))


if __name__ == "__main__":
    main()
