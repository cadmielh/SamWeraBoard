"""Documentele clienților: tipul fișierului, numele afișat și stocarea criptată (fără Flask).

- Tipul se stabilește după conținut (semnătura de la începutul fișierului), nu după extensie sau după ce declară
  browserul. Ce nu e pe lista de mai jos se refuză (`tip_nepermis`); documentele Office cu macro-uri la fel.
- Conținutul se criptează cu cheia cabinetului (`vault.encrypt_file`) înainte de a ajunge în stocare, deci bucket-ul
  conține doar date ilizibile fără cheie.
- Stocarea: Cloud Storage (`FISIERE_BUCKET`) în producție; un director local (`FISIERE_LOCAL_DIR`) DOAR pentru
  dezvoltare și teste, refuzat în Cloud Functions/Run. Dacă nu e configurată niciuna, operațiunile refuză (503).

Plan și decizii: docs/plan-documente-client.md.
"""
from __future__ import annotations

import io
import os
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path

import vault

MAX_BYTES = 15 * 1024 * 1024                 # per fișier
LIMITA_CABINET = 10 * 1024 * 1024 * 1024     # limită de utilizare per cabinet, inclusă în abonament
MAX_NUME = 150                               # caractere, fără extensie
MAX_NUME_FOLDER = 80
MAX_ADANCIME = 6                             # niveluri de foldere imbricate
MAX_FOLDERE_CLIENT = 200

# Folderele create automat la fiecare client (la prima deschidere a documentelor lui). Cabinetul își poate alege lista în
# Setări › Documente (`workspaces/{wid}/setari/documente.foldereImplicite`); fără setare, se folosesc acestea.
FOLDERE_IMPLICITE = ("Acte identitate", "Documente generate", "Primite de la client")
MAX_FOLDERE_IMPLICITE = 10
# Folderul în care se păstrează copiile documentelor generate (setabil: `setari/documente.folderGenerate`).
FOLDER_GENERATE = "Documente generate"


class FisierRefuzat(ValueError):
    """`code` ajunge la client; nu conține nimic din fișier."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class StocareIndisponibila(RuntimeError):
    pass


# ── Tipuri permise ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Tip:
    mime: str
    ext: str                       # extensia canonică, fără punct
    familie: str                   # pdf | imagine | word | excel | prezentare | text | semnat | email
    alte_ext: tuple[str, ...] = ()

    def accepta_ext(self, ext: str) -> bool:
        return ext == self.ext or ext in self.alte_ext


PDF = Tip("application/pdf", "pdf", "pdf")
JPEG = Tip("image/jpeg", "jpg", "imagine", ("jpeg", "jpe", "jfif"))
PNG = Tip("image/png", "png", "imagine")
WEBP = Tip("image/webp", "webp", "imagine")
GIF = Tip("image/gif", "gif", "imagine")
TIFF = Tip("image/tiff", "tif", "imagine", ("tiff",))
HEIC = Tip("image/heic", "heic", "imagine", ("heif",))
DOCX = Tip("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", "word")
XLSX = Tip("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", "excel")
PPTX = Tip("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", "prezentare")
ODT = Tip("application/vnd.oasis.opendocument.text", "odt", "word")
ODS = Tip("application/vnd.oasis.opendocument.spreadsheet", "ods", "excel")
DOC = Tip("application/msword", "doc", "word")
XLS = Tip("application/vnd.ms-excel", "xls", "excel")
PPT = Tip("application/vnd.ms-powerpoint", "ppt", "prezentare")
MSG = Tip("application/vnd.ms-outlook", "msg", "email")
XML = Tip("application/xml", "xml", "text")
TXT = Tip("text/plain", "txt", "text")
CSV = Tip("text/csv", "csv", "text")
P7S = Tip("application/pkcs7-signature", "p7s", "semnat")
P7M = Tip("application/pkcs7-mime", "p7m", "semnat")

# Tipurile pe care browserul le poate afișa direct (previzualizare în aplicație).
PREVIZUALIZABILE = frozenset({PDF.mime, JPEG.mime, PNG.mime, WEBP.mime, GIF.mime})
# Ce se acceptă prin `mime` din metadate la descărcare (orice altceva devine application/octet-stream).
MIME_CUNOSCUTE = frozenset(t.mime for t in (PDF, JPEG, PNG, WEBP, GIF, TIFF, HEIC, DOCX, XLSX, PPTX, ODT, ODS, DOC, XLS,
                                            PPT, MSG, XML, TXT, CSV, P7S, P7M))

_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_OLE_DUPA_EXT = {"doc": DOC, "dot": DOC, "xls": XLS, "ppt": PPT, "msg": MSG}
_HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"}
_ZIP_MAX_INTRARI = 5000
_ZIP_MAX_CONTENT_TYPES = 1024 * 1024


def extensie(nume: str) -> str:
    _, dot, ext = (nume or "").rpartition(".")
    return ext.lower() if dot else ""


def _tip_zip(data: bytes) -> Tip:
    """OOXML / OpenDocument. Se citesc doar numele intrărilor și două fișiere mici (tipurile, `mimetype`): nimic nu
    se decomprimă peste dimensiunea declarată, deci o arhivă-bombă nu consumă memorie."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        infos = zf.infolist()
    except (zipfile.BadZipFile, ValueError):
        raise FisierRefuzat("tip_nepermis")
    if len(infos) > _ZIP_MAX_INTRARI:
        raise FisierRefuzat("tip_nepermis")
    nume = {i.filename for i in infos}
    if any("vbaproject" in n.lower() for n in nume):
        raise FisierRefuzat("fisier_macro")

    def citeste(n: str) -> bytes:
        info = zf.getinfo(n)
        if info.file_size > _ZIP_MAX_CONTENT_TYPES:
            raise FisierRefuzat("tip_nepermis")
        try:
            return zf.read(n)
        except (zipfile.BadZipFile, ValueError, RuntimeError):
            raise FisierRefuzat("tip_nepermis")

    if "[Content_Types].xml" in nume:
        tipuri = citeste("[Content_Types].xml")
        if b"macroEnabled" in tipuri:
            raise FisierRefuzat("fisier_macro")
        if "word/document.xml" in nume:
            return DOCX
        if "xl/workbook.xml" in nume:
            return XLSX
        if "ppt/presentation.xml" in nume:
            return PPTX
    if "mimetype" in nume:
        mt = citeste("mimetype").strip()
        if mt == ODT.mime.encode():
            return ODT
        if mt == ODS.mime.encode():
            return ODS
    raise FisierRefuzat("tip_nepermis")      # arhive obișnuite (.zip, .rar redenumit etc.)


def _e_text(data: bytes) -> bool:
    mostra = data[:8192]
    if b"\x00" in mostra:
        return False
    try:
        mostra.decode("utf-8")
        return True
    except UnicodeDecodeError as e:
        if e.start >= len(mostra) - 3:          # caracter tăiat la capătul mostrei
            return True
    try:
        mostra.decode("cp1250")                 # fișiere românești vechi (Windows)
        return True
    except UnicodeDecodeError:
        return False


def detecteaza_tip(data: bytes, nume: str) -> Tip:
    """Tipul fișierului, după conținut. Extensia decide doar între formate cu aceeași semnătură (OLE, text, PKCS#7)."""
    if not data:
        raise FisierRefuzat("fisier_gol")
    ext = extensie(nume)
    cap = data[:16]
    # PDF doar dacă fișierul ÎNCEPE cu semnătura (după spații albe sau BOM): un „%PDF-” oriunde în primul KB ar lăsa să
    # treacă o arhivă, un executabil sau un .docm cu macro-uri drept PDF.
    if (data[3:] if data.startswith(b"\xef\xbb\xbf") else data).lstrip()[:5] == b"%PDF-":
        return PDF
    if cap.startswith(b"\xff\xd8\xff"):
        return JPEG
    if cap.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if cap[:4] == b"RIFF" and cap[8:12] == b"WEBP":
        return WEBP
    if cap[:6] in (b"GIF87a", b"GIF89a"):
        return GIF
    if cap[:4] in (b"II*\x00", b"MM\x00*"):
        return TIFF
    if cap[4:8] == b"ftyp" and cap[8:12] in _HEIC_BRANDS:
        return HEIC
    if cap.startswith(b"PK\x03\x04"):
        return _tip_zip(data)
    if cap.startswith(_OLE):
        tip = _OLE_DUPA_EXT.get(ext)
        if tip is None:
            raise FisierRefuzat("tip_nepermis")
        return tip
    if ext in ("p7s", "p7m") and cap[:1] == b"\x30":        # DER: SEQUENCE
        return P7S if ext == "p7s" else P7M
    corp = data[3:] if data.startswith(b"\xef\xbb\xbf") else data
    if corp.lstrip()[:5] == b"<?xml" and _e_text(corp):
        return XML
    if ext in ("txt", "csv") and _e_text(corp):
        return TXT if ext == "txt" else CSV
    raise FisierRefuzat("tip_nepermis")


# ── Nume ──────────────────────────────────────────────────────────────────────

_INTERZISE = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')


def _curata(raw: str, maxim: int) -> str:
    s = unicodedata.normalize("NFC", str(raw or ""))
    s = _INTERZISE.sub(" ", s)
    s = " ".join(s.split())
    return s.strip(" .")[:maxim].strip(" .")


def nume_fisier(raw: str, tip: Tip) -> str:
    """Numele afișat: diacriticele rămân; caracterele de control și separatorii de cale dispar; extensia corespunde
    tipului real (un „act.pdf” care e de fapt JPEG devine „act.pdf.jpg”, ca să se deschidă cu aplicația potrivită)."""
    s = _curata(raw, MAX_NUME + 10)
    ext = extensie(s)
    if ext and tip.accepta_ext(ext):
        baza, ext_final = s[: -(len(ext) + 1)], ext
    else:
        baza, ext_final = s, tip.ext
    baza = baza.strip(" .")[:MAX_NUME].strip(" .") or "document"
    return f"{baza}.{ext_final}"


def redenumeste(raw: str, actual: str) -> str:
    """Numele nou la redenumire. Extensia fișierului nu se schimbă: dacă utilizatorul o șterge, se pune la loc."""
    ext = extensie(actual)
    s = _curata(raw, MAX_NUME + 10)
    if ext and extensie(s) == ext:
        s = s[: -(len(ext) + 1)]
    s = s.strip(" .")[:MAX_NUME].strip(" .")
    if not s:
        raise FisierRefuzat("nume_invalid")
    return f"{s}.{ext}" if ext else s


def nume_folder(raw: str) -> str:
    s = _curata(raw, MAX_NUME_FOLDER)
    if not s:
        raise FisierRefuzat("nume_invalid")
    return s


def cheie_nume(nume: str) -> str:
    """Comparația numelor din același folder: fără deosebire de majuscule."""
    return unicodedata.normalize("NFC", nume).casefold()


def mime_sigur(mime: str | None) -> str:
    return mime if mime in MIME_CUNOSCUTE else "application/octet-stream"


# ── Stocare ───────────────────────────────────────────────────────────────────

def cale(wid: str, fid: str) -> str:
    """Calea nu depinde de client sau de folder: mutarea și arhivarea schimbă doar metadatele."""
    return f"workspaces/{wid}/fisiere/{fid}"


def prefix_cabinet(wid: str) -> str:
    return f"workspaces/{wid}/"


class _Gcs:
    def __init__(self, bucket: str):
        from firebase_admin import storage
        self._bucket = storage.bucket(bucket)

    def put(self, path: str, data: bytes) -> None:
        # if_generation_match=0: nu suprascrie niciodată un obiect existent
        self._bucket.blob(path).upload_from_string(data, content_type="application/octet-stream", if_generation_match=0)

    def get(self, path: str) -> bytes | None:
        from google.api_core import exceptions as gexc
        try:
            return self._bucket.blob(path).download_as_bytes()
        except gexc.NotFound:
            return None

    def delete(self, path: str) -> None:
        from google.api_core import exceptions as gexc
        try:
            self._bucket.blob(path).delete()
        except gexc.NotFound:
            pass

    def delete_prefix(self, prefix: str) -> int:
        """Câte 100 de obiecte într-o singură cerere (limita API-ului de loturi): un cabinet cu zeci de mii de documente
        se șterge în câteva sute de cereri, nu în zeci de mii, deci încape în timpul funcției de ștergere."""
        n = 0
        lot: list = []

        def trimite():
            with self._bucket.client.batch(raise_exception=False):     # un obiect deja șters nu oprește lotul
                for blob in lot:
                    blob.delete()

        for blob in self._bucket.list_blobs(prefix=prefix):
            lot.append(blob)
            if len(lot) == 100:
                trimite()
                n += len(lot)
                lot = []
        if lot:
            trimite()
            n += len(lot)
        return n


class _Local:
    """Doar dezvoltare și teste. Căile vin din id-uri validate (fără „..”), dar se verifică oricum."""

    def __init__(self, root: str):
        self._root = Path(root).resolve()

    def _p(self, path: str) -> Path:
        p = (self._root / path).resolve()
        if self._root not in p.parents:
            raise StocareIndisponibila("cale invalidă")
        return p

    def put(self, path: str, data: bytes) -> None:
        p = self._p(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "xb") as f:
            f.write(data)

    def get(self, path: str) -> bytes | None:
        p = self._p(path)
        return p.read_bytes() if p.exists() else None

    def delete(self, path: str) -> None:
        self._p(path).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> int:
        base = self._p(prefix.rstrip("/"))
        if not base.exists():
            return 0
        n = 0
        for f in sorted(base.rglob("*"), reverse=True):
            if f.is_file():
                f.unlink()
                n += 1
            else:
                f.rmdir()
        base.rmdir()
        return n


def stocare():
    bucket = os.getenv("FISIERE_BUCKET")
    if bucket:
        return _Gcs(bucket)
    local = os.getenv("FISIERE_LOCAL_DIR")
    if local and not os.getenv("K_SERVICE"):
        return _Local(local)
    raise StocareIndisponibila("stocarea fișierelor nu e configurată")


def configurata() -> bool:
    return bool(os.getenv("FISIERE_BUCKET") or (os.getenv("FISIERE_LOCAL_DIR") and not os.getenv("K_SERVICE")))


def salveaza(wid: str, fid: str, data: bytes) -> None:
    stocare().put(cale(wid, fid), vault.encrypt_file(wid, fid, data))


def citeste(wid: str, fid: str) -> bytes | None:
    blob = stocare().get(cale(wid, fid))
    return None if blob is None else vault.decrypt_file(wid, fid, blob)


def sterge(wid: str, fid: str) -> None:
    stocare().delete(cale(wid, fid))


def sterge_cabinet(wid: str) -> int:
    """La ștergerea definitivă a cabinetului. Fără stocare configurată nu există nimic de șters."""
    if not configurata():
        return 0
    return stocare().delete_prefix(prefix_cabinet(wid))
