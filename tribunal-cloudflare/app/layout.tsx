import { REVIEW_STYLES } from '@variance-authority/tribunal/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Variance Authority — review',
  description: 'Review the visual changes this project recorded, and decide them.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <style>{REVIEW_STYLES}</style>
        {children}
      </body>
    </html>
  );
}
