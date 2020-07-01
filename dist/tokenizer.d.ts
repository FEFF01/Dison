import Character from './character';
import { Position, Token } from "./interfaces";
export default class extends Character {
    constructor(options?: Record<string, any>);
    token_types: Record<string, string | number>;
    token_hooks: Record<string, (token: Token) => Token>;
    line_number: number;
    line_start: number;
    save_comments: boolean;
    parent_token: Token;
    error_logs: Array<any>;
    err(...args: any): void;
    tokenize(input: string): Array<Token>;
    getToken(type: string | number, range: [number, number], value?: any, start?: Position, end?: Position): Token;
    private match;
    private nextIdentifier;
    private nextRegexp;
    private nextPunctuator;
    private nextNumeric;
    private nextToken;
    scan(parent_token: Token, full_match?: boolean): any[];
}
