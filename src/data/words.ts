import type { Word } from './types';
import raw from './words.json';

export const words = raw as Word[];
export const wordCount = words.length;
export const categories = ['全部', ...Array.from(new Set(words.map((w) => w.category))).sort()];
export const verifiedCount = words.filter((w) => w.status === '已核实').length;
