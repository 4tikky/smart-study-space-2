"""Generate short real-image media fixtures; no synthetic detection outputs."""
import subprocess
from pathlib import Path
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
target = ROOT / 'frontend/tests/fixtures'
target.mkdir(exist_ok=True)
source = ROOT / 'frontend/public/library-study-room.webp'
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
for width, height in [(1280, 720), (1920, 1080), (2560, 1440), (3840, 2160), (2160, 3840), (3000, 1000), (641, 431)]:
    subprocess.run([ffmpeg, '-loglevel', 'error', '-y', '-loop', '1', '-i', str(source), '-vf',
                    f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2',
                    '-t', '1', '-r', '2', '-pix_fmt', 'yuv444p' if width % 2 else 'yuv420p',
                    '-c:v', 'libx264', '-threads', '1', '-movflags', '+faststart', str(target / f'{width}x{height}.mp4')], check=True)
subprocess.run([ffmpeg, '-loglevel', 'error', '-y', '-loop', '1', '-i', str(source), '-vf', 'scale=640:430',
                '-t', '2', '-r', '5', '-pix_fmt', 'yuv420p', '-f', 'yuv4mpegpipe', str(target / 'camera.y4m')], check=True)
subprocess.run([ffmpeg, '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=size=16x16:rate=1',
                '-t', '601', '-c:v', 'libx264', str(target / 'long.mp4')], check=True)
print('Browser media fixtures generated.')
