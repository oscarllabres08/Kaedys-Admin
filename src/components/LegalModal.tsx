import { useEffect, useState, type ReactNode } from 'react';

const EXIT_MS = 280;

export type LegalModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

export function LegalModal({ open, onClose, title, description, children }: LegalModalProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    if (open) {
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
  }, [open, mounted]);

  useEffect(() => {
    if (open || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center px-4 transition-opacity duration-300 ease-out ${
        visible ? 'bg-black/75 opacity-100 backdrop-blur-sm' : 'pointer-events-none bg-black/0 opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-2xl transition-all duration-300 ease-[cubic-bezier(0.34,1.2,0.64,1)] will-change-transform ${
          visible
            ? 'translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none translate-y-3 scale-[0.96] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-hidden rounded-2xl border border-yellow-500/35 bg-neutral-950 shadow-2xl">
          <div className="p-5 md:p-6">
            <h3 id="legal-modal-title" className="text-xl font-bold text-yellow-300">
              {title}
            </h3>
            {description ? <div className="mt-1">{description}</div> : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
