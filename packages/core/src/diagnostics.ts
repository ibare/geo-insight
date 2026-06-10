/**
 * 진단(diagnostic) 타입과 헬퍼.
 *
 * span 의 line/col 은 펜스 본문 기준 1-based. 호스트가 마크다운 전체에서의
 * 오프셋으로 환산하려면 펜스 시작 라인을 더하면 된다.
 */

export interface Span {
  line: number;
  col: number;
}

export interface Diagnostic {
  level: 'error' | 'warning';
  message: string;
  span?: Span;
  /** "수단 vs 남수단" 같은 명확화 제안. */
  suggestions?: string[];
}

export function error(message: string, span?: Span, suggestions?: string[]): Diagnostic {
  return suggestions
    ? { level: 'error', message, span, suggestions }
    : span
      ? { level: 'error', message, span }
      : { level: 'error', message };
}

export function warning(message: string, span?: Span, suggestions?: string[]): Diagnostic {
  return suggestions
    ? { level: 'warning', message, span, suggestions }
    : span
      ? { level: 'warning', message, span }
      : { level: 'warning', message };
}

export function hasError(diags: readonly Diagnostic[]): boolean {
  return diags.some((d) => d.level === 'error');
}
