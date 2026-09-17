"use client";

export function Pagination({ label, page, pages, onChange, disabled = false }: {
  label: string;
  page: number;
  pages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  if (pages <= 1) return null;
  return <nav className="pagination" aria-label={`${label} pages`}>
    <button type="button" aria-label={`Previous ${label} page`} disabled={disabled || page === 0} onClick={() => onChange(page - 1)}>‹</button>
    <span>{page + 1} / {pages}</span>
    <button type="button" aria-label={`Next ${label} page`} disabled={disabled || page >= pages - 1} onClick={() => onChange(page + 1)}>›</button>
  </nav>;
}

export function pageIndex(requested: number, count: number, size: number) {
  return Math.min(requested, Math.max(0, Math.ceil(count / size) - 1));
}
