import type { CSSProperties, ReactNode } from 'react';

export function SidePanel({ children, structural }: {
  readonly children: ReactNode;
  readonly structural: boolean;
}) {
  const style: CSSProperties = {
    background: '#f6f8fa',
    display: 'grid',
    gap: '16px',
    padding: '16px',
  };

  return structural
    ? <nav aria-label="Sidebar" className="workspace-sidebar" style={style}>{children}</nav>
    : <aside aria-label="Sidebar" className="workspace-sidebar" style={style}>{children}</aside>;
}
