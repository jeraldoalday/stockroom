import { describe, expect, it } from "vitest";
import { emptyListMessage } from "./emptyListMessage";

describe("emptyListMessage", () => {
  it("says the list is empty when nothing is filtering it", () => {
    expect(emptyListMessage({ noun: "customers" })).toBe("No customers yet.");
  });

  it("blames the search when there is one", () => {
    expect(emptyListMessage({ noun: "customers", search: "Acme" })).toBe(
      "No customers match “Acme”."
    );
  });

  it("quotes the term back so a typo is visible in the message", () => {
    expect(emptyListMessage({ noun: "products", search: "widgit" })).toBe(
      "No products match “widgit”."
    );
  });

  it("ignores a search of nothing but whitespace", () => {
    // The box holds " " after a stray space; the API trims it away and
    // returns the full list, so the message must not claim a search ran.
    expect(emptyListMessage({ noun: "suppliers", search: "   " })).toBe("No suppliers yet.");
  });

  it("trims the term it quotes", () => {
    expect(emptyListMessage({ noun: "suppliers", search: " Acme " })).toBe(
      "No suppliers match “Acme”."
    );
  });

  it("names the archived tab, which is empty by design most of the time", () => {
    expect(emptyListMessage({ noun: "customers", status: "archived" })).toBe(
      "No archived customers."
    );
  });

  it("treats the All tab like the default", () => {
    expect(emptyListMessage({ noun: "customers", status: "all" })).toBe("No customers yet.");
  });

  it("prefers the search over the tab when both are in effect", () => {
    // "No archived customers." would be misleading here: there may well be
    // some, just none matching.
    expect(emptyListMessage({ noun: "customers", search: "Acme", status: "archived" })).toBe(
      "No customers match “Acme”."
    );
  });

  it("handles a multi-word noun", () => {
    expect(emptyListMessage({ noun: "purchase orders" })).toBe("No purchase orders yet.");
  });
});
