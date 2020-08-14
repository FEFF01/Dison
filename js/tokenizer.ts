

import {
    PRIOR_REGEXP_PUNCTUATORS_TREE,
    PUNCTUATORS_TREE,
    NUMERIC_KEYWORD_MAP,
    TOKEN_TYPE_MAPPERS, TOKEN_TYPE_ENUMS
} from "./lexical/index";
import Character from './character'
import {
    Position, SourceLocation, Token, SearchTree, NUMERIC_TYPE, Validate
} from "./interfaces";

console.log(23, TOKEN_TYPE_ENUMS,TOKEN_TYPE_MAPPERS);

export default class extends Character {
    constructor(options?: Record<string, any>) {
        super()
        for (const key in options) {
            this[key] = options[key];
        }
        //console.log(333, TOKEN_TYPES,TOKEN_TYPE_MAP);
    }
    tokens: Array<Token>;
    public token_hooks: Record<string, (token: Token, tokenizer: this) => Token> = {};
    public line_number: number;
    public line_start: number;
    public save_comments: boolean = true;
    public error_logs: Array<any>;
    public terminator_stack: Array<Validate>;
    err(...args: any) {
        //debugger;
        this.error_logs.push.apply(this.error_logs, arguments);
    }
    init(input: string) {
        this.line_number = 0;
        this.line_start = 0;
        this.index = 0;
        this.input = input;
        this.end = this.input.length;
        this.error_logs = [];
        this.tokens = [];
        this.terminator_stack = [];
    }
    tokenize(input: string): Array<Token> {
        this.init(input);
        while (this.nextToken());
        return this.tokens;
    }
    nextToken() {
        while (
            this.index < this.end
            && (
                this.terminator_stack.length === 0
                || this.tokens.length === 0
                || !this.terminator_stack[0](this.tokens[this.tokens.length - 1])
            )
        ) {
            let token = this._nextToken();
            if (token) {
                let hook = this.token_hooks[token.type];
                hook && (token = hook(token, this));
                if (this.save_comments || token.type !== TOKEN_TYPE_ENUMS.Comments) {
                    this.tokens.push(token);
                    return token;
                }
            } else if (this.index < this.end) {
                this.err(this.createToken("error", [this.index, ++this.index]))
            }
        }
    }
    createToken(
        type: string | number,
        range: [number, number],
        value: any = this.input.slice(range[0], range[1]),
        start: Position = {
            line: this.line_number,
            column: range[0] - this.line_start
        },
        end: Position = {
            line: this.line_number,
            column: range[1] - this.line_start
        },
    ): Token {
        return {
            type: type,
            value,
            range,
            loc: {
                start, end
            }
        };
    }
    private match(node: SearchTree) {
        let start = this.index, end = this.index;
        let prev_node: Token;
        do {
            prev_node = node;
            node = prev_node[this.input[end++]];
        } while (node)
        let target: any = prev_node.__;
        if (target && (target.type || (target = target(this)))) {
            this.index = end - 1;
            return target.scanner ?
                target.scanner(this, start) :
                this.createToken(
                    TOKEN_TYPE_ENUMS[target.type],
                    [start, this.index],
                    target.key
                );
        }
    }
    private nextIdentifier(): Token | void {
        let length = this.inIdentifierStart();
        let token: Token;
        if (length > 0) {
            let start = this.index;
            let str = "";
            do {
                str += length === 1 ? this.input[this.index] : this._bak;
                this.index += length;
                length = this.inIdentifierPart();
            } while (length > 0)
            let type = TOKEN_TYPE_MAPPERS[" " + str];
            token = this.createToken(
                TOKEN_TYPE_ENUMS[type || "Identifier"],
                [start, this.index]
            );
            this._bak = str;
            if (type && str.length !== this.index - start) {
                this.err(token);
            }
        }
        if (length < 0) {
            this.err(this.createToken("error", [this.index, this.index -= length]));
        }
        return token;
    }
    get maybe_regex() {
        if (this.input[this.index] === "/") {
            let is_primary_expr_start = (this as any).is_primary_expr_start;
            return is_primary_expr_start !== undefined
                ? is_primary_expr_start
                : !this.tokens.length || this.tokens[this.tokens.length - 1].type === TOKEN_TYPE_ENUMS.Punctuator;
        }
    }
    private nextPunctuator(): Token | void {
        return this.match(!this.maybe_regex ? PUNCTUATORS_TREE : PRIOR_REGEXP_PUNCTUATORS_TREE);
    }

    private nextNumeric(): Token | void {
        let start = this.index;
        let ch = this.input.charCodeAt(this.index);
        let number: number;
        let flags = NUMERIC_TYPE.DECIMAL;
        let _get_token = () => {
            this._bak = flags & NUMERIC_TYPE.OCTAL ? (flags & ~NUMERIC_TYPE.DECIMAL) : flags;
            return this.createToken(TOKEN_TYPE_ENUMS.Numeric, [start, this.index]);
        }
        let _get_error = (message: string = "Invalid or unexpected token") => {
            let error = _get_token();
            error.error = message;
            error.input = this.input.slice(start, this.index + 1);
            this.err(error);
            return error;
        }
        let decimalValue = this.decimalValue;
        switch (ch) {
            case 0x2e://"."
                if (decimalValue(this.input.charCodeAt(this.index + 1)) >= 0) {
                    this.index += 1;
                    flags |= NUMERIC_TYPE.FLOAT;
                    break;
                } else {
                    return;
                }
            case 0x30://"0"
                flags = NUMERIC_KEYWORD_MAP[this.input[++this.index]];
                if (!flags) {
                    number = decimalValue(this.input.charCodeAt(this.index));
                    if (number >= 0) {
                        flags = NUMERIC_TYPE.DECIMAL;
                        number < 8 && (flags |= NUMERIC_TYPE.OCTAL);
                    } else if (!this.inIdentifierStart()) {
                        flags = NUMERIC_TYPE.DECIMAL;
                        return _get_token();
                    } else {
                        return _get_error();
                    }
                }
                break;
            default:
                if (decimalValue(ch) < 0) {
                    return;
                }
        }
        if (flags & NUMERIC_TYPE.DECIMAL) {
            while ((ch = this.input.charCodeAt(++this.index))) {
                number = decimalValue(ch)
                if (number >= 0) {
                    number < 8 || (flags &= ~NUMERIC_TYPE.OCTAL);
                    continue;
                }
                switch (ch) {
                    case 0x65://"e"
                    case 0x45://"E"
                        if (!(flags & (NUMERIC_TYPE.E | NUMERIC_TYPE.OCTAL))) {
                            flags |= NUMERIC_TYPE.E;
                            ch = this.input.charCodeAt(this.index + 1);
                            if (ch === 0x2b || ch === 0x2d) {//+ -
                                this.index += 1;
                            }
                            continue;
                        } else {
                            return _get_error();
                        }
                    case 0x2e://"."
                        if (!(flags & (NUMERIC_TYPE.FLOAT | NUMERIC_TYPE.E | NUMERIC_TYPE.OCTAL))) {
                            flags |= NUMERIC_TYPE.FLOAT;
                            continue;
                        }
                    default:
                        return this.inIdentifierStart()
                            ? _get_error()
                            : _get_token();
                }
            }
            return _get_token();
        } else {
            let test = flags & NUMERIC_TYPE.HEX
                ? this.hexValue : (
                    flags & NUMERIC_TYPE.BINARY
                        ? this.binaryValue
                        : this.octalValue
                );
            while (test(this.input.charCodeAt(++this.index)) >= 0);
            return this.index > start + 3 && !this.inIdentifierStart()
                ? _get_token()
                : _get_error();
        }
    }
    private _nextToken(): Token | void {
        for (let cp: number; this.index < this.end; this.index++) {
            cp = this.input.charCodeAt(this.index);
            switch (true) {
                case this.isWhiteSpace(cp):
                    break;
                case this.isLineTerminator(cp):
                    this.line_number++;
                    this.line_start = this.index + 1;
                    break;
                default:
                    return this.nextIdentifier() ||
                        this.nextNumeric() ||
                        this.nextPunctuator();
            }
        }
    }
}



