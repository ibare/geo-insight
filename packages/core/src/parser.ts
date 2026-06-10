/**
 * Parse — 토큰 → 구문 AST. 순수 구문만, 의미 없음.
 *
 * 문법(요약):
 *   program  := 'earth' STRING? ':' NEWLINE* statement*
 *   statement:= sceneProp | entity | linkDecl | labelDecl | themeDecl
 *   sceneProp:= WORD ':' value NEWLINE          # show/link/center/arrange/fit/projection
 *   entity   := ('group'|'focus'|'plain') name braceProps?
 *   linkDecl := 'link' name '->' name braceProps?
 *   labelDecl:= 'label' name braceProps?
 *   themeDecl:= 'theme' braceProps
 *   braceProps := '{' (WORD ':' scalar (','|NEWLINE)*)* '}'
 */

import type {
  Ast,
  EntityStmt,
  LabelStmt,
  LinkStmt,
  PropMap,
  PropValue,
  Role,
  ScenePropStmt,
  Statement,
  ThemeStmt,
} from './ast.js';
import { type Diagnostic, error, warning } from './diagnostics.js';
import { lex, type Token, type TokenType } from './lexer.js';

const ROLE_KEYWORDS = new Set(['group', 'focus', 'plain']);

class Parser {
  private pos = 0;
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }
  private next(): Token {
    const t = this.tokens[this.pos]!;
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }
  private atEnd(): boolean {
    return this.peek().type === 'eof';
  }
  private skipNewlines(): void {
    while (this.peek().type === 'newline') this.next();
  }
  private skipToLineEnd(): void {
    while (this.peek().type !== 'newline' && this.peek().type !== 'eof') this.next();
  }

  /** 연속 word/string/number 를 공백으로 이어 이름으로. stops 토큰을 만나면 멈춤. */
  private readName(stops: Set<TokenType>): { name: string; span: { line: number; col: number } } {
    const first = this.peek();
    const parts: string[] = [];
    while (!this.atEnd()) {
      const t = this.peek();
      if (t.type === 'newline' || stops.has(t.type)) break;
      if (t.type === 'word' || t.type === 'string' || t.type === 'number') {
        parts.push(t.value);
        this.next();
      } else {
        break;
      }
    }
    return { name: parts.join(' ').trim(), span: { line: first.line, col: first.col } };
  }

  parse(): Ast {
    const ast: Ast = { statements: [] };
    this.skipNewlines();

    // 헤더: earth STRING? ':'
    const head = this.peek();
    if (head.type === 'word' && head.value === 'earth') {
      this.next();
    } else {
      this.diagnostics.push(
        warning("씬은 'earth' 로 시작해야 합니다.", { line: head.line, col: head.col }),
      );
    }
    if (this.peek().type === 'string') {
      ast.title = this.next().value;
    }
    if (this.peek().type === 'colon') {
      this.next();
    } else {
      const t = this.peek();
      this.diagnostics.push(warning("'earth' 뒤에 ':' 가 필요합니다.", { line: t.line, col: t.col }));
    }
    this.skipNewlines();

    while (!this.atEnd()) {
      const stmt = this.parseStatement();
      if (stmt) ast.statements.push(stmt);
      this.skipNewlines();
    }
    return ast;
  }

  private parseStatement(): Statement | null {
    const t = this.peek();
    if (t.type !== 'word') {
      this.diagnostics.push(error(`예상치 못한 토큰 '${t.value || t.type}'.`, { line: t.line, col: t.col }));
      this.skipToLineEnd();
      return null;
    }
    const kw = t.value;
    const next = this.peek(1);

    if (ROLE_KEYWORDS.has(kw)) return this.parseEntity(kw as Role);
    if (kw === 'link' && next.type !== 'colon') return this.parseLinkDecl();
    if (kw === 'label' && next.type !== 'colon') return this.parseLabelDecl();
    if (kw === 'theme' && next.type === 'lbrace') return this.parseThemeDecl();
    return this.parseSceneProp();
  }

  private parseEntity(role: Role): EntityStmt {
    const start = this.next(); // role keyword
    const { name } = this.readName(new Set<TokenType>(['lbrace', 'colon']));
    if (!name) {
      this.diagnostics.push(error(`${role} 뒤에 엔티티 이름이 필요합니다.`, { line: start.line, col: start.col }));
    }
    const props = this.peek().type === 'lbrace' ? this.parseBraceProps() : {};
    return { kind: 'entity', role, name, props, span: { line: start.line, col: start.col } };
  }

  private parseLinkDecl(): LinkStmt {
    const start = this.next(); // 'link'
    const { name: from } = this.readName(new Set<TokenType>(['arrow', 'lbrace']));
    let to = '';
    if (this.peek().type === 'arrow') {
      this.next();
      to = this.readName(new Set<TokenType>(['lbrace'])).name;
    } else {
      this.diagnostics.push(error("link 선언에 '->' 가 필요합니다.", { line: start.line, col: start.col }));
    }
    const props = this.peek().type === 'lbrace' ? this.parseBraceProps() : {};
    return { kind: 'link', from, to, props, span: { line: start.line, col: start.col } };
  }

  private parseLabelDecl(): LabelStmt {
    const start = this.next(); // 'label'
    const { name: target } = this.readName(new Set<TokenType>(['lbrace']));
    const props = this.peek().type === 'lbrace' ? this.parseBraceProps() : {};
    return { kind: 'label', target: target || 'all', props, span: { line: start.line, col: start.col } };
  }

  private parseThemeDecl(): ThemeStmt {
    const start = this.next(); // 'theme'
    const props = this.parseBraceProps();
    return { kind: 'theme', props, span: { line: start.line, col: start.col } };
  }

  private parseSceneProp(): ScenePropStmt {
    const keyTok = this.next();
    const key = keyTok.value;
    if (this.peek().type === 'colon') {
      this.next();
    } else {
      const t = this.peek();
      this.diagnostics.push(error(`'${key}' 뒤에 ':' 가 필요합니다.`, { line: t.line, col: t.col }));
    }
    // 값 토큰 수집 (개행 전까지)
    const valueTokens: Token[] = [];
    while (this.peek().type !== 'newline' && this.peek().type !== 'eof') {
      valueTokens.push(this.next());
    }
    const raw = joinTokens(valueTokens);
    const stmt: ScenePropStmt = { kind: 'prop', key, raw, span: { line: keyTok.line, col: keyTok.col } };

    // 콤마 리스트 (show 등)
    if (valueTokens.some((t) => t.type === 'comma')) {
      stmt.list = splitByComma(valueTokens);
    }
    // 관계 (link/arrange 등) — 우측 끝 문자열 토큰은 라벨로 분리
    const arrowIdx = valueTokens.findIndex((t) => t.type === 'arrow');
    if (arrowIdx >= 0) {
      const rightTokens = valueTokens.slice(arrowIdx + 1);
      const last = rightTokens[rightTokens.length - 1];
      if (last && last.type === 'string') {
        rightTokens.pop();
        stmt.label = last.value;
      }
      const from = joinTokens(valueTokens.slice(0, arrowIdx)).trim();
      const to = joinTokens(rightTokens).trim();
      stmt.relation = { from, to };
    }
    return stmt;
  }

  private parseBraceProps(): PropMap {
    const props: PropMap = {};
    this.next(); // lbrace
    while (!this.atEnd() && this.peek().type !== 'rbrace') {
      if (this.peek().type === 'newline' || this.peek().type === 'comma') {
        this.next();
        continue;
      }
      const keyTok = this.peek();
      if (keyTok.type !== 'word') {
        this.diagnostics.push(error(`속성 이름이 필요합니다.`, { line: keyTok.line, col: keyTok.col }));
        this.next();
        continue;
      }
      const key = this.next().value;
      if (this.peek().type === 'colon') {
        this.next();
      } else {
        this.diagnostics.push(error(`'${key}' 뒤에 ':' 가 필요합니다.`, { line: this.peek().line, col: this.peek().col }));
      }
      // 값: 콤마/개행/rbrace 전까지
      const valTokens: Token[] = [];
      while (
        !this.atEnd() &&
        this.peek().type !== 'comma' &&
        this.peek().type !== 'newline' &&
        this.peek().type !== 'rbrace'
      ) {
        valTokens.push(this.next());
      }
      props[key] = coerceScalar(valTokens);
    }
    if (this.peek().type === 'rbrace') this.next();
    else this.diagnostics.push(error("'}' 가 필요합니다.", { line: this.peek().line, col: this.peek().col }));
    return props;
  }
}

function joinTokens(tokens: Token[]): string {
  const parts: string[] = [];
  for (const t of tokens) {
    if (t.type === 'comma') parts.push(',');
    else if (t.type === 'arrow') parts.push('->');
    else if (t.type === 'lbracket') parts.push('[');
    else if (t.type === 'rbracket') parts.push(']');
    else parts.push(t.value);
  }
  return parts.join(' ').replace(/\s+,/g, ',').replace(/,\s*/g, ', ').trim();
}

function splitByComma(tokens: Token[]): string[] {
  const groups: Token[][] = [[]];
  for (const t of tokens) {
    if (t.type === 'comma') groups.push([]);
    else groups[groups.length - 1]!.push(t);
  }
  return groups
    .map((g) => g.map((t) => t.value).join(' ').trim())
    .filter((s) => s.length > 0);
}

function coerceScalar(tokens: Token[]): PropValue {
  if (tokens.length === 1) {
    const t = tokens[0]!;
    if (t.type === 'number') return Number(t.value);
    if (t.value === 'true') return true;
    if (t.value === 'false') return false;
    return t.value;
  }
  const joined = tokens.map((t) => t.value).join(' ').trim();
  if (joined === 'true') return true;
  if (joined === 'false') return false;
  const num = Number(joined);
  if (joined !== '' && !Number.isNaN(num)) return num;
  return joined;
}

export function parse(source: string): { ast: Ast; diagnostics: Diagnostic[] } {
  const parser = new Parser(lex(source));
  const ast = parser.parse();
  return { ast, diagnostics: parser.diagnostics };
}
