"""Google Drive and Google Docs integration — token-based (no local credentials file)."""

import datetime
import io

from google.oauth2.credentials import Credentials as OAuthCredentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload


# ── Service builders ──────────────────────────────────────────────────────────

def _creds(access_token: str) -> OAuthCredentials:
    creds = OAuthCredentials(token=access_token)
    # Prevent proactive refresh (token appears valid to the library)
    creds.expiry = datetime.datetime.utcnow() + datetime.timedelta(hours=1)
    # Prevent reactive refresh after a 401 — we never have a refresh_token
    creds.refresh = lambda *_: (_ for _ in ()).throw(
        Exception("Google token expired — please sign out and sign in again")
    )
    return creds


def _drive_service(access_token: str):
    return build("drive", "v3", credentials=_creds(access_token))


def _docs_service(access_token: str):
    return build("docs", "v1", credentials=_creds(access_token))


# ── Drive ─────────────────────────────────────────────────────────────────────

SUPPORTED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/webp", "application/pdf",
    "application/vnd.google-apps.document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

MIME_LABELS = {
    "image/jpeg": "Image", "image/png": "Image", "image/webp": "Image",
    "application/pdf": "PDF",
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
}


def list_files(access_token: str, folder_id: str = "root", page_token: str | None = None) -> dict:
    service = _drive_service(access_token)
    mime_filter = " or ".join(f"mimeType='{m}'" for m in SUPPORTED_MIME_TYPES)

    if folder_id == "sharedWithMe":
        q = f"sharedWithMe=true and trashed=false and (mimeType='application/vnd.google-apps.folder' or {mime_filter})"
    else:
        q = f"'{folder_id}' in parents and trashed=false and (mimeType='application/vnd.google-apps.folder' or {mime_filter})"

    kwargs = dict(q=q, spaces="drive",
                  fields="nextPageToken, files(id, name, mimeType, modifiedTime, size)",
                  orderBy="folder,name", pageSize=50,
                  includeItemsFromAllDrives=True, supportsAllDrives=True)
    if page_token:
        kwargs["pageToken"] = page_token
    result = service.files().list(**kwargs).execute()
    files = result.get("files", [])
    for f in files:
        f["label"] = MIME_LABELS.get(f["mimeType"], "File")
        f["is_folder"] = f["mimeType"] == "application/vnd.google-apps.folder"

    # Inject virtual "Shared with me" folder at root (first page only)
    if folder_id == "root" and not page_token:
        files.insert(0, {
            "id": "sharedWithMe",
            "name": "Shared with me",
            "mimeType": "application/vnd.google-apps.folder",
            "modifiedTime": None,
            "size": None,
            "label": "Folder",
            "is_folder": True,
        })

    return {"files": files, "nextPageToken": result.get("nextPageToken"), "folder_id": folder_id}


def download_file(access_token: str, file_id: str) -> tuple[bytes, str, str]:
    """Returns (bytes, filename, mime_type). Google Docs are exported as PDF."""
    service = _drive_service(access_token)
    meta = service.files().get(fileId=file_id, fields="id, name, mimeType").execute()
    mime, name = meta["mimeType"], meta["name"]
    buf = io.BytesIO()
    if mime == "application/vnd.google-apps.document":
        req = service.files().export_media(fileId=file_id, mimeType="application/pdf")
        name, mime = name + ".pdf", "application/pdf"
    else:
        req = service.files().get_media(fileId=file_id)
    dl = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    return buf.getvalue(), name, mime


def upload_file(access_token: str, file_bytes: bytes, filename: str, mime_type: str, folder_id: str | None = None) -> dict:
    service = _drive_service(access_token)
    meta: dict = {"name": filename}
    if folder_id:
        meta["parents"] = [folder_id]
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=True)
    return service.files().create(body=meta, media_body=media, fields="id, name, webViewLink").execute()


# ── Google Docs template filling ──────────────────────────────────────────────

def fill_google_doc(access_token: str, template_doc_id: str, replacements: dict[str, str], output_name: str | None = None) -> str:
    drive_svc = _drive_service(access_token)
    docs_svc  = _docs_service(access_token)
    title = docs_svc.documents().get(documentId=template_doc_id).execute().get("title", template_doc_id)
    copy_title = output_name or f"Completat - {title}"
    new_id = drive_svc.files().copy(fileId=template_doc_id, body={"name": copy_title}).execute()["id"]
    requests = [
        {"replaceAllText": {"containsText": {"text": ph, "matchCase": True}, "replaceText": val}}
        for ph, val in replacements.items()
    ]
    if requests:
        docs_svc.documents().batchUpdate(documentId=new_id, body={"requests": requests}).execute()
    return new_id


def get_doc_web_link(access_token: str, doc_id: str) -> str:
    return _drive_service(access_token).files().get(fileId=doc_id, fields="webViewLink").execute().get("webViewLink", "")
