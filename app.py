"""Demo lokal untuk model deteksi kursi kosong dan terisi."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from threading import Lock

import pandas as pd
import streamlit as st

from inference import MODEL_PATH, csv_bytes, image_bytes, predict, read_image

st.set_page_config(page_title="Demo Deteksi Kursi", layout="wide")


@st.cache_resource(show_spinner=False)
def load_model(path: str, modified_ns: int):
    from ultralytics import YOLO

    model = YOLO(path, task="detect")
    if set(model.names.values()) != {"EmptyChair", "OccupiedChair"}:
        raise ValueError("Bobot harus memiliki kelas EmptyChair dan OccupiedChair.")
    return model, Lock()


def main() -> None:
    st.markdown(
        """<style>
        .stApp { font-family: 'Segoe UI', 'Helvetica Neue', sans-serif; }
        .stMainBlockContainer { max-width: 1200px; padding-top: 2.4rem; }
        h1 { letter-spacing: -0.035em; font-weight: 650 !important; }
        h2, h3 { letter-spacing: -0.02em; }
        .stButton button, .stDownloadButton button { border-radius: 6px; }
        div[data-testid="stMetricValue"] { font-variant-numeric: tabular-nums; }
        @media (max-width: 767px) {
            .stMainBlockContainer { padding-top: 1.5rem; }
        }
        </style>""",
        unsafe_allow_html=True,
    )
    st.title("Deteksi kursi kosong & terisi")
    st.write("Unggah foto ruangan, jalankan model, lalu periksa ketersediaan kursi yang terdeteksi.")

    model_exists = MODEL_PATH.is_file()
    modified_ns = MODEL_PATH.stat().st_mtime_ns if model_exists else 0
    with st.sidebar:
        st.header("Pengaturan deteksi")
        confidence = st.slider(
            "Confidence minimum", 0.05, 0.95, 0.25, 0.05,
            help="Nilai lebih tinggi menyaring prediksi yang kurang yakin, tetapi dapat melewatkan kursi.",
        )
        image_size = st.select_slider(
            "Resolusi inferensi", options=[320, 480, 640, 800, 960], value=640,
            help="Resolusi lebih besar dapat membantu objek kecil, tetapi memerlukan waktu lebih lama.",
        )
        device = st.selectbox(
            "Perangkat", ["CPU", "Otomatis"],
            help="Otomatis memakai GPU NVIDIA bila tersedia, atau CPU sebagai cadangan.",
        )
        show_confidence = st.checkbox("Tampilkan confidence pada gambar", value=True)
        st.divider()
        st.subheader("Model")
        if model_exists:
            st.caption("Bobot tersedia: weights.pt")
        else:
            st.error("weights.pt tidak ditemukan di folder aplikasi.")
        st.caption("EmptyChair = kursi kosong\n\nOccupiedChair = kursi terisi")
        st.caption("Pemrosesan dilakukan di komputer yang menjalankan aplikasi.")

    source_type = st.radio("Sumber gambar", ["Unggah gambar", "Kamera"], horizontal=True)
    if source_type == "Unggah gambar":
        source = st.file_uploader(
            "Pilih foto ruangan", type=["jpg", "jpeg", "png", "webp"],
            help="Maksimal 20 MB dan 24 megapiksel. Gunakan foto dengan kursi yang terlihat jelas.",
        )
    else:
        source = st.camera_input("Ambil foto ruangan")
        st.caption("Kamera mengambil satu foto. Izinkan akses kamera pada browser untuk menggunakannya.")

    if source is None:
        st.session_state.pop("last_analysis", None)
        st.info("Pilih gambar atau ambil foto untuk memulai deteksi.")
        st.caption("Hasil model adalah estimasi. Kursi yang tertutup atau terlalu kecil bisa tidak terdeteksi.")
        return

    data = source.getvalue()
    try:
        image = read_image(data)
    except ValueError as error:
        st.session_state.pop("last_analysis", None)
        st.error(str(error))
        return

    fingerprint = (hashlib.sha256(data).hexdigest(), confidence, image_size,
                   device, show_confidence, modified_ns)
    previous = st.session_state.get("last_analysis")
    if previous and previous["fingerprint"] != fingerprint:
        st.session_state.pop("last_analysis", None)

    input_column, output_column = st.columns([1, 1], gap="large")
    with input_column:
        st.subheader("Gambar masukan")
        st.image(image, width="stretch")
        st.caption(f"{image.width} x {image.height} piksel")
        run = st.button("Jalankan deteksi", type="primary", disabled=not model_exists,
                        width="stretch")

    if run:
        try:
            with st.status("Menyiapkan model dan menganalisis gambar...", expanded=False) as status:
                model, lock = load_model(str(MODEL_PATH), modified_ns)
                import torch

                selected_device = "0" if device == "Otomatis" and torch.cuda.is_available() else "cpu"
                output = predict(model, lock, image, confidence, image_size,
                                 selected_device, show_confidence)
                st.session_state.last_analysis = {"fingerprint": fingerprint, "output": output}
                status.update(label="Analisis selesai", state="complete")
        except Exception as error:
            logging.exception("Inferensi model kursi gagal")
            st.session_state.pop("last_analysis", None)
            st.error("Deteksi gagal. Periksa weights.pt dan instalasi dependensi, lalu coba lagi.")
            with st.expander("Detail kesalahan"):
                st.code(str(error), language="text")

    analysis = st.session_state.get("last_analysis")
    with output_column:
        st.subheader("Hasil deteksi")
        if analysis is None:
            st.info("Klik Jalankan deteksi untuk melihat hasil model.")
        else:
            output = analysis["output"]
            st.image(output["annotated"], width="stretch")
            st.caption("Hijau: kursi kosong. Cokelat: kursi terisi.")
            st.caption(f"Waktu proses: {output['elapsed_seconds']:.2f} detik | Perangkat: {output['device']}")

    if analysis is None:
        return

    output = analysis["output"]
    summary = output["summary"]
    st.divider()
    metric_columns = st.columns(4)
    for column, label, value in zip(
        metric_columns,
        ["Kursi terdeteksi", "Kursi kosong", "Kursi terisi", "Keterisian terdeteksi"],
        [summary["total"], summary["empty"], summary["occupied"],
         f"{summary['occupancy']:.0%}" if summary["occupancy"] is not None else "Belum ada"],
    ):
        column.metric(label, value)
    st.caption("Persentase dihitung dari kursi yang terdeteksi, bukan seluruh kapasitas ruangan.")
    if not output["rows"]:
        st.warning("Belum ada kursi terdeteksi. Coba turunkan confidence atau gunakan foto yang lebih jelas.")
    else:
        with st.expander("Detail setiap deteksi"):
            frame = pd.DataFrame(output["rows"])
            st.dataframe(
                frame, hide_index=True, width="stretch",
                column_config={
                    "id": "No.", "kelas": "Kelas model", "status": "Status",
                    "confidence": st.column_config.NumberColumn("Confidence", format="percent"),
                    "x1": "X kiri", "y1": "Y atas", "x2": "X kanan", "y2": "Y bawah",
                },
            )

    stem = Path(source.name).stem
    png_column, csv_column = st.columns(2)
    png_column.download_button(
        "Unduh gambar hasil", image_bytes(output["annotated"]),
        file_name=f"{stem}_deteksi.png", mime="image/png", width="stretch",
    )
    csv_column.download_button(
        "Unduh data CSV", csv_bytes(output["rows"]),
        file_name=f"{stem}_deteksi.csv", mime="text/csv", width="stretch",
    )


if __name__ == "__main__":
    main()
