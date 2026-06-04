"""Extraction using OpenRouter vision models via direct HTTP (hard timeout)."""

import base64
import io
import json
import os
from pathlib import Path

import requests as _req
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

_TIMEOUT = (8, 20)  # (connect, read) seconds

_FREE_MODELS = [
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "moonshotai/kimi-k2.6:free",
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
]

_PROMPT = (
    "Extract every field from this Romanian ID card (carte de identitate / buletin). "
    "Preserve diacritics exactly as printed (ș ț ă â î and their uppercase forms). "
    "The CNP is a 13-digit number near the bottom or MRZ zone. "
    "Respond with a JSON object containing exactly these fields: "
    "cnp, nume, prenume, serie_numar, data_nasterii, locul_nasterii, "
    "cetatenia, adresa, judet, emisa_de, valabila_pana_la. "
    "Use an empty string for any field that is not visible or illegible."
)


class RomanianIDData(BaseModel):
    cnp:               str = ""
    nume:              str = ""
    prenume:           str = ""
    serie_numar:       str = ""
    data_nasterii:     str = ""
    locul_nasterii:    str = ""
    cetatenia:         str = ""
    adresa:            str = ""
    judet:             str = ""
    emisa_de:          str = ""
    valabila_pana_la:  str = ""

    def to_placeholders(self) -> dict[str, str]:
        return {
            "{{CNP}}":              self.cnp,
            "{{NUME}}":             self.nume,
            "{{PRENUME}}":          self.prenume,
            "{{SERIE_NUMAR}}":      self.serie_numar,
            "{{DATA_NASTERII}}":    self.data_nasterii,
            "{{LOCUL_NASTERII}}":   self.locul_nasterii,
            "{{CETATENIA}}":        self.cetatenia,
            "{{ADRESA}}":           self.adresa,
            "{{JUDET}}":            self.judet,
            "{{EMISA_DE}}":         self.emisa_de,
            "{{VALABILA_PANA_LA}}": self.valabila_pana_la,
        }


def _resize_for_api(file_bytes: bytes) -> tuple[bytes, str]:
    """Resize image to max 1024px on longest side, return compressed JPEG bytes."""
    from PIL import Image
    img = Image.open(io.BytesIO(file_bytes))
    img = img.convert("RGB")
    max_px = 1024
    w, h = img.size
    if max(w, h) > max_px:
        scale = max_px / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue(), "image/jpeg"


def _call_model(file_bytes: bytes, media_type: str) -> RomanianIDData:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY nu este configurată. "
            "Adăugați cheia în fișierul .env (obțineți una gratuită la openrouter.ai)."
        )

    file_bytes, media_type = _resize_for_api(file_bytes)
    b64 = base64.b64encode(file_bytes).decode()
    print(f"[extractor] Image size after resize: {len(file_bytes)//1024}KB")
    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}},
                    {"type": "text", "text": _PROMPT},
                ],
            }
        ],
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://samwera-board.web.app",
    }

    last_err: Exception = RuntimeError("Niciun model disponibil")
    for model in _FREE_MODELS:
        try:
            print(f"[extractor] Trying {model}...")
            resp = _req.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json={**payload, "model": model},
                timeout=_TIMEOUT,
            )
            if resp.status_code != 200:
                last_err = RuntimeError(f"{model}: HTTP {resp.status_code} — {resp.text[:120]}")
                print(f"[extractor]  -> {last_err}")
                continue
            content = resp.json()["choices"][0]["message"]["content"]
            print(f"[extractor]  -> OK")
            return RomanianIDData.model_validate_json(content)
        except _req.exceptions.Timeout:
            last_err = RuntimeError(f"{model}: timeout după {_TIMEOUT[1]}s")
            print(f"[extractor]  -> timeout")
            continue
        except Exception as e:
            last_err = e
            print(f"[extractor]  -> ERR: {e}")
            continue

    raise last_err


def _pdf_to_image_bytes(file_bytes: bytes) -> tuple[bytes, str]:
    import fitz
    from PIL import Image
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    doc.close()
    return buf.getvalue(), "image/jpeg"


def extraction_mode() -> str:
    return "openrouter"


def extract_from_bytes(file_bytes: bytes, filename: str) -> RomanianIDData:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        file_bytes, media_type = _pdf_to_image_bytes(file_bytes)
    else:
        media_type = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png",  ".webp": "image/webp",
        }.get(ext, "image/jpeg")
    return _call_model(file_bytes, media_type)
