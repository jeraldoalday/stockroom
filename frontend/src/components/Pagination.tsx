interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Plural noun for the range summary, e.g. "movements". */
  label?: string;
}

/**
 * Page controls for the list endpoints, which all return the same
 * `{ items, total, page, pageSize }` envelope.
 *
 * Renders nothing when everything fits on one page — an inventory with four
 * products shouldn't grow a "Page 1 of 1" control — but always shows the
 * range summary when it does paginate, because "1-25 of 312" is the part
 * that tells the user there is more to see at all.
 */
export function Pagination({ page, pageSize, total, onPageChange, label = "results" }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <div className="text-gray-500">
        {first}–{last} of {total} {label}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Previous
        </button>
        <span className="text-gray-500">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Next
        </button>
      </div>
    </div>
  );
}
