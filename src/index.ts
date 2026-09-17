#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLicenseGate, withFileLock } from "@theluckystrike/mcp-license";
import { z } from "zod";
import { VERSION } from "./version.js";
import {
  EXPORT_COLUMNS, MAX_LEAD_TIME_DAYS, csvCell, daysSince, haystack, isIsoDate, mdCell, today,
  type Supplier,
} from "./supplier.js";
import { dataDir, findSupplier, getSuppliers, lockPath, nextId, resolveSupplier, setSuppliers } from "./store.js";

/**
 * Free tier: TEN suppliers, CSV export. A directory of ten is a real working
 * list for a freelancer -- the handful of suppliers you actually buy from --
 * and reading, updating, searching and CSV-exporting the list you have is
 * never metered: a free tier that withholds the directory is a demo. What Pro
 * lifts is how many suppliers the directory holds, Markdown export, and the
 * due-review report.
 */
const FREE_SUPPLIERS = 10;
const MAX_NAME = 200;
const MAX_TEXT = 2000;
const DEFAULT_REVIEW_DAYS = 90;

const gate = createLicenseGate({ product: "supplier-list" });

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true as const });
const json = (v: unknown) => ok(JSON.stringify(v, null, 2));

const str = (field: string, max: number) => z.string().max(max, `${field} must be ${max} characters or fewer`);

/** Only this server's own store is written, so there is one lock and it is this one. */
function locked<T>(fn: () => T | Promise<T>): Promise<T> {
  return withFileLock(lockPath(), fn, { timeoutMs: 20000 });
}

function checkDate(value: string, field: string): string {
  if (!isIsoDate(value)) throw new Error(`cannot read a date: ${field} "${value}" is not a real date in YYYY-MM-DD form. Nothing was written.`);
  return value;
}

function checkEmail(value: string): string {
  const v = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error(`"${value}" does not look like an email address. Nothing was written.`);
  return v;
}

/* ------------------------------------------------------------- view helpers */

function supplierSummary(s: Supplier) {
  return {
    id: s.id, name: s.name, category: s.category,
    contact_name: s.contact_name, email: s.email, phone: s.phone,
    payment_terms: s.payment_terms, lead_time_days: s.lead_time_days,
    last_reviewed: s.last_reviewed,
    days_since_review: s.last_reviewed ? daysSince(s.last_reviewed, today()) : null,
    updated: s.updated,
  };
}

function supplierDetail(s: Supplier) {
  return {
    ...supplierSummary(s),
    website: s.website, address: s.address, notes: s.notes, created: s.created,
  };
}

function freeTierNote(): string | null {
  if (gate.isPro()) return null;
  return `Free tier: ${getSuppliers().length} of ${FREE_SUPPLIERS} suppliers.`;
}

/** Filter by category (exact, case-insensitive) and free text across every field. */
function filterList(list: Supplier[], category?: string, q?: string): Supplier[] {
  let out = list;
  if (category) {
    const want = category.trim().toLowerCase();
    out = out.filter((s) => s.category.toLowerCase() === want);
  }
  if (q) {
    const needle = q.trim().toLowerCase();
    out = out.filter((s) => haystack(s).includes(needle));
  }
  return out;
}

/** A directory is read by name, so it is sorted by name, not by when rows landed. */
function byName(a: Supplier, b: Supplier): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id);
}

/* ------------------------------------------------------------------- server */

const server = new McpServer(
  { name: "mcp-supplier-list", version: VERSION },
  { capabilities: { tools: {} } },
);

const supplierArg = str("supplier", MAX_NAME).describe("The supplier id, e.g. SUP-2026-0003, or the name when only one supplier has it");

/** The writable fields shared by supplier_add and supplier_update, all optional:
 *  supplier_add overrides category back to required. */
const editableFields = {
  category: str("category", MAX_NAME).optional().describe("What they supply, e.g. Packaging, Raw materials, Print. Free-form; supplier_list filters on it"),
  contact_name: str("contact_name", MAX_NAME).optional().describe("Your person there, e.g. Maria Chen"),
  email: str("email", MAX_NAME).optional().describe("Orders or accounts email"),
  phone: str("phone", 60).optional().describe("Phone number as you would dial it"),
  website: str("website", 400).optional().describe("Website or storefront URL"),
  address: str("address", 400).optional().describe("Postal or visiting address"),
  payment_terms: str("payment_terms", MAX_NAME).optional().describe("The terms you buy on, e.g. Net 30, 50% upfront, Due on receipt"),
  lead_time_days: z.number().int().min(0).max(MAX_LEAD_TIME_DAYS).optional().describe("Typical days from order to delivery, e.g. 14"),
  notes: str("notes", MAX_TEXT).optional().describe("Anything worth remembering: minimum orders, who to escalate to, why you dropped them last time"),
};

server.registerTool("supplier_add", {
  title: "Add a supplier",
  description: "Add a supplier to the directory and return its SUP-YYYY-NNNN number: the name, what they supply, who to contact and how, the payment terms, the lead time in days, and notes. Free tier: 10 suppliers; removing one you no longer use frees its slot.",
  inputSchema: {
    name: str("name", MAX_NAME).describe("Who you buy from, e.g. Shenzhen Box Co, or Acme Fasteners"),
    ...editableFields,
    category: str("category", MAX_NAME).describe("What they supply, e.g. Packaging, Raw materials, Print. Free-form; supplier_list filters on it"),
  },
}, async (a) => {
  try {
    const email = a.email ? checkEmail(a.email) : null;
    const rec = await locked(() => {
      const list = getSuppliers();
      if (!gate.isPro() && list.length >= FREE_SUPPLIERS) {
        throw new Error(
          `the free tier holds ${FREE_SUPPLIERS} suppliers and there are already ${list.length} (${list.map((s) => `${s.id} ${s.name}`).join(", ")}). ` +
          `Removing one you no longer use frees its slot, and everything on the suppliers you have stays free. Nothing was written. ` +
          gate.upgradeText("unlimited suppliers", "supplier_add"),
        );
      }
      const dup = list.find((s) => s.name.toLowerCase() === a.name.trim().toLowerCase());
      if (dup) throw new Error(`${dup.id} (${dup.name}) is already in the directory. supplier_update changes a record; adding it twice makes two records of one supplier. Nothing was written.`);
      const now = new Date().toISOString();
      const s: Supplier = {
        id: nextId(now.slice(0, 4), list.map((x) => x.id)),
        name: a.name.trim(), category: a.category.trim(),
        contact_name: a.contact_name?.trim() ?? null, email, phone: a.phone?.trim() ?? null,
        website: a.website?.trim() ?? null, address: a.address?.trim() ?? null,
        payment_terms: a.payment_terms?.trim() ?? null, lead_time_days: a.lead_time_days ?? null,
        notes: a.notes ?? null, last_reviewed: null, created: now, updated: now,
      };
      list.push(s);
      setSuppliers(list);
      return s;
    });
    const notes: string[] = [];
    const free = freeTierNote();
    if (free) notes.push(free);
    notes.push("last_reviewed is empty: the record is new, so it is due for review straight away. supplier_mark_reviewed stamps it once you have checked it against reality.");
    return json({
      created: supplierDetail(rec),
      next: "Find it again with supplier_list or supplier_get, change it with supplier_update, and stamp supplier_mark_reviewed when you have checked the record is still true. supplier_due_review lists everything that has gone stale.",
      notes,
    });
  } catch (e) { return fail((e as Error).message); }
});

server.registerTool("supplier_list", {
  title: "List suppliers",
  description: "List the supplier directory A to Z by name: contact, payment terms, lead time, when each record was last reviewed and how many days ago that was. Filter by category and by free text across every field. Reads only.",
  inputSchema: {
    category: str("category", MAX_NAME).optional().describe("Only suppliers in exactly this category, case-insensitive"),
    q: str("q", MAX_NAME).optional().describe("Only suppliers whose name, category, contact, terms or notes contain this text, case-insensitive"),
  },
}, async (a) => {
  try {
    const all = getSuppliers();
    const list = filterList(all, a.category, a.q).sort(byName);
    const categories = [...new Set(all.map((s) => s.category))].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
    const notes: string[] = [];
    const free = freeTierNote();
    if (free) notes.push(free);
    return json({
      count: list.length,
      total: all.length,
      categories,
      suppliers: list.map(supplierSummary),
      notes,
    });
  } catch (e) { return fail((e as Error).message); }
});

server.registerTool("supplier_get", {
  title: "Read one supplier",
  description: "Read one supplier record in full by SUP number or name: every contact field, the payment terms, the lead time, the notes, and when the record was last reviewed. Reads only.",
  inputSchema: {
    supplier: supplierArg,
  },
}, async (a) => {
  try {
    const list = getSuppliers();
    const s = findSupplier(list, a.supplier);
    if (!s) throw new Error(`no supplier matches "${a.supplier}". Known: ${list.map((x) => `${x.id} (${x.name})`).join(", ") || "none"}.`);
    return json(supplierDetail(s));
  } catch (e) { return fail((e as Error).message); }
});

server.registerTool("supplier_update", {
  title: "Change a supplier record",
  description: "Change any of a supplier's fields by SUP number or name: name, category, the contact fields, payment terms, lead time, notes. Only the fields you pass change; pass at least one. The SUP number and the review stamp are not writable here -- supplier_mark_reviewed does the stamp.",
  inputSchema: {
    supplier: supplierArg,
    name: str("name", MAX_NAME).optional().describe("Rename the supplier"),
    ...editableFields,
  },
}, async (a) => {
  try {
    const fields = ["name", "category", "contact_name", "email", "phone", "website", "address", "payment_terms", "lead_time_days", "notes"] as const;
    const passed = fields.filter((f) => a[f] !== undefined);
    if (!passed.length) throw new Error("nothing to change: pass at least one field alongside supplier. Nothing was written.");
    const email = a.email !== undefined ? checkEmail(a.email) : undefined;
    const out = await locked(() => {
      const list = getSuppliers();
      const s = resolveSupplier(list, a.supplier);
      if (a.name !== undefined) {
        const dup = list.find((x) => x.id !== s.id && x.name.toLowerCase() === a.name!.trim().toLowerCase());
        if (dup) throw new Error(`${dup.id} (${dup.name}) already holds that name. Two records of one name cannot be told apart. Nothing was written.`);
        s.name = a.name.trim();
      }
      if (a.category !== undefined) s.category = a.category.trim();
      if (a.contact_name !== undefined) s.contact_name = a.contact_name.trim();
      if (email !== undefined) s.email = email;
      if (a.phone !== undefined) s.phone = a.phone.trim();
      if (a.website !== undefined) s.website = a.website.trim();
      if (a.address !== undefined) s.address = a.address.trim();
      if (a.payment_terms !== undefined) s.payment_terms = a.payment_terms.trim();
      if (a.lead_time_days !== undefined) s.lead_time_days = a.lead_time_days;
      if (a.notes !== undefined) s.notes = a.notes;
      s.updated = new Date().toISOString();
      setSuppliers(list);
      return { s, passed };
    });
    return json({
      updated: supplierDetail(out.s),
      changed: out.passed,
      note: "A change you just verified against reality is a review: supplier_mark_reviewed stamps it so supplier_due_review stops flagging this record.",
    });
  } catch (e) { return fail((e as Error).message); }
});

server.registerTool("supplier_remove", {
  title: "Remove a supplier",
  description: "Remove a supplier from the directory by SUP number or name, returning the record as it stood so nothing is lost silently. The SUP number is never reissued. On the free tier the slot is freed for another supplier.",
  inputSchema: {
    supplier: supplierArg,
  },
}, async (a) => {
  try {
    const out = await locked(() => {
      const list = getSuppliers();
      const s = resolveSupplier(list, a.supplier);
      setSuppliers(list.filter((x) => x.id !== s.id));
      return s;
    });
    const notes: string[] = [];
    const free = freeTierNote();
    if (free) notes.push(free);
    return json({
      removed: supplierDetail(out),
      note: "The number is not reissued. The SUP series only ever goes up, so a gap in it is the record that a supplier was removed.",
      notes,
    });
  } catch (e) { return fail((e as Error).message); }
});

server.registerTool("supplier_mark_reviewed", {
  title: "Stamp a supplier as reviewed",
  description: "Stamp a supplier's record as reviewed on a date, today by default: you have checked the contact, the terms and the lead time are still true. This is the stamp supplier_due_review reads, so a reviewed record stops being flagged as stale.",
  inputSchema: {
    supplier: supplierArg,
    date: str("date", 10).optional().describe("The date you reviewed the record, YYYY-MM-DD. Default today"),
  },
}, async (a) => {
  try {
    const date = a.date ? checkDate(a.date, "date") : today();
    const now = today();
    if (date > now) throw new Error(`the review is dated ${date}, which is after today (${now}). You cannot have reviewed it yet. Nothing was written.`);
    const out = await locked(() => {
      const list = getSuppliers();
      const s = resolveSupplier(list, a.supplier);
      s.last_reviewed = date;
      s.updated = new Date().toISOString();
      setSuppliers(list);
      return s;
    });
    return json({ reviewed: supplierDetail(out) });
  } catch (e) { return fail((e as Error).message); }
});

server.registerTool("supplier_due_review", {
  title: "Which supplier records have gone stale",
  description: "The due-review report: every supplier whose record has not been reviewed in the last N days -- 90 unless you say otherwise -- most overdue first. A record never reviewed is always due, whatever its age. This is the report that keeps the directory from rotting. Pro feature.",
  inputSchema: {
    days: z.number().int().min(1).max(3650).optional().describe(`A record is due when its last review is older than this many days. Default ${DEFAULT_REVIEW_DAYS}`),
  },
}, async (a) => {
  try {
    if (!gate.isPro()) throw new Error(gate.upgradeText("due-review reports", "supplier_due_review"));
    const window = a.days ?? DEFAULT_REVIEW_DAYS;
    const now = today();
    const all = getSuppliers();
    const due = all
      .map((s) => ({
        ...supplierSummary(s),
        // A never-reviewed record ages from the day it was added, for ordering.
        age_days: daysSince(s.last_reviewed ?? s.created.slice(0, 10), now),
        never_reviewed: s.last_reviewed === null,
      }))
      // Never reviewed is always due: the record has never been checked against
      // reality at all, whatever its age.
      .filter((s) => s.never_reviewed || s.age_days >= window)
      .sort((x, y) => y.age_days - x.age_days || x.name.toLowerCase().localeCompare(y.name.toLowerCase()) || x.id.localeCompare(y.id));
    return json({
      window_days: window,
      rule: "A record never reviewed is always due. A reviewed record is due once its last review is at least window_days old.",
      due_count: due.length,
      fresh_count: all.length - due.length,
      due,
      next: "Work the list top down: check the record against reality, fix what moved with supplier_update, then stamp supplier_mark_reviewed.",
    });
  } catch (e) { return fail((e as Error).message); }
});

server.registerTool("supplier_export", {
  title: "Export the directory",
  description: "Export the supplier directory as CSV or a Markdown table: every field, one row per supplier, A to Z by name. CSV opens in any spreadsheet; Markdown drops into a doc, a wiki or a README. Filter by category and free text first if you only want part of it. CSV is free; Markdown is Pro.",
  inputSchema: {
    format: z.enum(["csv", "markdown"]).optional().describe("csv (default) or markdown"),
    category: str("category", MAX_NAME).optional().describe("Only suppliers in exactly this category, case-insensitive"),
    q: str("q", MAX_NAME).optional().describe("Only suppliers whose fields contain this text, case-insensitive"),
  },
}, async (a) => {
  try {
    const format = a.format ?? "csv";
    if (format === "markdown" && !gate.isPro()) throw new Error(gate.upgradeText("Markdown export", "supplier_export"));
    const list = filterList(getSuppliers(), a.category, a.q).sort(byName);
    const headers = EXPORT_COLUMNS.map((c) => c.header);
    if (format === "csv") {
      const lines = [headers.map(csvCell).join(",")];
      for (const s of list) lines.push(EXPORT_COLUMNS.map((c) => csvCell(s[c.key])).join(","));
      return ok(lines.join("\n") + "\n");
    }
    const lines = [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
    ];
    for (const s of list) lines.push(`| ${EXPORT_COLUMNS.map((c) => mdCell(s[c.key])).join(" | ")} |`);
    return ok(lines.join("\n") + "\n");
  } catch (e) { return fail((e as Error).message); }
});

gate.registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`mcp-supplier-list ${VERSION} ready; store at ${dataDir()}\n`);
