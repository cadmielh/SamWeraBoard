import { auth } from "./firebase";
import type { BuiltinTemplate, ClauseMeta } from "../types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5000";
// OCR calls go directly to Cloud Run to bypass Firebase Hosting's 60s proxy timeout
const OCR_BASE = import.meta.env.VITE_OCR_BASE ?? BASE;

export interface IDFields {
  cnp: string;
  nume: string;
  prenume: string;
  serie_numar: string;
  data_nasterii: string;
  locul_nasterii: string;
  cetatenia: string;
  adresa: string;
  judet: string;
  emisa_de: string;
  valabila_de_la: string;
  valabila_pana_la: string;
}

async function headers(accessToken: string): Promise<Record<string, string>> {
  const idToken = await auth.currentUser!.getIdToken();
  return {
    "X-Firebase-Token": idToken,
    "Authorization": `Bearer ${accessToken}`,
  };
}

export async function extractFile(file: File, accessToken: string): Promise<IDFields> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${OCR_BASE}/extract`, {
    method: "POST",
    headers: await headers(accessToken),
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Extraction failed");
  return data as IDFields;
}

export async function extractFromDrive(fileId: string, accessToken: string): Promise<IDFields> {
  const res = await fetch(`${OCR_BASE}/extract/drive`, {
    method: "POST",
    headers: { ...(await headers(accessToken)), "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Extraction failed");
  return data as IDFields;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  label: string;
  is_folder: boolean;
}

export async function listDriveFiles(
  accessToken: string,
  folderId = "root",
  pageToken?: string
): Promise<{ files: DriveFile[]; nextPageToken?: string; folder_id: string }> {
  const params = new URLSearchParams({ folder_id: folderId });
  if (pageToken) params.set("page_token", pageToken);
  const res = await fetch(`${BASE}/drive/files?${params}`, {
    headers: await headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Drive error");
  return data;
}

export async function fillDocx(
  templateFile: File,
  fields: Record<string, string>,
  accessToken: string,
  uploadToDrive = false,
  driveFolderId?: string,
  outputName?: string,
  groups?: Record<string, Record<string, string>[]>,
  selectedClauses?: string[],
): Promise<{ blob?: Blob; name?: string; link?: string }> {
  const fd = new FormData();
  fd.append("template", templateFile);
  Object.entries(fields).forEach(([k, v]) => fd.append(k.toUpperCase(), v));
  if (uploadToDrive && driveFolderId) fd.append("_drive_folder_id", driveFolderId);
  if (outputName) fd.append("_output_name", outputName);
  if (groups) fd.append("_groups", JSON.stringify(groups));
  if (selectedClauses) fd.append("_clauses", JSON.stringify(selectedClauses));

  const endpoint = uploadToDrive ? `${BASE}/fill/docx/upload-to-drive` : `${BASE}/fill/docx`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: await headers(accessToken),
    body: fd,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Fill failed");
  }

  if (uploadToDrive) {
    const d = await res.json();
    return { name: d.name, link: d.link };
  }
  const blob = await res.blob();
  return { blob };
}

export interface AnafResult {
  found: boolean
  denumire?: string
  formaJuridica?: string
  adresa?: string
  nrRegCom?: string
  telefon?: string
  caenCod?: string
  caenSecundare?: string[]
  statutFiscal?: string
  platitorTva?: boolean
  periodaTva?: string
  tvaLaIncasare?: boolean
  // null/undefined = necunoscut (sursă de rezervă fără acest detaliu, nu ANAF)
  inactivAnaf?: boolean | null
  splitTva?: boolean | null
  eFactura?: boolean | null
  // Strict informativ — API-ul nu oferă CNP/CI, nu se poate mapa pe Persoana
  administratoriAnaf?: { nume: string; rol: string }[]
}

export async function fetchAnafCompany(cif: string, accessToken: string): Promise<AnafResult> {
  const res = await fetch(`${BASE}/anaf/company?cif=${encodeURIComponent(cif)}`, {
    headers: await headers(accessToken),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Eroare ANAF')
  return data as AnafResult
}

export async function detectPlaceholders(
  templateFile: File,
  accessToken: string,
): Promise<{ placeholders: string[]; clauses: ClauseMeta[] }> {
  const fd = new FormData();
  fd.append("template", templateFile);
  const res = await fetch(`${BASE}/template/placeholders`, {
    method: "POST",
    headers: await headers(accessToken),
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Placeholder detection failed");
  return { placeholders: data.placeholders as string[], clauses: (data.clauses ?? []) as ClauseMeta[] };
}

export async function fillDocxFromDriveTemplate(
  templateDriveId: string,
  fields: Record<string, string>,
  accessToken: string,
  uploadToDrive = false,
  driveFolderId?: string,
  outputName?: string,
  groups?: Record<string, Record<string, string>[]>,
  selectedClauses?: string[],
): Promise<{ blob?: Blob; name?: string; link?: string }> {
  const fd = new FormData();
  fd.append("template_drive_id", templateDriveId);
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (uploadToDrive && driveFolderId) fd.append("_drive_folder_id", driveFolderId);
  if (outputName) fd.append("_output_name", outputName);
  if (groups) fd.append("_groups", JSON.stringify(groups));
  if (selectedClauses) fd.append("_clauses", JSON.stringify(selectedClauses));

  const endpoint = uploadToDrive ? `${BASE}/fill/docx/upload-to-drive` : `${BASE}/fill/docx`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: await headers(accessToken),
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Fill failed");
  }
  if (uploadToDrive) {
    const d = await res.json();
    return { name: d.name, link: d.link };
  }
  const blob = await res.blob();
  return { blob };
}

export async function fillDocxFromBuiltinTemplate(
  builtinKey: string,
  fields: Record<string, string>,
  accessToken: string,
  uploadToDrive = false,
  driveFolderId?: string,
  outputName?: string,
  groups?: Record<string, Record<string, string>[]>,
  selectedClauses?: string[],
  rowGroups?: Record<string, Record<string, string>[]>,
): Promise<{ blob?: Blob; name?: string; link?: string }> {
  const fd = new FormData();
  fd.append("template_builtin_key", builtinKey);
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (uploadToDrive && driveFolderId) fd.append("_drive_folder_id", driveFolderId);
  if (outputName) fd.append("_output_name", outputName);
  if (groups) fd.append("_groups", JSON.stringify(groups));
  if (selectedClauses) fd.append("_clauses", JSON.stringify(selectedClauses));
  if (rowGroups) fd.append("_row_groups", JSON.stringify(rowGroups));

  const endpoint = uploadToDrive ? `${BASE}/fill/docx/upload-to-drive` : `${BASE}/fill/docx`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: await headers(accessToken),
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Fill failed");
  }
  if (uploadToDrive) {
    const d = await res.json();
    return { name: d.name, link: d.link };
  }
  const blob = await res.blob();
  return { blob };
}

export async function fillPdfFromBuiltinTemplate(
  builtinKey: string,
  fields: Record<string, string>,
  accessToken: string,
  outputName?: string,
): Promise<Blob> {
  const fd = new FormData();
  fd.append("template_builtin_key", builtinKey);
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (outputName) fd.append("_output_name", outputName);

  const res = await fetch(`${BASE}/fill/pdf`, {
    method: "POST",
    headers: await headers(accessToken),
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Fill failed");
  }
  return res.blob();
}

export async function fetchBuiltinTemplates(accessToken: string): Promise<BuiltinTemplate[]> {
  const res = await fetch(`${BASE}/templates/builtin`, {
    headers: await headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Nu s-au putut încărca șabloanele de bază");
  return data.templates as BuiltinTemplate[];
}

export async function fetchBuiltinTemplateBytes(key: string, accessToken: string): Promise<Blob> {
  const res = await fetch(`${BASE}/templates/builtin/${encodeURIComponent(key)}`, {
    headers: await headers(accessToken),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Nu s-a putut descărca șablonul de bază");
  }
  return res.blob();
}

export async function fillGdoc(
  templateDocId: string,
  fields: Record<string, string>,
  accessToken: string,
  outputName?: string,
): Promise<{ doc_id: string; link: string }> {
  const upperFields: Record<string, string> = {};
  Object.entries(fields).forEach(([k, v]) => { upperFields[k.toUpperCase()] = v; });

  const res = await fetch(`${BASE}/fill/gdoc`, {
    method: "POST",
    headers: { ...(await headers(accessToken)), "Content-Type": "application/json" },
    body: JSON.stringify({ template_doc_id: templateDocId, fields: upperFields, output_name: outputName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Fill failed");
  return data;
}
