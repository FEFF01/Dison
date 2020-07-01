

import {
    PRIOR_REGEXP_PUNCTUATORS_TREE,
    PUNCTUATORS_TREE,
    NUMERIC_KEYWORD_MAP,
    TOKEN_TYPE_MAP, TOKEN_TYPES
} from "./lexical/index";
import Character from './character'
import {
    Position, SourceLocation, Token, SearchTree, NUMERIC_TYPE
} from "./interfaces";


export default class extends Character {
    constructor(options?: Record<string, any>) {
        super()
        for (const key in options) {
            this[key] = options[key];
        }
    }
    public token_types = TOKEN_TYPES;
    public token_hooks: Record<string, (token: Token) => Token> = {};
    public line_number: number;
    public line_start: number;
    public save_comments: boolean = true;
    public parent_token: Token;
    public error_logs: Array<any>;
    err(...args: any) {
        //debugger;
        this.error_logs.push.apply(this.error_logs, arguments);
    }
    tokenize(input: string): Array<Token> {
        this.line_number = 0;
        this.line_start = 0;
        this.index = 0;
        this.input = input;
        this.end = this.input.length;
        this.error_logs = [];
        return this.scan(null, true);
    }
    getToken(
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
        if (prev_node.__) {
            let target = prev_node.__;
            this.index = end - 1;
            if (target.scanner) {
                return target.scanner(this);
            } else {
                let token = this.getToken(
                    this.token_types[target.type],
                    [start, end - 1],
                    target.value
                );
                let bound = target.keys[1];
                if (bound) {
                    token.content = this.scan(token/*target.type*/);
                    if (this.input.slice(this.index, this.index + bound.length) === bound) {
                        this.index += bound.length;
                    } else {
                        this.err(token);
                        token.error = "error";
                    }
                    token.range[1] = this.index;
                    token.loc.end.line = this.line_number;
                    token.loc.end.column = this.index - this.line_start;
                }
                return token;
            }
        }
    }
    private nextIdentifier(tokens: Array<Token>): Token | void {
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
            let type = TOKEN_TYPE_MAP[" " + str];
            token = this.getToken(
                this.token_types[type || "Identifier"],
                [start, this.index]
            );
            this._bak = str;
            if (type && str.length !== this.index - start) {
                this.err(token);
            }
        }
        if (length < 0) {
            this.err(this.getToken("error", [this.index, this.index -= length]));
        }
        return token;
    }
    private nextRegexp(tokens: Array<Token>) {
        let prev_token = tokens[tokens.length - 1];
        let match_tree = PRIOR_REGEXP_PUNCTUATORS_TREE;
        if (prev_token) {
            if (prev_token.type === this.token_types.Punctuator) {
                //https://github.com/jquery/esprima/blob/master/src/tokenizer.ts
                switch (prev_token.value) {
                    case "[]":
                        match_tree = PUNCTUATORS_TREE;
                        break;
                    case "()":
                        let keyword_token = tokens[tokens.length - 2];
                        if (
                            !keyword_token
                            || ["if", "while", "for", "with"].indexOf(keyword_token.value) < 0
                        ) {
                            match_tree = PUNCTUATORS_TREE;
                        }
                        break;
                    case "{}":
                        let length = tokens.length;
                        for (
                            let checks of [
                                [
                                    [4, "function"],
                                    [
                                        5,
                                        "async",
                                        function () {
                                            return tokens[length - 4].loc.start.line
                                                === tokens[length - 5].loc.end.line;
                                        }
                                    ]
                                ],
                                [
                                    [5, "function"],
                                    [
                                        6,
                                        "async",
                                        function () {
                                            return tokens[length - 5].loc.start.line
                                                === tokens[length - 6].loc.end.line;
                                        }
                                    ]
                                ],
                                [[2, "class"]],
                                [[3, "class"]],
                                [[5, "class"]],
                            ] as Array<Array<[number, string, () => boolean | undefined]>>
                        ) {
                            let index: number;
                            let target_token: Token;
                            for (let check of checks) {
                                target_token = tokens[length - check[0]];
                                if (
                                    target_token
                                    && target_token.value === check[1]
                                    && (!check[2] || check[2]())
                                ) {
                                    index = check[0];
                                } else {
                                    break;
                                }
                            }
                            if (index !== undefined) {
                                if (
                                    this.parent_token
                                    && ["()", "[]", "${}"].indexOf(this.parent_token.value) >= 0
                                    || this.isFollowingAnExpression(tokens[length - index - 1])
                                ) {
                                    match_tree = PUNCTUATORS_TREE
                                }
                                break;
                            }
                        }
                        break;

                }
            } else if (
                prev_token.type !== this.token_types.Keyword//&& prev_token.value !== "let"
            ) {
                match_tree = PUNCTUATORS_TREE;
            }
        }
        return this.match(match_tree);
    }
    private nextPunctuator(tokens: Array<Token>): Token | void {
        return this.input[this.index] !== "/"
            ? this.match(PUNCTUATORS_TREE)
            : this.nextRegexp(tokens);
    }

    private nextNumeric(tokens: Array<Token>): Token | void {
        let start = this.index;
        let ch = this.input.charCodeAt(this.index);
        let number: number;
        let flags = NUMERIC_TYPE.DECIMAL;
        let _get_token = () => {
            this._bak = flags & NUMERIC_TYPE.OCTAL ? (flags & ~NUMERIC_TYPE.DECIMAL) : flags;
            return this.getToken(this.token_types.Numeric, [start, this.index]);
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
    private nextToken(tokens: Array<Token>): Token | void {
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
                    return this.nextIdentifier(tokens) ||
                        this.nextNumeric(tokens) ||
                        this.nextPunctuator(tokens);
            }
        }
    }
    scan(parent_token: Token, full_match = false) {
        let parent_token_bak = this.parent_token;
        this.parent_token = parent_token;
        let content = [];
        let proxy_hook: (token: Token, tokenizer: this) => Token;
        let token: Token | void;
        while (this.index < this.end) {
            token = this.nextToken(content);
            if (token) {
                proxy_hook = this.token_hooks[token.type];
                proxy_hook && (token = proxy_hook(token, this));
                if (token.type !== this.token_types.Comments) {
                    content.push(token);
                } else {
                    this.save_comments && content.push(token);
                }
            } else if (!full_match) {
                break;
            } else if (this.index < this.end) {
                //debugger;
                this.err(this.getToken("error", [this.index, ++this.index]))
            }
        }
        this.parent_token = parent_token_bak;
        return content;
    }
}



