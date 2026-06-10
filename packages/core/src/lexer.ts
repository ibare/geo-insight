/**
 * Lex — 펜스 본문 → 토큰.
 *
 * 들여쓰기는 의미가 있지만(블록 구조), v1 문법은 라인 지향 + 브레이스라 들여쓰기
 * 자체를 토큰화하진 않는다. 대신 NEWLINE 을 문장 구분자로, `{}` 안에서는 NEWLINE 을
 * 콤마와 동등하게 다룬다(파서 책임). 주석은 `#` 부터 줄 끝까지.
 *
 * 토큰 위치(line/col)는 펜스 본문 기준 1-based.
 */

export type TokenType =
  | 'word'
  | 'string'
  | 'number'
  | 'colon'
  | 'arrow'
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'newline'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

const SPECIAL = new Set([':', ',', '{', '}', '[', ']', '"', '#']);

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let col = 1;
  let i = 0;
  const n = source.length;

  const push = (type: TokenType, value: string, tline: number, tcol: number) => {
    tokens.push({ type, value, line: tline, col: tcol });
  };

  while (i < n) {
    const ch = source[i]!;

    if (ch === '\n') {
      push('newline', '\n', line, col);
      i++;
      line++;
      col = 1;
      continue;
    }
    if (isWhitespace(ch)) {
      i++;
      col++;
      continue;
    }
    if (ch === '#') {
      // 줄 끝까지 주석
      while (i < n && source[i] !== '\n') {
        i++;
        col++;
      }
      continue;
    }
    if (ch === '"') {
      const startCol = col;
      i++;
      col++;
      let str = '';
      while (i < n && source[i] !== '"' && source[i] !== '\n') {
        str += source[i];
        i++;
        col++;
      }
      if (source[i] === '"') {
        i++;
        col++;
      }
      push('string', str, line, startCol);
      continue;
    }
    if (ch === ':') {
      push('colon', ':', line, col);
      i++;
      col++;
      continue;
    }
    if (ch === ',') {
      push('comma', ',', line, col);
      i++;
      col++;
      continue;
    }
    if (ch === '{') {
      push('lbrace', '{', line, col);
      i++;
      col++;
      continue;
    }
    if (ch === '}') {
      push('rbrace', '}', line, col);
      i++;
      col++;
      continue;
    }
    if (ch === '[') {
      push('lbracket', '[', line, col);
      i++;
      col++;
      continue;
    }
    if (ch === ']') {
      push('rbracket', ']', line, col);
      i++;
      col++;
      continue;
    }
    // 화살표 `->`
    if (ch === '-' && source[i + 1] === '>') {
      push('arrow', '->', line, col);
      i += 2;
      col += 2;
      continue;
    }
    // 숫자 (음수/소수 포함): [-+]?digits(.digits)? — 단 `-` 다음이 숫자/소수점일 때만 부호로.
    if (
      isDigit(ch) ||
      ((ch === '-' || ch === '+') && (isDigit(source[i + 1] ?? '') || source[i + 1] === '.')) ||
      (ch === '.' && isDigit(source[i + 1] ?? ''))
    ) {
      const startCol = col;
      let num = '';
      if (ch === '-' || ch === '+') {
        num += ch;
        i++;
        col++;
      }
      while (i < n && (isDigit(source[i]!) || source[i] === '.')) {
        num += source[i];
        i++;
        col++;
      }
      push('number', num, line, startCol);
      continue;
    }
    // 단어: 공백/특수/화살표 시작 전까지
    {
      const startCol = col;
      let word = '';
      while (i < n) {
        const c = source[i]!;
        if (isWhitespace(c) || c === '\n' || SPECIAL.has(c)) break;
        if (c === '-' && source[i + 1] === '>') break;
        word += c;
        i++;
        col++;
      }
      push('word', word, line, startCol);
      continue;
    }
  }

  push('eof', '', line, col);
  return tokens;
}
