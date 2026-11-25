"""Metadata and safety checks without loading the detection model."""

import math
import unittest
from unittest.mock import MagicMock, patch

import cv2

from backend.services.video import inspect_video, processing_size, video_metadata


class VideoValidationTests(unittest.TestCase):
    def test_processing_sizes_and_aspect_ratio(self):
        cases = [
            ((1280, 720), (1280, 720)), ((1920, 1080), (1920, 1080)),
            ((2560, 1440), (1920, 1080)), ((3840, 2160), (1920, 1080)),
            ((2160, 3840), (1080, 1920)), ((4096, 2160), (1920, 1012)),
            ((3000, 1000), (1920, 640)), ((1000, 3000), (640, 1920)),
            ((3000, 3000), (1080, 1080)), ((641, 431), (641, 431)),
            ((8192, 1), (1920, 1)),
        ]
        for (width, height), expected in cases:
            with self.subTest(size=(width, height)):
                actual = processing_size(width, height)
                self.assertEqual(actual, expected)
                scale = min(actual[0] / width, actual[1] / height)
                self.assertLessEqual(abs(actual[0] - width * scale), 1)
                self.assertLessEqual(abs(actual[1] - height * scale), 1)
                self.assertLessEqual(actual[0], width)
                self.assertLessEqual(actual[1], height)

    def capture(self, width=3840, height=2160, fps=30, count=300):
        capture = MagicMock()
        capture.isOpened.return_value = True
        capture.get.side_effect = {
            cv2.CAP_PROP_FRAME_WIDTH: width, cv2.CAP_PROP_FRAME_HEIGHT: height,
            cv2.CAP_PROP_FPS: fps, cv2.CAP_PROP_FRAME_COUNT: count,
        }.__getitem__
        return capture

    def test_accepts_4k_and_ten_minute_boundary(self):
        capture = self.capture(count=18000)
        with patch('backend.services.video.cv2.VideoCapture', return_value=capture):
            source, fps, count, width, height = inspect_video('input.mp4')
        self.assertIs(source, capture)
        metadata = video_metadata(fps, count, width, height)
        self.assertEqual(metadata['duration_seconds'], 600)
        self.assertEqual(metadata['orientation'], 'landscape')
        self.assertTrue(metadata['resized'])
        capture.release.assert_not_called()
        capture.release()

    def test_rejects_unsafe_or_invalid_metadata_and_releases_capture(self):
        for values in [dict(width=8193, height=10), dict(width=5000, height=5000),
                       dict(count=18001), dict(fps=241), dict(fps=0),
                       dict(width=math.nan), dict(count=math.inf), dict(height=0)]:
            with self.subTest(values=values):
                capture = self.capture(**values)
                with patch('backend.services.video.cv2.VideoCapture', return_value=capture):
                    with self.assertRaises(ValueError):
                        inspect_video('input.mp4')
                capture.release.assert_called_once()

    def test_unsupported_codec_releases_capture(self):
        capture = self.capture()
        capture.isOpened.return_value = False
        with patch('backend.services.video.cv2.VideoCapture', return_value=capture):
            with self.assertRaisesRegex(ValueError, 'codec'):
                inspect_video('unsupported.mov')
        capture.release.assert_called_once()
