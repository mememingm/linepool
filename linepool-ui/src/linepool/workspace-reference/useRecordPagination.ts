import { useEffect, useRef, useState } from 'react';
import type { PaginatedResponse } from '../api/contracts';
import { apiMessage } from './workspace-data';

export type RecordPageSize = 5 | 10 | 20;
type PageLoader<T> = (page: number, pageSize: number, signal: AbortSignal) => Promise<PaginatedResponse<T>>;
type PaginationPresentation = { keepPreviousItems?: boolean; scrollToTopOnPagination?: boolean };

export function useRecordPagination<T>(loadPage: PageLoader<T>, filterKey: string, refreshSource: unknown, clientItems?: T[], { keepPreviousItems = false, scrollToTopOnPagination = true }: PaginationPresentation = {}) {
  const [selection, setSelection] = useState({ filterKey, page: 1 });
  const [pageSize, updatePageSize] = useState<RecordPageSize>(5);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; filterKey: string; source: unknown; value: PaginatedResponse<T> } | null>(null);
  const [failure, setFailure] = useState<{ key: string; source: unknown; message: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const clientMode = clientItems !== undefined;
  const clientPages = Math.ceil((clientItems?.length ?? 0) / pageSize);
  const selectedPage = selection.filterKey === filterKey ? selection.page : 1;
  const page = clientMode ? Math.min(selectedPage, Math.max(1, clientPages)) : selectedPage;

  // Reset before committing a changed filter, including when returning to an earlier filter.
  if (selection.filterKey !== filterKey || selection.page !== page) setSelection({ filterKey, page });
  const requestKey = JSON.stringify([filterKey, page, pageSize, revision, clientMode]);
  const current = result?.key === requestKey && result.source === refreshSource ? result.value : null;
  const error = failure?.key === requestKey && failure.source === refreshSource ? failure.message : '';
  const totalItems = clientMode ? clientItems.length : result?.filterKey === filterKey ? result.value.pagination.totalItems : 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  const busy = !clientMode && !current && !error;
  const displayed = current ?? (keepPreviousItems && result?.filterKey === filterKey && result.source === refreshSource ? result.value : null);
  const items = clientMode ? clientItems.slice((page - 1) * pageSize, page * pageSize) : displayed?.data ?? [];
  const scrollKey = JSON.stringify([filterKey, scrollToTopOnPagination ? page : null, scrollToTopOnPagination ? pageSize : null]);

  useEffect(() => {
    if (clientMode) return;
    const controller = new AbortController();
    void loadPage(page, pageSize, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, value.pagination.totalPages);
      if (page > lastPage) {
        setSelection({ filterKey, page: lastPage });
        return;
      }
      setResult({ key: requestKey, filterKey, source: refreshSource, value });
    }).catch(cause => {
      if (!controller.signal.aborted) setFailure({ key: requestKey, source: refreshSource, message: apiMessage(cause) });
    });
    return () => controller.abort();
  }, [loadPage, requestKey, refreshSource, clientMode, page, pageSize, filterKey]);

  useEffect(() => {
    listRef.current?.closest('.lp-shell-view')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [scrollKey]);

  function setPage(next: number) {
    if (Number.isInteger(next) && next >= 1 && next <= Math.max(1, totalPages)) setSelection({ filterKey, page: next });
  }
  function setPageSize(next: RecordPageSize) {
    updatePageSize(next);
    setSelection({ filterKey, page: 1 });
  }
  return { listRef, items, page, pageSize, totalItems, totalPages, busy, error, setPage, setPageSize, retry: () => setRevision(value => value + 1) };
}
