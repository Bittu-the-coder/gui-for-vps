import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge resolves conflicting classes (the last one wins). It must know our custom type scale
// (`text-body`, `text-footnote`...): otherwise it takes them for text COLOURS and silently deletes a real
// colour class such as `text-primary-foreground` that sits next to them.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['caption', 'footnote', 'body', 'callout', 'title', 'large'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
