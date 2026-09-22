import { auth } from "./firebase";
import { DOCX_MIME, DriveError, driveDownload, driveUpload, fillGoogleDoc } from "./drive";
import { pickAgain } from "./picker";
import type { BuiltinTemplate, ClauseMeta } from "../types";
import type { VariantContext } from './variants'

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";
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

// Workspace-ul activ, trimis la fiecare cerere: backend-ul verifică din el că
// utilizatorul e membru cu rol suficient (vezi authz.require_role). Setat din
// AppLayout la schimbarea workspace-ului.
let activeWorkspaceId = "";
export function setApiWorkspace(id: string | null) {
  activeWorkspaceId = id ?? "";
}

/** Mesajul afișat utilizatorului pentru un răspuns de eroare al API-ului (coduri cunoscute → text clar). */
export function apiErrorMessage(data: { error?: string } | undefined, res: Response, fallback: string): string {
  switch (data?.error) {
    case "rate_limited": {
      const s = Number(res.headers.get("Retry-After")) || 60;
      return `Prea multe cereri într-un timp scurt. Încearcă din nou peste ${s < 90 ? `${s} de secunde` : `${Math.ceil(s / 60)} minute`}.`;
    }
    case "consent_required":
      return "Administratorul spațiului de lucru trebuie să accepte termenii și DPA înainte de a prelucra date personale.";
    case "creation_not_allowed":
      return "Crearea de cabinete noi se face pe invitație. Solicită acces pilot la adresa de contact din subsolul paginii.";
    case "invalid_person":
      return "CNP-ul (13 cifre) sau seria actului au un format nevalid. Corectează datele persoanei și încearcă din nou.";
    case "vault_unavailable":
      return "Serviciul de protecție a datelor sensibile este temporar indisponibil. Încearcă din nou în câteva minute.";
    case "Forbidden":
      return "Nu ai drepturile necesare pentru această acțiune.";
    default:
      return data?.error ?? fallback;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const idToken = await auth.currentUser!.getIdToken();
  return {
    "X-Firebase-Token": idToken,
    "X-Workspace-Id": activeWorkspaceId,
  };
}

/** Apel JSON către API (membri, invitații, audit, vault). Nu folosește token-ul Google — doar identitatea Firebase.
 * Aruncă Error cu `code` = codul de eroare al serverului (ex. "last_admin", "consent_required"). */
export async function apiJson<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(await authHeaders()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(apiErrorMessage(data as { error?: string }, res, `HTTP ${res.status}`)) as Error & { code?: string; status?: number };
    err.code = (data as { error?: string }).error;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

// Puțin peste bugetul maxim al backend-ului (Azure ~48s + fallback OCR local
// plafonat la 45s, vezi _LOCAL_OCR_TIMEOUT din app.py) — altfel un request
// agățat (rețea căzută etc.) ține spinner-ul în loading la nesfârșit.
const OCR_TIMEOUT_MS = 100_000;

export async function extractFile(file: File, source: "upload" | "drive" = "upload"): Promise<IDFields> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("source", source);   // doar pentru jurnalul de acces (serverul nu vede Drive)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OCR_BASE}/extract`, {
      method: "POST",
      headers: await authHeaders(),
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Scanarea durează prea mult. Încearcă din nou sau completează manual.");
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(apiErrorMessage(data, res, "Extraction failed"));
  }
  return data as IDFields;
}

/** Destinația „Google Drive” pentru un document generat: tokenul Google (rămâne în browser) și folderul ales prin Picker. */
export interface DriveTarget { token: string; folderId?: string | null }

/** Persoanele cu sex necunoscut, din antetul X-Variant-Warnings (listă JSON de prefixe). Absent sau ilizibil: fără avertisment. */
export function parseVariantWarnings(raw: string | null): string[] | undefined {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return undefined;
    const list = parsed.filter((x): x is string => typeof x === "string");
    return list.length > 0 ? list : undefined;
  } catch { return undefined; }
}

export interface FillResult {
  blob?: Blob; name?: string; link?: string
  /** Persoane (prefixe de etichete) al căror sex nu s-a putut stabili: variantele „numit/ă” au rămas neschimbate. */
  warnings?: string[]
}

/** Rulează o operațiune pe un fișier Drive; dacă aplicația nu are (încă) acces la el — de ex. un șablon ales de un coleg —
 * cere utilizatorului să-l confirme prin Google Picker și reîncearcă o singură dată. */
async function withDriveAccess<T>(fileId: string, token: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof DriveError) || e.code !== "not_granted") throw e;
    const picked = await pickAgain(fileId, token);
    if (!picked) throw e;
    return await run();
  }
}

function fileNameFrom(res: Response, fallback: string): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "");
  try { return m ? decodeURIComponent(m[1]) : fallback; } catch { return m?.[1] ?? fallback; }
}

/** Trimite formularul la /fill/docx. Dacă se cere Drive, fișierul generat se încarcă din browser (serverul nu vede tokenul). */
async function postFillDocx(fd: FormData, drive: DriveTarget | null | undefined, outputName?: string): Promise<FillResult> {
  if (drive) fd.append("_destination", "drive");      // doar pentru jurnalul de acces
  const res = await fetch(`${BASE}/fill/docx`, { method: "POST", headers: await authHeaders(), body: fd });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(apiErrorMessage(err, res, "Fill failed"));
  }
  const blob = await res.blob();
  const warnings = parseVariantWarnings(res.headers.get("X-Variant-Warnings"));
  if (!drive) return { blob, warnings };
  const up = await driveUpload(blob, fileNameFrom(res, outputName || "document.docx"), DOCX_MIME, drive.folderId ?? null, drive.token);
  return { name: up.name, link: up.webViewLink, warnings };
}

function docxForm(fields: Record<string, string>, outputName?: string, groups?: Record<string, Record<string, string>[]>, selectedClauses?: string[], rowGroups?: Record<string, Record<string, string>[]>, upperKeys = false, variantCtx?: VariantContext): FormData {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(upperKeys ? k.toUpperCase() : k, v));
  if (outputName) fd.append("_output_name", outputName);
  if (groups) fd.append("_groups", JSON.stringify(groups));
  if (selectedClauses) fd.append("_clauses", JSON.stringify(selectedClauses));
  if (rowGroups) fd.append("_row_groups", JSON.stringify(rowGroups));
  if (variantCtx) fd.append("_ctx", JSON.stringify(variantCtx));   // sex/număr/categorie: serverul alege variantele „a/b”
  return fd;
}

export async function fillDocx(
  templateFile: File,
  fields: Record<string, string>,
  drive?: DriveTarget | null,
  outputName?: string,
  groups?: Record<string, Record<string, string>[]>,
  selectedClauses?: string[],
  rowGroups?: Record<string, Record<string, string>[]>,
  variantCtx?: VariantContext,
): Promise<FillResult> {
  const fd = docxForm(fields, outputName, groups, selectedClauses, rowGroups, true, variantCtx);
  fd.append("template", templateFile);
  return postFillDocx(fd, drive, outputName);
}

export interface AnafResult {
  found: boolean
  denumire?: string
  formaJuridica?: string
  adresa?: string
  adresaSediuComponente?: {
    strada: string
    numar: string
    localitate: string
    judet: string
    detaliiAdresa: string
  } | null
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

export async function fetchAnafCompany(cif: string): Promise<AnafResult> {
  const res = await fetch(`${BASE}/anaf/company?cif=${encodeURIComponent(cif)}`, {
    headers: await authHeaders(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(apiErrorMessage(data, res, 'Eroare ANAF'))
  return data as AnafResult
}

export async function detectPlaceholders(
  templateFile: File,
): Promise<{ placeholders: string[]; clauses: ClauseMeta[] }> {
  const fd = new FormData();
  fd.append("template", templateFile);
  const res = await fetch(`${BASE}/template/placeholders`, {
    method: "POST",
    headers: await authHeaders(),
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(data, res, "Placeholder detection failed"));
  return { placeholders: data.placeholders as string[], clauses: (data.clauses ?? []) as ClauseMeta[] };
}

/** Un loc liber („……”) dintr-un document fără etichete, cu contextul și propunerea serverului. */
export interface BlankSuggestion {
  id: number;
  scope: "company" | "person" | "manual";
  field: string | null;
  role?: "ASOCIAT" | "ADMINISTRATOR";
  person?: number;
  confidence: "high" | "medium" | "low";
  before: string;
  after: string;
  label: string;
  tag: string;
}

/** Grup candidat de bloc repetitiv: mai multe persoane cu aceeași structură, în aceeași frază („X … si Y …” —
 * kind „inline”) sau în paragrafe separate consecutive (kind „paragraph”). Ales „repeat”, devine un
 * {{#ASOCIATI}}/{{#ADMINISTRATORI}} care scalează la orice număr de persoane; „fixed” păstrează poziții numerotate.
 * role „CAEN” e diferit — nu o persoană, ci o listă de activități secundare needitate de la firma-exemplu
 * (câte un cod CAEN pe rând); devine {{#CAEN_SECUNDARE}}, la fel scalabilă. */
export interface BlankGroup {
  id: number;
  kind: "inline" | "paragraph";
  role: "ASOCIAT" | "ADMINISTRATOR" | "CAEN";
  count: number;
  blank_ids: number[];
  template_blank_ids: number[];
  label: string;
}

export interface BlankAnalysis {
  blanks: BlankSuggestion[];
  groups: BlankGroup[];
  companyFields: Record<string, string>;
  personFields: Record<string, string>;
}

/** Găsește locurile libere dintr-un .docx și propune câmpul potrivit pentru fiecare (nu modifică nimic). */
export async function analyzeBlanks(templateFile: File): Promise<BlankAnalysis> {
  const fd = new FormData();
  fd.append("template", templateFile);
  const res = await fetch(`${BASE}/template/blanks`, { method: "POST", headers: await authHeaders(), body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data as { error?: string }, res, "Analiza documentului a eșuat"));
  return data as BlankAnalysis;
}

/** Înlocuiește locurile libere cu etichetele alese ({id: „{{CÂMP}}”}) și întoarce șablonul rezultat.
 * `groupChoices` ({group_id: "repeat"|"fixed"}) decide soarta grupurilor găsite de analyzeBlanks. */
export async function applyBlanks(
  templateFile: File, choices: Record<number, string>, groupChoices?: Record<number, "repeat" | "fixed">,
): Promise<File> {
  const fd = new FormData();
  fd.append("template", templateFile);
  fd.append("choices", JSON.stringify(choices));
  if (groupChoices) fd.append("groups", JSON.stringify(groupChoices));
  const res = await fetch(`${BASE}/template/blanks/apply`, { method: "POST", headers: await authHeaders(), body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data as { error?: string }, res, "Crearea șablonului a eșuat"));
  }
  return new File([await res.blob()], templateFile.name, { type: DOCX_MIME });
}

/** Șablon .docx aflat în Drive: se descarcă în browser (cu confirmarea accesului prin Picker, dacă e nevoie),
 * apoi se completează ca orice șablon încărcat. */
export async function fillDocxFromDriveTemplate(
  templateDriveId: string,
  fields: Record<string, string>,
  token: string,
  drive?: DriveTarget | null,
  outputName?: string,
  groups?: Record<string, Record<string, string>[]>,
  selectedClauses?: string[],
  rowGroups?: Record<string, Record<string, string>[]>,
  variantCtx?: VariantContext,
): Promise<FillResult> {
  const tpl = await withDriveAccess(templateDriveId, token, () => driveDownload(templateDriveId, token));
  const file = new File([tpl.blob], tpl.name.endsWith(".docx") ? tpl.name : `${tpl.name}.docx`, { type: DOCX_MIME });
  const fd = docxForm(fields, outputName, groups, selectedClauses, rowGroups, false, variantCtx);
  fd.append("template", file);
  return postFillDocx(fd, drive, outputName);
}

export async function fillDocxFromBuiltinTemplate(
  builtinKey: string,
  fields: Record<string, string>,
  drive?: DriveTarget | null,
  outputName?: string,
  groups?: Record<string, Record<string, string>[]>,
  selectedClauses?: string[],
  rowGroups?: Record<string, Record<string, string>[]>,
  variantCtx?: VariantContext,
): Promise<FillResult> {
  const fd = docxForm(fields, outputName, groups, selectedClauses, rowGroups, false, variantCtx);
  fd.append("template_builtin_key", builtinKey);
  return postFillDocx(fd, drive, outputName);
}

export async function fillPdfFromBuiltinTemplate(
  builtinKey: string,
  fields: Record<string, string>,
  outputName?: string,
): Promise<Blob> {
  const fd = new FormData();
  fd.append("template_builtin_key", builtinKey);
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (outputName) fd.append("_output_name", outputName);

  const res = await fetch(`${BASE}/fill/pdf`, {
    method: "POST",
    headers: await authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(apiErrorMessage(err, res, "Fill failed"));
  }
  return res.blob();
}

export async function fetchBuiltinTemplates(): Promise<BuiltinTemplate[]> {
  const res = await fetch(`${BASE}/templates/builtin`, {
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(data, res, "Nu s-au putut încărca șabloanele de bază"));
  return data.templates as BuiltinTemplate[];
}

export async function fetchBuiltinTemplateBytes(key: string): Promise<Blob> {
  const res = await fetch(`${BASE}/templates/builtin/${encodeURIComponent(key)}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(apiErrorMessage(err, res, "Nu s-a putut descărca șablonul de bază"));
  }
  return res.blob();
}

/** Raportează serverului (doar pentru jurnalul de acces) că s-a generat un document în afara lui, ex. un Google Doc completat
 * din browser. Se trimit doar metadate, niciodată valorile câmpurilor. Eșecul raportării nu blochează utilizatorul. */
export async function reportDocument(meta: { format: "docx" | "pdf" | "gdoc"; template: string; destination: "download" | "drive"; fields: number; cnp: boolean }): Promise<void> {
  try {
    await apiJson("POST", "/audit/document", meta);
  } catch { /* jurnalul e best-effort din partea clientului */ }
}

/** Completează un șablon Google Docs direct din browser (copie + înlocuiri). Serverul nu vede documentul. */
export async function fillGdoc(
  templateDocId: string,
  fields: Record<string, string>,
  token: string,
  outputName?: string,
): Promise<{ doc_id: string; link: string }> {
  const upperFields: Record<string, string> = {};
  Object.entries(fields).forEach(([k, v]) => { upperFields[k.toUpperCase()] = v; });
  const out = await withDriveAccess(templateDocId, token, () => fillGoogleDoc(templateDocId, upperFields, outputName, token));
  void reportDocument({
    format: "gdoc", template: "drive", destination: "drive",
    fields: Object.values(upperFields).filter(Boolean).length,
    cnp: Object.entries(upperFields).some(([k, v]) => v && k.includes("CNP")),
  });
  return { doc_id: out.docId, link: out.link };
}
