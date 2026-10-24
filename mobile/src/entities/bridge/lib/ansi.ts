// ==========================================
// High-speed ANSI SGR parser (color + bold only)
// ==========================================

export interface StyledSegment {
  text: string;
  color?: string;
  bold?: boolean;
}

export const DEFAULT_TERMINAL_COLOR = '#e4e4e7';

export function parseAnsi(
  rawText: string,
  baseColor: string = DEFAULT_TERMINAL_COLOR,
  ansiMap: Record<number, string> = {}
): StyledSegment[] {
  const sanitized = rawText
    .replace(/\x1b\[\?1049[hl]/g, '')
    .replace(/\x1b\[\?25[hl]/g, '')
    .replace(/\x1b\[2J/g, '\n')
    .replace(/\x1b\[H/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, (match) => {
      return match.endsWith('m') ? match : '';
    });

  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  const segments: StyledSegment[] = [];

  let lastIndex = 0;
  let currentColor = baseColor;
  let isBold = false;

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(sanitized)) !== null) {
    const textChunk = sanitized.substring(lastIndex, match.index);
    if (textChunk) {
      segments.push({ text: textChunk, color: currentColor, bold: isBold });
    }

    const codeStr = match[1] || '0';
    const codes = codeStr.split(';').map((c) => parseInt(c, 10) || 0);

    for (const code of codes) {
      if (code === 0) {
        currentColor = baseColor;
        isBold = false;
      } else if (code === 1) {
        isBold = true;
      } else if (ansiMap[code]) {
        currentColor = ansiMap[code];
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remaining = sanitized.substring(lastIndex);
  if (remaining) {
    segments.push({ text: remaining, color: currentColor, bold: isBold });
  }

  return segments;
}
