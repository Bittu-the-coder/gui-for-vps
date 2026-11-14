import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const field =
  'w-full rounded-control border border-input bg-background px-2.5 py-1 text-body text-foreground shadow-[inset_0_1px_1px_rgb(0_0_0/0.05)] placeholder:text-faint-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, 'h-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(field, 'min-h-20 py-2 font-mono text-footnote', className)}
      {...props}
    />
  );
}
