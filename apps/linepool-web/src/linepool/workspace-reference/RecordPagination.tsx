import { useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ActionButton } from '../components';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import type { RecordPageSize } from './useRecordPagination';
import './RecordPagination.css';

type RecordPaginationProps = {
  page: number;
  pageSize: RecordPageSize;
  totalPages: number;
  totalItems: number;
  busy: boolean;
  controls: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: RecordPageSize) => void;
};

export default function RecordPagination({ page, pageSize, totalPages, totalItems, busy, controls, onPageChange, onPageSizeChange }: RecordPaginationProps) {
  const p = useDisplayPreferences();
  const pageSizeId = useId();
  if (!totalItems && !busy) return null;
  return <nav className="lp-shell-record-pagination" aria-label={p.t('列表分页')}>
    <span className="lp-shell-record-total">{p.t('共 {count} 条记录', { count: p.n(totalItems) })}</span>
    <div className="lp-shell-record-page-size">
      <label htmlFor={pageSizeId}>{p.t('每页')}</label>
      <Select value={String(pageSize)} onValueChange={value => {
        const size = Number(value);
        if (size === 5 || size === 10 || size === 20) onPageSizeChange(size);
      }}>
        <SelectTrigger id={pageSizeId} size="sm" className="w-[76px] border-line bg-surface text-ink" aria-label={p.t('每页显示条数')} aria-details={controls}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent side="top" className="lp-shell-record-page-size-menu border-line bg-surface text-ink" data-theme={p.theme} lang={p.locale} aria-label={p.t('每页显示条数')}>
          {([5, 10, 20] as const).map(size => <SelectItem key={size} value={String(size)} className="focus:bg-hover focus:text-ink">{p.n(size)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <span className="lp-shell-record-page" aria-live="polite" aria-atomic="true">{p.t('第 {page} / {pages} 页', { page: p.n(totalPages ? page : 0), pages: p.n(totalPages) })}</span>
    <div className="lp-shell-record-page-actions">
      <ActionButton size="sm" title={p.t('上一页')} aria-label={p.t('上一页')} aria-controls={controls} disabled={busy || page <= 1 || !totalPages} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></ActionButton>
      <ActionButton size="sm" title={p.t('下一页')} aria-label={p.t('下一页')} aria-controls={controls} disabled={busy || page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight size={16} aria-hidden="true" /></ActionButton>
    </div>
  </nav>;
}
