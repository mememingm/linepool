import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ActionButton } from '../components';
import SelectField from '../SelectField';
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
  return <nav className="lp-shell-record-pagination" aria-label={p.t('列表分页')}>
    <span className="lp-shell-record-total">{p.t('共 {count} 条记录', { count: p.n(totalItems) })}</span>
    <label><span>{p.t('每页')}</span><SelectField aria-label={p.t('每页显示条数')} aria-details={controls} value={String(pageSize)} disabled={busy} onValueChange={value => {
      const size = Number(value);
      if (size === 5 || size === 10 || size === 20) onPageSizeChange(size);
    }} options={([5, 10, 20] as const).map(size => ({ value: String(size), label: p.n(size) }))} /></label>
    <span className="lp-shell-record-page" aria-live="polite" aria-atomic="true">{p.t('第 {page} / {pages} 页', { page: p.n(totalPages ? page : 0), pages: p.n(totalPages) })}</span>
    <div className="lp-shell-record-page-actions">
      <ActionButton size="sm" title={p.t('上一页')} aria-label={p.t('上一页')} aria-controls={controls} disabled={busy || page <= 1 || !totalPages} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></ActionButton>
      <ActionButton size="sm" title={p.t('下一页')} aria-label={p.t('下一页')} aria-controls={controls} disabled={busy || page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight size={16} aria-hidden="true" /></ActionButton>
    </div>
  </nav>;
}
