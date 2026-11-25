import { auth } from "./firebase";
import { DOCX_MIME, DriveError, driveDownload, driveUpload, fillGoogleDoc } from "./drive";
import { pickAgain } from "./picker";
import { SESSION_ENDED_CODES } from "./authErrors";
import type { BuiltinTemplate, ClauseMeta } from "../types";
import type { VariantContext } from './variants'
import { marcheazaPas } from './ghidPornire'

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

/** Evenimentul care deschide fereastra de abonare (UpgradeModal), emis la orice refuz `subscription_required`
 * (detail: 'access') sau `credits_required` (detail: 'credits' — cabinet pe credite, fără credite pentru un client nou). */
export const SUBSCRIPTION_REQUIRED_EVENT = 'cabinio:subscription-required'

export function notifySubscriptionRequired(kind: 'access' | 'credits' = 'access'): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REQUIRED_EVENT, { detail: kind }))
}

/** Emis după o generare care a consumat (sau a folosit) un credit — detaliul vine din antetul X-Credits. */
export const CREDITS_EVENT = 'cabinio:credits'
export interface CreditsUse { consumed: boolean; balance: number | null; coveredUntil: string | null }

function notifyCredits(raw: string | null): void {
  if (!raw || typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent<CreditsUse>(CREDITS_EVENT, { detail: JSON.parse(raw) as CreditsUse }))
  } catch { /* antet invalid: doar informativ */ }
}

// Clientul pentru care se generează acum (setat de pagina de generare, ca setApiWorkspace): la cabinetele pe credite,
// serverul consumă creditul lui după generare (vezi billing_credits.py).
let generationClientId = "";
export function setGenerationClient(id: string | null | undefined) {
  generationClientId = id ?? "";
}

/** Mesajul afișat utilizatorului pentru un răspuns de eroare al API-ului (coduri cunoscute → text clar).
 * Un refuz `subscription_required` deschide și fereastra de abonare (toate apelurile API trec pe aici). */
export function apiErrorMessage(data: { error?: string } | undefined, res: Response, fallback: string): string {
  switch (data?.error) {
    case "rate_limited": {
      const s = Number(res.headers.get("Retry-After")) || 60;
      return `Prea multe cereri într-un timp scurt. Încearcă din nou peste ${s < 90 ? `${s} de secunde` : `${Math.ceil(s / 60)} minute`}.`;
    }
    case "consent_required":
      return "Administratorul spațiului de lucru trebuie să accepte termenii și DPA înainte de a prelucra date personale.";
    case "creation_not_allowed":
      return "Crearea de cabinete noi este momentan oprită. Scrie-ne la adresa de contact din subsolul paginii.";
    case "subscription_required":
      notifySubscriptionRequired();
      return "Perioada de probă, abonamentul sau creditele cabinetului au expirat. Alege un abonament sau un pachet de credite pentru a continua.";
    case "credits_required":
      notifySubscriptionRequired("credits");
      return "Nu mai ai credite pentru un client nou. Cumpără un pachet de credite din pagina Abonament.";
    case "client_required":
      return "Cabinetul folosește credite: salvează întâi clientul în portofoliu, apoi generează documentul.";
    case "subscription_active":
      return "Cabinetul are abonament activ, care include generări nelimitate: creditele nu sunt necesare.";
    case "invalid_pack":
      return "Pachetul de credite ales nu există.";
    case "billing_details_required":
      return "Completează datele de facturare (firmă, PFA, II sau IF) și confirmă că achiziționezi în scop profesional.";
    case "business_only":
      return "Abonamentele și creditele se vând doar firmelor și profesioniștilor (PJ, PFA, II, IF), cu CUI.";
    case "professional_required":
      return "Bifează confirmarea că achiziționezi în numele unei firme, PFA, II sau IF, în scopul activității profesionale.";
    case "subscription_exists":
      return "Cabinetul are deja un abonament. Îl poți gestiona din portalul de plată.";
    case "billing_unavailable":
      return "Plățile sunt temporar indisponibile. Încearcă din nou în câteva minute.";
    case "invalid_cui":
      return "CUI-ul nu este valid. Verifică cifrele (cu sau fără „RO”).";
    case "invalid_person":
      return "CNP-ul (13 cifre) sau seria actului au un format nevalid. Corectează datele persoanei și încearcă din nou.";
    case "vault_unavailable":
      return "Serviciul de protecție a datelor sensibile este temporar indisponibil. Încearcă din nou în câteva minute.";
    case "recent_login_required":
      return "Din motive de siguranță, autentifică-te din nou și reîncearcă.";
    case "confirm_mismatch":
      return "Textul de confirmare nu corespunde.";
    case "unavailable":
      return "Operațiunea nu a putut fi finalizată acum. Încearcă din nou în câteva minute.";
    case "Forbidden":
      return "Nu ai drepturile necesare pentru această acțiune.";
    // ── Șabloane (template_safety.py, templates_api.py) ──
    case "invalid_template":
      return "Fișierul nu este un document Word (.docx) valid sau nu poate fi citit.";
    case "template_too_large":
      return "Fișierul depășește 500 KB. Comprimă imaginile din document (Word: Fișier → Comprimare imagini) și încearcă din nou.";
    case "template_macros":
      return "Documentul conține macro-uri. Salvează-l din Word ca „Document Word (.docx)” obișnuit și încearcă din nou.";
    case "template_embedded_objects":
      return "Documentul conține obiecte încorporate (OLE/ActiveX). Elimină-le din document și încearcă din nou.";
    case "template_external_content":
      return "Documentul încarcă un șablon sau conținut de la o adresă externă. Elimină legătura (Word: Dezvoltator → Șablon document) și încearcă din nou.";
    case "revision_conflict":
      return "Un coleg a înlocuit între timp fișierul acestui șablon. Verifică versiunea nouă înainte de a-l înlocui din nou.";
    case "not_replaceable":
      return "Doar fișierul unui șablon Word încărcat în aplicație poate fi înlocuit.";
    case "not_deliverable":
      return "Doar un șablon Word încărcat în aplicație poate fi trimis altui cabinet.";
    case "already_delivered":
      return "Șablonul a fost deja trimis acestui cabinet.";
    case "target_consent_required":
      return "Cabinetul ales nu a acceptat încă termenii și DPA-ul.";
    case "target_subscription_required":
      return "Cabinetul ales e în modul citire (perioada de probă sau abonamentul a expirat): șabloanele se trimit doar cabinetelor în probă, cu abonament sau cu acces gratuit.";
    case "invalid_source_key":
      return "Formularul dedicat ales nu există.";
    case "name_required":
      return "Introdu un nume pentru șablon.";
    // ── Documentele clienților (fisiere_api.py) ──
    case "feature_disabled":
      return "Documentele clienților nu sunt încă activate pentru acest cabinet.";
    case "storage_unavailable":
      return "Stocarea documentelor este temporar indisponibilă. Încearcă din nou în câteva minute.";
    case "fisier_prea_mare":
      return "Fișierul depășește 15 MB.";
    case "fisier_gol":
      return "Fișierul este gol.";
    case "tip_nepermis":
      return "Tipul fișierului nu este acceptat. Încarcă PDF, imagini, documente Word, Excel, XML sau text.";
    case "fisier_macro":
      return "Documentul conține macro-uri și nu poate fi păstrat. Salvează-l ca document obișnuit (.docx/.xlsx) și încearcă din nou.";
    case "spatiu_depasit":
      return "Cabinetul a atins limita de spațiu pentru documente (10 GB). Șterge documente vechi sau scrie-ne pentru mai mult spațiu.";
    case "nume_existent":
      return "Există deja un element cu acest nume în folder.";
    case "nume_invalid":
      return "Numele nu este valid.";
    case "folder_invalid":
      return "Folderul nu mai există. Reîmprospătează lista și încearcă din nou.";
    case "folder_ciclu":
      return "Un folder nu poate fi mutat în propriul subfolder.";
    case "folder_prea_adanc":
      return "S-a atins numărul maxim de niveluri de foldere (6).";
    case "prea_multe_foldere":
      return "Clientul are deja numărul maxim de foldere (200).";
    case "fisier_indisponibil":
      return "Conținutul fișierului nu mai este disponibil.";
    case "arhivat":
      return "Documentele din Arhivă nu pot fi mutate în foldere.";
    case "pagini_invalide":
      return "Ordinea paginilor nu e validă. Redeschide documentul și încearcă din nou.";
    case "pdf_parola":
      return "PDF-ul este protejat cu parolă și nu poate fi modificat.";
    case "tipar_invalid":
      return "Alege documentele aceluiași client: pentru buletin, una sau două poze.";
    case "tipar_prea_mare":
      return "PDF-ul ar depăși 15 MB. Alege mai puține documente sau micșorează pozele (Editează).";
    case "prea_multe_pagini":
      return "Rezultatul ar avea peste 60 de pagini. Alege mai puține documente.";
    case "fisier_modificat":
      return "Documentul a fost modificat între timp. Redeschide-l și încearcă din nou.";
    case "folder_negol":
      return "Folderul a primit conținut nou între timp. Verifică și confirmă din nou ștergerea.";
    default:
      return data?.error ?? fallback;
  }
}

/** Încărcările și descărcările de documente merg direct la funcția dedicată `documente` (main.py), cu mai multe transferuri
 * pe instanță, fără plafonul de timp al Hosting-ului. Fără VITE_FILES_BASE (dezvoltare locală): același server ca OCR-ul. */
export const FILES_BASE = import.meta.env.VITE_FILES_BASE ?? OCR_BASE;

export async function authHeaders(): Promise<Record<string, string>> {
  const idToken = await auth.currentUser!.getIdToken();
  return {
    "X-Firebase-Token": idToken,
    "X-Workspace-Id": activeWorkspaceId,
  };
}

/** Un 401 poate veni și dintr-o problemă trecătoare; sesiunea se încheie doar dacă Firebase confirmă că nu mai e valabilă. */
async function endSessionIfInvalid(): Promise<void> {
  try {
    await auth.currentUser?.getIdToken(true);
  } catch (e) {
    if (SESSION_ENDED_CODES.includes((e as { code?: string }).code ?? "")) await auth.signOut();
  }
}

/** „Trezește” serverul (instanța poate porni la rece): o cerere fără date și fără autentificare, al cărei răspuns
 * nu contează. Folosit la intrarea în pagini unde urmează o cerere grea, ca aceea să nu mai aștepte pornirea. */
export function warmUpApi(): void {
  fetch(`${BASE}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => { /* doar încălzire */ });
}

/** Apel JSON către API (membri, invitații, audit, vault). Nu folosește token-ul Google — doar identitatea Firebase.
 * Aruncă Error cu `code` = codul de eroare al serverului (ex. "last_admin", "consent_required"). */
export async function apiJson<T = unknown>(method: string, path: string, body?: unknown, workspaceId?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(await authHeaders()),
      // Un cabinet anume (ex. o ștergere amânată pornită în alt cabinet decât cel activ acum la expirarea ei).
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) await endSessionIfInvalid();
  if (!res.ok) {
    const err = new Error(apiErrorMessage(data as { error?: string }, res, `HTTP ${res.status}`)) as Error & { code?: string; status?: number; data?: unknown };
    err.code = (data as { error?: string }).error;
    err.status = res.status;
    err.data = data;
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
      throw new Error("Scanarea durează prea mult. Încearcă din nou sau completează manual.", { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(apiErrorMessage(data, res, "Extraction failed"));
  }
  marcheazaPas("scan");
  return data as IDFields;
}

/** OCR pe un act deja păstrat în documentele clientului: serverul îl decriptează și îl citește (fără re-încărcare). */
export async function extractStoredFile(fisierId: string): Promise<IDFields> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OCR_BASE}/fisiere/${encodeURIComponent(fisierId)}/extract`, {
      method: "POST", headers: await authHeaders(), signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Citirea actului durează prea mult. Încearcă din nou.", { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data as { error?: string }, res, "Citirea actului a eșuat"));
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
  if (generationClientId) fd.append("_client_id", generationClientId);
  const res = await fetch(`${BASE}/fill/docx`, { method: "POST", headers: await authHeaders(), body: fd });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(apiErrorMessage(err, res, "Fill failed"));
  }
  notifyCredits(res.headers.get("X-Credits"));
  marcheazaPas("generare");
  const blob = await res.blob();
  const warnings = parseVariantWarnings(res.headers.get("X-Variant-Warnings"));
  const name = fileNameFrom(res, outputName || "document.docx");
  if (!drive) return { blob, name, warnings };
  const up = await driveUpload(blob, name, DOCX_MIME, drive.folderId ?? null, drive.token);
  // Fișierul rămâne și în rezultat: copia din documentele clientului se face și când documentul merge în Drive.
  return { blob, name: up.name, link: up.webViewLink, warnings };
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
  // Data înregistrării (ISO, „2002-01-23”) — lipsește din răspuns când ANAF nu o întoarce
  dataInregistrare?: string
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
): Promise<{ placeholders: string[]; clauses: ClauseMeta[]; repeatGroups: string[] }> {
  const fd = new FormData();
  fd.append("template", templateFile);
  const res = await fetch(`${BASE}/template/placeholders`, {
    method: "POST",
    headers: await authHeaders(),
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(data, res, "Placeholder detection failed"));
  return {
    placeholders: data.placeholders as string[], clauses: (data.clauses ?? []) as ClauseMeta[],
    repeatGroups: (data.repeatGroups ?? []) as string[],
  };
}

/** Un loc liber („……”) dintr-un document fără etichete, cu contextul și propunerea serverului.
 * `role`, pentru scope „person”: nu doar ASOCIAT/ADMINISTRATOR — orice calitate juridică găsită din
 * context (COMODANT, REPREZENTANT_LEGAL, CHIRIAS…, vezi blanks.py — motorul e generic, nu limitat la o
 * listă fixă). `source: "ai"` — sugestie venită de la /template/blanks/ai-suggest, nu de la motorul
 * determinist (vezi BlankImportModal — rămâne mereu „de verificat”, confidence „medium”, niciodată „high”). */
export interface BlankSuggestion {
  id: number;
  scope: "company" | "person" | "manual";
  field: string | null;
  role?: string;
  person?: number;
  confidence: "high" | "medium" | "low";
  before: string;
  after: string;
  /** Context mult mai larg (până la câteva paragrafe vecine), arătat doar la cerere („arată mai mult”) —
   * absent pentru unele tipuri de câmpuri (ex. CAEN needitat), unde `before`/`after` sunt deja tot ce există. */
  before_wide?: string;
  after_wide?: string;
  label: string;
  tag: string;
  source?: "ai";
  /** O linie de semnătură (nume + linie de subliniere, sau lângă titlul unei secțiuni de semnătură) — reia
   * DELIBERAT rolul+numărul unei persoane deja menționate (aceeași persoană semnează), niciodată o coliziune
   * reală (vezi BlankImportModal: duplicatePersonPositions, care exclude aceste linii de la numărătoare). */
  is_signature_line?: boolean;
}

/** Grup candidat de bloc repetitiv: mai multe persoane cu aceeași structură, în aceeași frază („X … si Y …” —
 * kind „inline”) sau în paragrafe separate consecutive (kind „paragraph”). Ales „repeat”, devine un
 * {{#ASOCIATI}}/{{#ADMINISTRATORI}} care scalează la orice număr de persoane; „fixed” păstrează poziții numerotate.
 * role „CAEN” e diferit — nu o persoană, ci o listă de activități secundare needitate de la firma-exemplu
 * (câte un cod CAEN pe rând); devine {{#CAEN_SECUNDARE}}, la fel scalabilă. */
export interface BlankGroup {
  id: number;
  kind: "inline" | "paragraph";
  role: string;
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

/** Sugestii AI (opțional — apelat DOAR la cererea explicită a utilizatorului, niciodată automat) pentru
 * locurile libere pe care motorul determinist nu le recunoaște cu încredere (confidence != „high”). Nu
 * modifică nimic — sugestiile se afișează în același ecran de confirmare ca cele ale motorului determinist. */
/** `blankIds`, dacă e dat, cere sugestii DOAR pentru acele locuri (per câmp) — mai puțini tokeni trimiși
 * decât pentru toate cele needeslușite deodată; lipsă = toate, ca înainte. */
export async function suggestBlanksAI(templateFile: File, blankIds?: number[]): Promise<BlankSuggestion[]> {
  const fd = new FormData();
  fd.append("template", templateFile);
  if (blankIds && blankIds.length > 0) fd.append("_blank_ids", JSON.stringify(blankIds));
  const res = await fetch(`${BASE}/template/blanks/ai-suggest`, { method: "POST", headers: await authHeaders(), body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data as { error?: string }, res, "Sugestiile AI au eșuat"));
  return (data.suggestions ?? []) as BlankSuggestion[];
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
  if (generationClientId) fd.append("_client_id", generationClientId);

  const res = await fetch(`${BASE}/fill/pdf`, {
    method: "POST",
    headers: await authHeaders(),
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(apiErrorMessage(err, res, "Fill failed"));
  }
  notifyCredits(res.headers.get("X-Credits"));
  marcheazaPas("generare");
  return res.blob();
}

export interface TemplateFileMeta { placeholders: string[]; clauses: ClauseMeta[]; repeatGroups: string[] }

/** Înlocuiește fișierul unui șablon propriu, păstrându-i identitatea (vezi templates_api.py). `baseRevision` =
 * revizia văzută de utilizator: dacă un coleg l-a înlocuit între timp, eroarea are `code` = "revision_conflict". */
export async function replaceTemplateFile(templateId: string, file: File, baseRevision: number): Promise<TemplateFileMeta & { revision: number }> {
  const fd = new FormData();
  fd.append("template", file);
  fd.append("baseRevision", String(baseRevision));
  const res = await fetch(`${BASE}/templates/${encodeURIComponent(templateId)}/file`, { method: "POST", headers: await authHeaders(), body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(apiErrorMessage(data as { error?: string }, res, "Înlocuirea fișierului a eșuat")) as Error & { code?: string };
    err.code = (data as { error?: string }).error;
    throw err;
  }
  return data as TemplateFileMeta & { revision: number };
}

export interface NewTemplateFields { name: string; description: string; tipTemplate: string; outputNameTemplate: string }

/** Șablon .docx nou: fișierul se verifică și etichetele se calculează pe server (vezi templates_api.py). */
export async function createTemplate(file: File, fields: NewTemplateFields): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append("template", file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${BASE}/templates`, { method: "POST", headers: await authHeaders(), body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data as { error?: string }, res, "Salvarea șablonului a eșuat"));
  marcheazaPas("sablon");
  return data as { id: string };
}

/** Contextul câmpurilor manuale pentru un șablon încărcat înainte să existe (serverul îl și salvează în șablon). */
export const ensureTemplateContext = (templateId: string) =>
  apiJson<{ placeholderContext: Record<string, import('../types').ContextCamp> }>("POST", `/templates/${encodeURIComponent(templateId)}/context`)

/** „Duplică”: copia unui șablon de bază, făcută pe server din fișierul original. */
export const duplicateBuiltinTemplate = (key: string) =>
  apiJson<{ id: string }>("POST", "/templates/from-builtin", { key }).then(r => { marcheazaPas("sablon"); return r })

/** Problemele care blochează livrarea unui șablon (template_safety.inspect_content). */
export type DeliveryBlocker = "personal_data" | "comments" | "tracked_changes" | "custom_properties"
export interface DeliveryWarnings { noPlaceholders?: boolean; dedicatedFormUnasked?: string[] }
export interface DeliveryRequest {
  targetWorkspaceId: string
  sourceTemplateId: string
  confirmName: string
  sourceKey?: string | null
  dryRun?: boolean
  asNewCopy?: boolean
}

/** Super admin: trimite un șablon din cabinetul activ în alt cabinet. Eroarea `template_blocked` (422) are
 * `data.blocking` (DeliveryBlocker[]) — se citește din `err.data`. */
export function deliverTemplate({ targetWorkspaceId, ...body }: DeliveryRequest) {
  return apiJson<{ ok?: boolean; id?: string; warnings: DeliveryWarnings }>(
    "POST", `/admin/workspaces/${encodeURIComponent(targetWorkspaceId)}/templates`, { ...body, sourceKey: body.sourceKey || undefined })
}

export interface DeliveredTemplate { id: string; name: string; revision: number; deliveredAt: string | null }

export const listDeliveredTemplates = (workspaceId: string) =>
  apiJson<DeliveredTemplate[]>("GET", `/admin/workspaces/${encodeURIComponent(workspaceId)}/delivered-templates`)

export const revokeDeliveredTemplate = (workspaceId: string, templateId: string) =>
  apiJson<{ ok: boolean }>("DELETE", `/admin/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(templateId)}`)

export async function fetchBuiltinTemplates(): Promise<BuiltinTemplate[]> {
  const res = await fetch(`${BASE}/templates/builtin`, {
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(data, res, "Nu s-au putut încărca șabloanele de bază"));
  return data.templates as BuiltinTemplate[];
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
  // Documentul se creează în browser, deci creditul (la cabinetele pe credite) se cere înainte, pe server.
  const use = await apiJson<{ mode: string; balance?: number; coveredUntil?: string }>(
    "POST", "/billing/credits/consume", { clientId: generationClientId || null, template: outputName ?? "Google Doc" });
  if (use.mode !== "unlimited") {
    notifyCredits(JSON.stringify({ consumed: use.mode === "consumed", balance: use.balance ?? null, coveredUntil: use.coveredUntil ?? null }));
  }
  const upperFields: Record<string, string> = {};
  Object.entries(fields).forEach(([k, v]) => { upperFields[k.toUpperCase()] = v; });
  const out = await withDriveAccess(templateDocId, token, () => fillGoogleDoc(templateDocId, upperFields, outputName, token));
  void reportDocument({
    format: "gdoc", template: "drive", destination: "drive",
    fields: Object.values(upperFields).filter(Boolean).length,
    cnp: Object.entries(upperFields).some(([k, v]) => v && k.includes("CNP")),
  });
  marcheazaPas("generare");
  return { doc_id: out.docId, link: out.link };
}
