"""Run one explicit local XTTS synthesis through the loopback API."""

from __future__ import annotations

import argparse
import json
import mimetypes
import time
import uuid
from urllib.error import HTTPError
from pathlib import Path
from urllib.request import Request, urlopen

TEST_TEXT = (
    "To jest pierwszy test lokalnego systemu głosowego LUMÍR. "
    "Jeżeli słyszysz te słowa moim głosem, oznacza to, że klonowanie działa "
    "całkowicie lokalnie na moim komputerze."
)


def part(boundary: bytes, name: str, value: bytes, filename: str | None = None, content_type: str | None = None) -> bytes:
    headers = [b"--" + boundary]
    disposition = f'Content-Disposition: form-data; name="{name}"'
    if filename:
        disposition += f'; filename="{filename}"'
    headers.append(disposition.encode("utf-8"))
    if content_type:
        headers.append(f"Content-Type: {content_type}".encode("ascii"))
    return b"\r\n".join(headers) + b"\r\n\r\n" + value + b"\r\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--text", default=TEST_TEXT)
    parser.add_argument("--url", default="http://127.0.0.1:8788/api/tts")
    args = parser.parse_args()

    reference = args.reference.resolve(strict=True)
    boundary = f"lumir-{uuid.uuid4().hex}".encode("ascii")
    wav = reference.read_bytes()
    body = b"".join((
        part(boundary, "text", args.text.encode("utf-8")),
        part(boundary, "voice", wav, reference.name, mimetypes.guess_type(reference.name)[0] or "audio/wav"),
        part(boundary, "output_format", b"wav"),
        part(boundary, "accept_cpml_terms", b"true"),
        b"--" + boundary + b"--\r\n",
    ))
    request = Request(args.url, data=body, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={boundary.decode('ascii')}"})
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=1_200) as response:
            payload = response.read()
            headers = {key: value for key, value in response.headers.items() if key.lower().startswith("x-lumir-tts-")}
            filename = response.headers.get_filename()
    except HTTPError as error:
        print(json.dumps({
            "status": error.code,
            "total_request_ms": round((time.perf_counter() - started) * 1000),
            "detail": error.read().decode("utf-8", errors="replace"),
        }, ensure_ascii=False))
        return
    print(json.dumps({
        "status": 200,
        "total_request_ms": round((time.perf_counter() - started) * 1000),
        "response_bytes": len(payload),
        "filename": filename,
        "metrics": headers,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
