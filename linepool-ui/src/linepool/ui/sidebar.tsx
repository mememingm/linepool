// Adapted from shadcn/ui Sidebar (MIT). Only the primitives used by LINEPOOL are included.
// https://ui.shadcn.com/docs/components/sidebar
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Dialog as Sheet, Slot } from 'radix-ui';
import { PanelLeft, X } from 'lucide-react';
import { Button } from './button';
import { cn } from './utils';

const SidebarContext = createContext({ open: true, openMobile: false, isMobile: false, toggleSidebar: () => {}, setOpenMobile: (_open: boolean) => {} });
export const useSidebar = () => useContext(SidebarContext);

export function SidebarProvider({ children, className, ...props }: ComponentProps<'div'>) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('linepool-admin-sidebar') !== 'collapsed'; } catch { return true; } });
  const [openMobile, setOpenMobile] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => { setIsMobile(query.matches); setOpenMobile(false); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  function toggleSidebar() {
    if (isMobile) setOpenMobile(value => !value);
    else setOpen(value => { const next = !value; try { localStorage.setItem('linepool-admin-sidebar', next ? 'expanded' : 'collapsed'); } catch { /* Storage is optional. */ } return next; });
  }
  return <SidebarContext.Provider value={{ open, openMobile, isMobile, toggleSidebar, setOpenMobile }}>
    <div data-slot="sidebar-wrapper" data-state={open ? 'expanded' : 'collapsed'} className={cn('group/sidebar-wrapper', className)} {...props}>{children}</div>
  </SidebarContext.Provider>;
}
export function Sidebar({ children, className, theme }: { children: ReactNode; className?: string; theme: string }) {
  const { isMobile, openMobile, setOpenMobile, open } = useSidebar();
  if (isMobile) return <Sheet.Root open={openMobile} onOpenChange={setOpenMobile}><Sheet.Portal>
    <Sheet.Overlay className="lp-admin-overlay" />
    <Sheet.Content className={cn('lp-admin-sidebar-panel', className)} data-theme={theme} data-mobile="true" aria-describedby={undefined}>
      <Sheet.Title className="sr-only">后台导航</Sheet.Title>
      <Sheet.Close asChild><Button className="lp-admin-sidebar-close" variant="ghost" size="icon" aria-label="关闭后台导航"><X size={18} /></Button></Sheet.Close>
      {children}
    </Sheet.Content>
  </Sheet.Portal></Sheet.Root>;
  return <aside data-slot="sidebar" data-theme={theme} data-state={open ? 'expanded' : 'collapsed'} data-collapsible={open ? '' : 'icon'} className={className}>{children}</aside>;
}
export function SidebarTrigger({ onClick, ...props }: ComponentProps<typeof Button>) {
  const { toggleSidebar, isMobile, open, openMobile } = useSidebar();
  return <Button variant="ghost" size="icon" {...props} aria-expanded={isMobile ? openMobile : open} onClick={event => { onClick?.(event); toggleSidebar(); }}><PanelLeft size={18} /><span className="sr-only">切换侧栏</span></Button>;
}
export function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) { return <ul data-slot="sidebar-menu" className={cn('flex min-w-0 flex-col gap-1', className)} {...props} />; }
export function SidebarMenuItem(props: ComponentProps<'li'>) { return <li data-slot="sidebar-menu-item" {...props} />; }
export function SidebarMenuButton({ asChild, isActive, ...props }: ComponentProps<'button'> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="sidebar-menu-button" data-active={isActive} {...props} />;
}
