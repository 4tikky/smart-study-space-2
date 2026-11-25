from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, StringConstraints, model_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Metric = Annotated[float, Field(ge=0, le=1)]


class InferenceOptions(BaseModel):
    confidence: float = Field(default=0.25, ge=0.05, le=0.95)
    resolution: Literal[320, 480, 640, 800, 960] = 640
    device: Literal["cpu", "auto"] = "cpu"


class LiveOptions(InferenceOptions):
    camera_id: int | None = Field(default=None, gt=0)
    interval_ms: int = Field(default=750, ge=250, le=10000)


class FloorInput(BaseModel):
    name: Name
    description: str = Field(default="", max_length=240)
    enabled: bool = True


class ZoneInput(BaseModel):
    name: Name
    floor_id: int = Field(gt=0)
    description: str = Field(default="", max_length=240)
    outlets: int | None = Field(default=None, ge=0, le=1000)
    layout_row: int | None = Field(default=None, ge=1, le=12)
    layout_col: int | None = Field(default=None, ge=1, le=6)

    @model_validator(mode="after")
    def require_position_pair(self):
        if (self.layout_row is None) != (self.layout_col is None):
            raise ValueError("Isi baris dan kolom tata letak bersama-sama.")
        return self


class CameraInput(BaseModel):
    name: Name
    kind: Literal["browser", "stream"]
    floor_id: int = Field(gt=0)
    zone_id: int | None = Field(default=None, gt=0)
    stream_url: str = Field(default="", max_length=2048, repr=False)
    interval_ms: int = Field(default=750, ge=250, le=10000)
    enabled: bool = True

    @model_validator(mode="after")
    def validate_stream(self):
        if self.kind == "browser":
            self.stream_url = ""
        elif self.stream_url:
            url = urlsplit(self.stream_url)
            if url.scheme not in {"rtsp", "rtsps", "http", "https"} or not url.hostname:
                raise ValueError("Masukkan URL RTSP atau HTTP(S) yang valid.")
        return self


class SettingsInput(BaseModel):
    limited_at: int = Field(default=65, ge=1, le=99)
    full_at: int = Field(default=90, ge=1, le=100)
    retention_days: int = Field(default=90, ge=1, le=3650)

    @model_validator(mode="after")
    def validate_thresholds(self):
        if self.limited_at >= self.full_at:
            raise ValueError("Ambang terbatas harus lebih kecil dari ambang hampir penuh.")
        return self


class TrainingMetadata(BaseModel):
    dataset_size: int | None = Field(default=None, ge=0)
    train_size: int | None = Field(default=None, ge=0)
    validation_size: int | None = Field(default=None, ge=0)
    test_size: int | None = Field(default=None, ge=0)
    epochs: int | None = Field(default=None, ge=1)
    precision: Metric | None = None
    recall: Metric | None = None
    f1: Metric | None = None
    map50: Metric | None = None
    map5095: Metric | None = None
    reference: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def require_evidence(self):
        if any(value is not None for key, value in self if key != "reference") and not self.reference.strip():
            raise ValueError("Cantumkan referensi hasil pelatihan atau evaluasi.")
        return self
