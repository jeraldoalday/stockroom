/**
 * Copy for a list that came back with no rows.
 *
 * "No customers yet." is only true for one of the three ways a list can be
 * empty. Shown after a search it claims the account has no customers at
 * all, which is alarming and wrong; shown on the Archived tab it says the
 * same thing about a tab that is *expected* to be empty most of the time.
 * Both leave the user unsure whether the filter worked or the data went
 * missing, and the fix in each case — clear the search, switch tabs — is
 * exactly what the message fails to hint at.
 */
export function emptyListMessage({
  noun,
  search = "",
  status = "active",
}: {
  /** Plural, lower case: "customers", "purchase orders". */
  noun: string;
  /** The search currently in effect, if any. */
  search?: string;
  status?: "active" | "archived" | "all";
}): string {
  const term = search.trim();
  if (term) {
    // The term is quoted back so a stray space or a typo is visible in the
    // message rather than only in the box the user has stopped looking at.
    return `No ${noun} match “${term}”.`;
  }
  if (status === "archived") {
    return `No archived ${noun}.`;
  }
  return `No ${noun} yet.`;
}
