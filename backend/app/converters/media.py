"""Audio/video conversion with FFmpeg. Codec availability is probed at start-up (see capabilities)."""
from __future__ import annotations

import json
from pathlib import Path

from ..errors import ConversionError
from .common import output_dir, run_tool

_COMMON = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-protocol_whitelist", "file", "-threads", "2"]


def _probe(job, path: Path) -> dict:
    proc = run_tool(
        ["ffprobe", "-v", "error", "-protocol_whitelist", "file", "-show_entries",
         "format=duration:stream=codec_type,width,height", "-of", "json", str(path)],
        cwd=Path(job.workdir), timeout=30,
    )
    if proc.returncode != 0:
        raise ConversionError("The media file is corrupted or not a supported audio/video file.", "invalid_file")
    try:
        return json.loads(proc.stdout or b"{}")
    except ValueError as exc:
        raise ConversionError("The media file could not be analysed.", "invalid_file") from exc


def _check(job, info: dict, *, need_video: bool, max_seconds: int) -> None:
    streams = info.get("streams", [])
    kinds = {s.get("codec_type") for s in streams}
    if need_video and "video" not in kinds:
        raise ConversionError("This file has no video stream.", "no_video")
    if not need_video and "audio" not in kinds:
        raise ConversionError("This file has no audio stream.", "no_audio")
    try:
        duration = float(info.get("format", {}).get("duration") or 0)
    except ValueError:
        duration = 0
    if duration > max_seconds:
        raise ConversionError(f"Files longer than {max_seconds // 60} minutes are not supported on this server.", "too_long")
    for s in streams:
        if s.get("codec_type") == "video" and (s.get("width", 0) * s.get("height", 0)) > 4096 * 2304:
            raise ConversionError("The video resolution is too high for this server (limit 4096×2304).", "too_large")


def _run(job, args: list[str], out: Path) -> Path:
    proc = run_tool(args, cwd=Path(job.workdir), timeout=job.timeout)
    if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        raise ConversionError("FFmpeg could not convert this file. It may be corrupted or use an unsupported codec.", "invalid_file")
    return out


def _validate(job, out: Path, *, need_video: bool) -> None:
    info = _probe(job, out)
    kinds = {s.get("codec_type") for s in info.get("streams", [])}
    if ("video" if need_video else "audio") not in kinds:
        raise ConversionError("The converted file failed validation.", "invalid_output", 500)


def audio(job) -> Path:
    fmt = job.target["format"]
    src = Path(job.input_path)
    _check(job, _probe(job, src), need_video=False, max_seconds=job.limits["max_audio_seconds"])
    out = output_dir(job.workdir) / f"result.{fmt}"
    br = f"{job.options.get('audioBitrate', '192')}k"
    codec = {
        "mp3": ["-c:a", "libmp3lame", "-b:a", br],
        "wav": ["-c:a", "pcm_s16le"],
        "flac": ["-c:a", "flac"],
        "ogg": ["-c:a", "libvorbis", "-b:a", br],
        "m4a": ["-c:a", "aac", "-b:a", br, "-movflags", "+faststart"],
    }[fmt]
    _run(job, [*_COMMON, "-i", str(src), "-vn", "-map", "0:a:0", "-map_metadata", "-1", *codec, str(out)], out)
    _validate(job, out, need_video=False)
    return out


def video(job) -> Path:
    fmt = job.target["format"]
    src = Path(job.input_path)
    info = _probe(job, src)
    audio_only_target = fmt == "mp3"
    _check(job, info, need_video=not audio_only_target, max_seconds=job.limits["max_video_seconds"])
    out = output_dir(job.workdir) / f"result.{fmt}"
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    if fmt == "mp3":
        br = f"{job.options.get('audioBitrate', '192')}k"
        args = [*_COMMON, "-i", str(src), "-vn", "-map", "0:a:0", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", br, str(out)]
    elif fmt == "gif":
        width, fps = job.options.get("gifWidth", "480"), job.options.get("gifFps", "10")
        vf = f"fps={fps},scale='min({width},iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
        args = [*_COMMON, "-t", "15", "-i", str(src), "-map", "0:v:0", "-vf", vf, "-loop", "0", str(out)]
    else:
        maps = ["-map", "0:v:0"] + (["-map", "0:a:0"] if has_audio else [])
        if fmt == "mp4":
            enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                   "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]
        else:  # webm
            enc = ["-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-deadline", "realtime", "-cpu-used", "6",
                   "-row-mt", "1", "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "128k"]
        args = [*_COMMON, "-i", str(src), *maps, "-map_metadata", "-1", "-sn", *enc, str(out)]
    _run(job, args, out)
    _validate(job, out, need_video=not audio_only_target)
    return out
