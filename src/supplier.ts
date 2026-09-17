/**
 * The supplier directory: who you buy from, how to reach them, on what terms,
 * how long they take to deliver, and when you last checked the record was still
 * true. A spreadsheet of suppliers rots because nothing in it tells you it is
 * stale; every record here carries a `last_reviewed` date so staleness is a
 * question the directory can answer.
 *
 * Nothing in this module touches the network. Dates are plain YYYY-MM-DD
 * strings compared lexicographically, which is safe only because the format is
 * validated on the way in.
 */

export const MAX_SUPPLIERS = 5000;
export const MAX_LEAD_TIME_DAYS = 3650;

export interface Supplier {
  id: string;               // SUP-YYYY-NNNN
  name: string;
  category: string;         // free-form, e.g. "packaging" or "raw materials"
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  payment_terms: string | null;   // e.g. "Net 30"
  lead_time_days: number | null;  // integer days, 0..MAX_LEAD_TIME_DAYS
  notes: string | null;
  last_reviewed: string | null;   // YYYY-MM-DD; null = never reviewed
  created: string;
  updated: string;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The local calendar date, YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Whole days from `date` to `now`, both YYYY-MM-DD, computed in UTC so the
 * answer does not depend on the timezone the server happens to run in.
 */
export function daysSince(date: string, now: string): number {
  return Math.floor((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
}

/** The text fields a text search looks at, lowercased and joined. */
export function haystack(s: Supplier): string {
  return [s.name, s.category, s.contact_name, s.email, s.phone, s.website, s.address, s.payment_terms, s.notes]
    .filter((x): x is string => typeof x === "string")
    .join("\n")
    .toLowerCase();
}

/** One CSV cell: quoted when it holds a comma, quote or newline, quotes doubled. */
export function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const t = String(v);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/** One Markdown table cell: pipes escaped, newlines flattened to spaces. */
export function mdCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim();
}

export const EXPORT_COLUMNS: { key: keyof Supplier; header: string }[] = [
  { key: "id", header: "id" },
  { key: "name", header: "name" },
  { key: "category", header: "category" },
  { key: "contact_name", header: "contact_name" },
  { key: "email", header: "email" },
  { key: "phone", header: "phone" },
  { key: "website", header: "website" },
  { key: "address", header: "address" },
  { key: "payment_terms", header: "payment_terms" },
  { key: "lead_time_days", header: "lead_time_days" },
  { key: "notes", header: "notes" },
  { key: "last_reviewed", header: "last_reviewed" },
];
