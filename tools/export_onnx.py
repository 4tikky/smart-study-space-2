r"""Export the original checkpoint and fail closed unless ONNX matches PyTorch.

Run from the repository root: .venv\Scripts\python tools/export_onnx.py
This is a development tool; Python is never needed by the hosted application.
"""
import argparse
import hashlib
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import config  # Set local Ultralytics cache paths before importing YOLO.
import cv2
import numpy as np
import onnx
import onnxruntime as ort
from PIL import Image
from ultralytics import YOLO
from ultralytics.data.augment import LetterBox


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def decode(output, width, height, side, confidence):
    # This contract is asserted against the ACTUAL exported tensor below.
    if output.ndim != 3 or output.shape[0] != 1 or output.shape[2] != 6:
        raise AssertionError(f'Unsupported YOLO26 output: {output.shape}; inspect export before proceeding')
    gain = min(side / width, side / height)
    left = round(((side - round(width * gain)) % 32) / 2 - 0.1)
    top = round(((side - round(height * gain)) % 32) / 2 - 0.1)
    rows = output[0][output[0, :, 4] > confidence].copy()
    rows[:, [0, 2]] = np.clip((rows[:, [0, 2]] - left) / gain, 0, width)
    rows[:, [1, 3]] = np.clip((rows[:, [1, 3]] - top) / gain, 0, height)
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-export', action='store_true')
    args = parser.parse_args()
    checkpoint = ROOT / 'weights.pt'
    digest = sha256(checkpoint)
    target = ROOT / 'frontend/public/models'
    target.mkdir(parents=True, exist_ok=True)
    exported = target / 'yolo26s.onnx'
    model = YOLO(str(checkpoint), task='detect')
    if set(model.names.values()) != {'EmptyChair', 'OccupiedChair'}:
        raise AssertionError(f'Unexpected checkpoint classes: {model.names}')
    if not args.skip_export:
        # Keep export intermediates away from the preserved checkpoint.
        with tempfile.TemporaryDirectory(dir=ROOT) as work:
            copy = Path(work) / 'weights.pt'
            shutil.copyfile(checkpoint, copy)
            path = YOLO(str(copy), task='detect').export(
                format='onnx', dynamic=True, imgsz=640, batch=1, opset=17,
                simplify=False, half=False, nms=False, device='cpu',
            )
            shutil.copyfile(path, exported)
    graph = onnx.load(str(exported))
    onnx.checker.check_model(graph)
    session = ort.InferenceSession(str(exported), providers=['CPUExecutionProvider'])
    source = Image.open(ROOT / 'frontend/public/library-study-room.webp').convert('RGB')
    fixtures = [('landscape', source), ('portrait', source.transpose(Image.Transpose.ROTATE_90)),
                ('wide', source.resize((1920, 640)))]
    comparisons = []
    max_box_error = max_score_error = 0.0
    for name, image in fixtures:
        for resolution in (320, 480, 640, 800, 960):
            side = math.ceil(resolution / 32) * 32
            bgr = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
            padded = LetterBox((side, side), auto=True, stride=32)(image=bgr)
            tensor = np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255
            raw = session.run(None, {session.get_inputs()[0].name: tensor})[0]
            for confidence in (0.25, 0.5):
                expected = model.predict(image, imgsz=side, conf=confidence, rect=True, device='cpu', verbose=False)[0].boxes.data.cpu().numpy()
                actual = decode(raw, image.width, image.height, side, confidence)
                if len(expected) != len(actual):
                    raise AssertionError(f'{name}/{side}/{confidence}: count {len(expected)} != {len(actual)}')
                # Match by class and closest coordinates; top-k tie order can differ.
                remaining = list(actual)
                for row in expected:
                    matches = [(float(np.max(np.abs(row[:4] - candidate[:4]))), i)
                               for i, candidate in enumerate(remaining) if row[5] == candidate[5]]
                    if not matches:
                        raise AssertionError('Class mismatch')
                    error, index = min(matches)
                    other = remaining.pop(index)
                    score_error = float(abs(row[4] - other[4]))
                    max_box_error = max(max_box_error, error)
                    max_score_error = max(max_score_error, score_error)
                    if error > 0.25 or score_error > 0.001:
                        raise AssertionError(f'Parity failure: box error={error}, confidence error={score_error}')
                comparisons.append({'fixture': name, 'resolution': resolution, 'input_side': side,
                                    'confidence': confidence, 'detections': len(actual),
                                    'pytorch_rows': expected.tolist()})
    if sha256(checkpoint) != digest:
        raise AssertionError('Original checkpoint changed')
    manifest = {'architecture': 'YOLO26s', 'file': 'yolo26s.onnx', 'source_sha256': digest,
                'sha256': sha256(exported), 'bytes': exported.stat().st_size,
                'opset': 17, 'input': {'name': session.get_inputs()[0].name, 'layout': 'NCHW', 'dtype': 'float32',
                                    'normalization': 'RGB / 255', 'padding': 114, 'stride': 32, 'rectangular_letterbox': True},
                'output': {'name': session.get_outputs()[0].name, 'shape_observed': list(raw.shape),
                           'columns': ['x1', 'y1', 'x2', 'y2', 'confidence', 'class_id'],
                           'end_to_end': True, 'nms_required': False},
                'classes': model.names, 'validated': True}
    report = {'passed': True, 'comparisons': comparisons, 'max_box_error_px': max_box_error,
              'max_confidence_error': max_score_error, 'providers': session.get_providers(),
              'checkpoint_sha256': digest, 'onnx_sha256': manifest['sha256'],
              'pytorch_version': __import__('torch').__version__, 'onnxruntime_version': ort.__version__}
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'tools/onnx-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': True, 'comparisons': len(comparisons), 'max_box_error_px': max_box_error,
                      'max_confidence_error': max_score_error, 'output': manifest['output'], 'bytes': manifest['bytes']}, indent=2))


if __name__ == '__main__':
    main()
