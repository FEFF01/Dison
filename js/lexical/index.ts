import {
    Token, NUMERIC_TYPE, MATCH_STATUS
} from '../interfaces';

import Tokenizer from '../tokenizer'
import { search_scan, escape_scan, createSearchTree } from './head'

let TOKEN_TYPES: Record<string, string | number> = {
    Identifier: "Identifier",
    Keyword: "Keyword",
    String: "String",
    Boolean: "Boolean",
    Numeric: "Numeric",
    Punctuator: "Punctuator",
    RegularExpression: "RegularExpression",
    Template: "Template",
    TemplateElement: "TemplateElement",
    Comments: "Comments",
    Null: "Null"
};

//const IS_RADIX = NUMERIC_TYPE.BINARY | NUMERIC_TYPE.OCTAL | NUMERIC_TYPE.HEX;
const NUMERIC_KEYWORD_MAP = {
    ".": NUMERIC_TYPE.FLOAT | NUMERIC_TYPE.DECIMAL,
    "x": NUMERIC_TYPE.HEX,
    "b": NUMERIC_TYPE.BINARY,
    "o": NUMERIC_TYPE.OCTAL,

    "X": NUMERIC_TYPE.HEX,
    "B": NUMERIC_TYPE.BINARY,
    "O": NUMERIC_TYPE.OCTAL,
};

let TOKEN_TYPE_SET = [
    [
        "Keyword",
        [
            "void",
            "delete",
            "new",
            "class", "extends",
            "function",
            "throw",
            "with",
            "yield",
            "in", "instanceof", "typeof",
            "this", "super",
            "var", "const",// "let",
            "break", "continue", "return",
            "if", "else",
            "switch", "case", "default",
            "try", "catch", "finally",
            "do", "while", "for",
            "await",/*"async",*/
            "import", "export",
            "debugger",

            "enum"//用于错误检测
        ]
    ],
    ["Identifier", ["let", "async"]],//使 UnicodeEscape 的情况能被检测到报错
    ["Boolean", ["true", "false"]],
    ["Null", ["null"]]
];

const TOKEN_TYPE_MAP = TOKEN_TYPE_SET.reduce(
    (map, [type, id_set]) => {
        for (let id of id_set) {
            map[" " + id] = type;
        }
        return map;
    }, {}
);

let octal_escape = {
    _state: MATCH_STATUS.ATTACH,
    _attach(tokenizer: Tokenizer, scope: Record<string, any>) {
        let code = tokenizer.octalValue(tokenizer.input.charCodeAt(tokenizer.index - 1));
        let value = 0;
        code && (scope.octal = true);
        let len = code <= 3 ? 2 : 1;
        while (true) {
            value = value * 8 + code;
            code = tokenizer.octalValue(tokenizer.input.charCodeAt(tokenizer.index));
            if (code < 0 || --len < 0) {
                break;
            }
            scope.octal = true;
            tokenizer.index += 1;
        }
        return String.fromCharCode(value);
    }
};
let octal_escape_tree = {
    "\\0": octal_escape,
    "\\1": octal_escape,
    "\\2": octal_escape,
    "\\3": octal_escape,
    "\\4": octal_escape,
    "\\5": octal_escape,
    "\\6": octal_escape,
    "\\7": octal_escape,
}

let strbase_match_tree = {
    "\\\n": { _str: "" },
    "\\n": { _str: "\n" },
    "\\r": { _str: "\r" },
    "\\t": { _str: "\t" },
    "\\b": { _str: "\b" },
    "\\f": { _str: "\f" },
    "\\v": { _str: "\v" },
    "\\u": {
        _state: MATCH_STATUS.ATTACH,
        _attach(tokenizer: Tokenizer) {
            if (tokenizer.input[tokenizer.index] === "{") {
                tokenizer.index++;
                let [code] = tokenizer.scanHex();
                if (tokenizer.input[tokenizer.index] === "}") {
                    tokenizer.index++;
                    if (code <= 0x10ffff) {
                        return String.fromCharCode(code);
                    }
                }
            } else {
                let [code, len] = tokenizer.scanHex(4);
                if (len === 4) {
                    return String.fromCharCode(code);
                }
            }
            return false;
        }
    },
    "\\x": {
        _state: MATCH_STATUS.ATTACH,
        _attach(tokenizer: Tokenizer) {
            let [code, len] = tokenizer.scanHex(2);
            if (len === 2) {
                return String.fromCharCode(code);
            }
            return false;
        }
    }
};

let not_allow_octal_escape = {
    _state: MATCH_STATUS.ERROR,
    _message: "Octal escape sequences are not allowed in template strings"
}

const PUNCTUATORS = [
    {
        keys: [`"`, `"`], type: "String",
        match_tree: {
            '"': {
                _state: MATCH_STATUS.END
            },
            "\n": {
                _state: MATCH_STATUS.ERROR,
                _message: ""
            },
            ...strbase_match_tree,
            ...octal_escape_tree
        },
        //scanner:escape_scan
        escape_scan,
        scanner(tokenizer: Tokenizer) {
            return this.escape_scan(tokenizer, {});
        }
    },
    {
        keys: [`'`, `'`], type: "String",
        match_tree: {
            "'": {
                _state: MATCH_STATUS.END
            },
            "\n": {
                _state: MATCH_STATUS.ERROR,
                _message: ""
            },
            ...strbase_match_tree,
            ...octal_escape_tree
        },
        //scanner:escape_scan
        escape_scan,
        scanner(tokenizer: Tokenizer) {
            return this.escape_scan(tokenizer, {});
        }
    },
    {
        keys: ["`", "`"], type: "Template",
        appendTemplateElement(
            tokenizer: Tokenizer,
            scope: Record<string, any>,
            range: [number, number],
            tail = false
        ) {
            let token = tokenizer.getToken(
                "TemplateElement",
                range,
                {
                    raw: tokenizer.input.slice(range[0], range[1]),
                    cooked: tokenizer._bak
                },
                {
                    line: scope.prev_line,
                    column: scope.prev_solumn
                }
            );
            token.tail = tail;
            scope.content.push(token);
        },
        match_tree: {
            "\\0": { _str: "\0" },
            "\\1": not_allow_octal_escape,
            "\\2": not_allow_octal_escape,
            "\\3": not_allow_octal_escape,
            "\\4": not_allow_octal_escape,
            "\\5": not_allow_octal_escape,
            "\\6": not_allow_octal_escape,
            "\\7": not_allow_octal_escape,
            "`": {
                _state: MATCH_STATUS.NEXT,
                _next(tokenizer: Tokenizer, scope: Record<string, any>, start: number, error?: string) {
                    this.appendTemplateElement(tokenizer, scope, [start, tokenizer.index], true);
                    let token = tokenizer.getToken(
                        this.type,
                        [scope.start, tokenizer.index],
                        this.value,
                        {
                            line: scope.start_line,
                            column: scope.start_column
                        }
                    );
                    token.content = scope.content;
                    return token;
                }
            },
            "$": {
                "{": {
                    _state: MATCH_STATUS.NEXT,
                    _next(tokenizer: Tokenizer, scope: Record<string, any>, start: number, error) {
                        if (start < tokenizer.index - 2) {
                            this.appendTemplateElement(tokenizer, scope, [start, tokenizer.index - 2]);
                        }
                        start = tokenizer.index - 2;
                        let token = tokenizer.getToken(
                            tokenizer.token_types.Punctuator,
                            [start, tokenizer.index],
                            "${}",
                            {
                                line: tokenizer.line_number,
                                column: start - tokenizer.line_start
                            }
                        );
                        let content = tokenizer.scan(token);
                        if (tokenizer.input[tokenizer.index] === "}") {
                            tokenizer.index += 1;
                            scope.prev_line = tokenizer.line_number;
                            scope.prev_column = tokenizer.index - tokenizer.line_start;
                            token.range[1] = tokenizer.index;
                            token.loc.end.line = scope.prev_line;
                            token.loc.end.column = scope.prev_column;
                            token.content = content;
                            scope.content.push(token);
                            return this.escape_scan(tokenizer, scope, tokenizer.index);
                        }
                    }
                }
            },
            ...strbase_match_tree
        },
        escape_scan,
        scanner(tokenizer: Tokenizer) {
            let start = tokenizer.index - 1;
            let start_line = tokenizer.line_number;
            let start_column = start - tokenizer.line_start;
            return this.escape_scan(
                tokenizer,
                {
                    content: [],
                    start,
                    start_line,
                    start_column,
                    prev_line: start_line,
                    prev_column: start_column
                }
            );
        }
    },
    { keys: ['/*', '*/'], type: "Comments", scanner: search_scan },
    { keys: ['//', '\n'], type: "Comments", scanner: search_scan },

    ["(", ")"], ["[", "]"], ["{", "}"],
    ';', '.', '?.',
    '++', '--', '~', '!',
    '**', '*', '/', '%',
    '+', '-',
    '<<', '>>', '>>>',
    '<', '>', '<=', '>=', '==', '!=', '===', '!==',
    '&',
    '^',
    '|',
    '&&',
    '||',
    '?', ":",
    '=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=',
    '...',
    ',',
    '=>'
];

const REGEXP_DESCRIPTOR = {
    keys: ['/', '/'], type: "RegularExpression",
    match_tree: {
        '/': {
            _state: MATCH_STATUS.END,
            _end(tokenizer: Tokenizer, scope: Record<string, any>) {
                return !scope.class_marker;
            }
        },
        '[': {
            _state: MATCH_STATUS.ATTACH,
            _attach(tokenizer: Tokenizer, scope: Record<string, any>) {
                scope.class_marker = true;
            }
        },
        ']': {
            _state: MATCH_STATUS.ATTACH,
            _attach(tokenizer: Tokenizer, scope: Record<string, any>) {
                scope.class_marker = false;
            }
        },
        '\n': {
            _state: MATCH_STATUS.ERROR
        },
        '\\\n': {
            _state: MATCH_STATUS.ERROR
        },
        'EOF': {
            _state: MATCH_STATUS.END,
            _error: "Invalid or unexpected token"
        }
    },
    overload: true,
    escape_scan,
    scanner(tokenizer: Tokenizer, prev_token: Token) {
        let scope: Record<string, any> = {};
        let token = this.escape_scan(tokenizer, scope);
        if (token) {
            token.regex = {
                pattern: token.value.slice(
                    1, token.value[token.value.length - 1] !== "/" ? undefined : -1
                ),
                flags: ""
            };
            let start = tokenizer.index;
            let length = 0;
            do {
                tokenizer.index += length;
                length = tokenizer.inIdentifierPart();
            } while (length)
            if (start !== tokenizer.index) {
                token.regex.flags = tokenizer.input.slice(start, tokenizer.index)
                token.value += token.regex.flags;
                token.range[1] += tokenizer.index - start;
                token.loc.end.column += tokenizer.index - start;
            }
            return token;
        }
    }
};
const PUNCTUATORS_TREE = createSearchTree(PUNCTUATORS);
const PRIOR_REGEXP_PUNCTUATORS_TREE = createSearchTree(
    [REGEXP_DESCRIPTOR],
    createSearchTree(PUNCTUATORS, ["/="]),
);


export {
    PRIOR_REGEXP_PUNCTUATORS_TREE,
    PUNCTUATORS_TREE,
    NUMERIC_KEYWORD_MAP,
    TOKEN_TYPE_MAP, TOKEN_TYPES
}


