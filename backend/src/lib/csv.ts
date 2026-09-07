// Minimal RFC 4180-ish CSV parser: handles quoted fields, embedded commas,
// embedded newlines, and "" as an escaped quote. Good enough for the kind
// of product spreadsheets a small shop exports from Excel/Sheets — no
// external dependency needed for that.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// Parses a CSV with a header row into an array of header->value records.
// Extra columns are ignored; missing columns come back as "".
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = (row[index] ?? "").trim();
    });
    return record;
  });
}

// Quotes a field only when it needs it (RFC 4180: contains a comma, a
// quote, or a newline), escaping an embedded quote as "". Everything else
// -- the common case for the numbers and short names this app writes --
// passes through unquoted rather than wrapping every field defensively.
function formatCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Writes rows (each including its own header as the first row) into a CSV
 * string. The counterpart to `parseCsvRecords` above, for the one export
 * that isn't a good fit for the Python service's pandas-based ones: see
 * `stocktakes.routes.ts`'s `/:id/export`.
 */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(formatCsvField).join(",")).join("\r\n") + "\r\n";
}

// CSV injection (CWE-1236): Excel/Sheets treats a cell starting with `=`,
// `+`, `-`, `@`, or a tab/CR as a formula, regardless of this API's own
// `text/csv` content type. The export this feeds writes free-text fields a
// Staff member controls (a product's SKU/name, the counter's own display
// name) next to computed numbers reformatted as strings (Expected/Counted/
// Variance, which legitimately start with `-`) — so unlike `formatCsvField`
// above, this isn't applied to every cell, only called out at the call
// site's free-text columns, to avoid mangling a negative variance into text
// that reads `'-3` instead of `-3`.
export function sanitizeCsvText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
