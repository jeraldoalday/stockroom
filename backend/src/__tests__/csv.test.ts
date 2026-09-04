import { parseCsvRecords, toCsv } from "../lib/csv";

describe("toCsv", () => {
  it("joins rows and columns with commas and CRLF, RFC 4180 style", () => {
    expect(toCsv([["a", "b"], ["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });

  it("leaves plain fields unquoted", () => {
    expect(toCsv([["SKU-1", "Apple Sauce", "10"]])).toBe("SKU-1,Apple Sauce,10\r\n");
  });

  it("quotes a field containing a comma", () => {
    expect(toCsv([["Widgets, Large"]])).toBe('"Widgets, Large"\r\n');
  });

  it("quotes a field containing a quote, doubling it", () => {
    expect(toCsv([['12" pipe']])).toBe('"12"" pipe"\r\n');
  });

  it("quotes a field containing a newline", () => {
    expect(toCsv([["line one\nline two"]])).toBe('"line one\nline two"\r\n');
  });

  it("round-trips through the existing CSV parser", () => {
    const csv = toCsv([
      ["SKU", "Name"],
      ["SKU-1", "Widgets, Large"],
      ["SKU-2", '12" pipe'],
    ]);
    expect(parseCsvRecords(csv)).toEqual([
      { SKU: "SKU-1", Name: "Widgets, Large" },
      { SKU: "SKU-2", Name: '12" pipe' },
    ]);
  });
});
