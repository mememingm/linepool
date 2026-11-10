import type { ReactNode } from 'react';
import './PageContainer.css';

type PageContainerProps = {
  title: string;
  titleId?: string;
  notice?: ReactNode;
  children: ReactNode;
};

export default function PageContainer({ title, titleId = 'lp-shell-view-title', notice, children }: PageContainerProps) {
  return <div className="lp-page-container">
    <h1 id={titleId} className="lp-page-title-accessible">{title}</h1>
    {notice && <div className="lp-page-notice">{notice}</div>}
    {children}
  </div>;
}
