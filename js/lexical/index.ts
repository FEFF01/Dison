import {
    Token, NUMERIC_TYPE, MARKS
} from '../interfaces';

import Tokenizer from '../tokenizer'
import { _Scanner, createSearchTree } from './head'


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


let octal_escape = {
    //_state: MATCH_STATUS.ATTACH,
    [MARKS.ATTACH](tokenizer: Tokenizer, self: Record<string, any>) {
        let code = tokenizer.octalValue(tokenizer.input.charCodeAt(tokenizer.index - 1));
        let value = 0;
        code && (self.octal = true);
        let len = code <= 3 ? 2 : 1;
        while (true) {
            value = value * 8 + code;
            code = tokenizer.octalValue(tokenizer.input.charCodeAt(tokenizer.index));
            if (code < 0 || --len < 0) {
                break;
            }
            self.octal = true;
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

let strbase_scan_tree = {
    "\\\n": { [MARKS.STRING]: "" },
    "\\n": { [MARKS.STRING]: "\n" },
    "\\r": { [MARKS.STRING]: "\r" },
    "\\t": { [MARKS.STRING]: "\t" },
    "\\b": { [MARKS.STRING]: "\b" },
    "\\f": { [MARKS.STRING]: "\f" },
    "\\v": { [MARKS.STRING]: "\v" },
    "\\u": {
        //_state: MATCH_STATUS.ATTACH,
        [MARKS.ATTACH](tokenizer: Tokenizer) {
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
        //_state: MATCH_STATUS.ATTACH,
        [MARKS.ATTACH](tokenizer: Tokenizer) {
            let [code, len] = tokenizer.scanHex(2);
            if (len === 2) {
                return String.fromCharCode(code);
            }
            return false;
        }
    }
};

let not_allow_octal_escape = {
    //_state: MATCH_STATUS.ERROR,
    [MARKS.ERROR]: "Octal escape sequences are not allowed in template strings"
}

//let template_curly_stack = [];
let template_base = {
    type: "Template",
    scan_tree: {
        [MARKS.EOF]: {
            //_state: MATCH_STATUS.END,
            [MARKS.ERROR]: "Unexpected token",
            [MARKS.END](tokenizer: Tokenizer) {
                tokenizer.curly_stack.shift();
                return true;
            }
        },
        "\\0": { [MARKS.STRING]: "\0" },
        "\\1": not_allow_octal_escape,
        "\\2": not_allow_octal_escape,
        "\\3": not_allow_octal_escape,
        "\\4": not_allow_octal_escape,
        "\\5": not_allow_octal_escape,
        "\\6": not_allow_octal_escape,
        "\\7": not_allow_octal_escape,
        "`": {
            [MARKS.END](tokenizer: Tokenizer) {
                tokenizer.curly_stack.shift();
                return true;
            }
        },
        "$": {
            "{": {
                [MARKS.END]: true
            }
        },
        ...strbase_scan_tree
    },
    scanner: _Scanner(true)
}
const PUNCTUATORS: Array<any> = [
    {
        key: `"`, type: "String",
        scan_tree: {
            '"': {
                [MARKS.END]: true
            },
            "\n": {
                //_state: MATCH_STATUS.ERROR
                [MARKS.ERROR]: "Invalid or unexpected token"
            },
            ...strbase_scan_tree,
            ...octal_escape_tree
        },
        escape_scan: _Scanner(true),
        octal: false,
        scanner(tokenizer: Tokenizer, start: number) {
            this.octal = false;
            return this.escape_scan(tokenizer, start);
        }
    },
    {
        key: `'`, type: "String",
        scan_tree: {
            "'": {
                [MARKS.END]: true
            },
            "\n": {
                //_state: MATCH_STATUS.ERROR
                [MARKS.ERROR]: "Invalid or unexpected token"
            },
            ...strbase_scan_tree,
            ...octal_escape_tree
        },
        escape_scan: _Scanner(true),
        octal: false,
        scanner(tokenizer: Tokenizer, start: number) {
            this.octal = false;
            return this.escape_scan(tokenizer, start);
        }
    },
    {
        key: "`",
        ...template_base,
        escape_scan: _Scanner(true),
        scanner(tokenizer: Tokenizer, start: number) {
            tokenizer.curly_stack.unshift("`");
            return this.escape_scan(tokenizer, start);
        }
    },
    {
        key: "}",
        ...template_base,
        filter(tokenizer: Tokenizer) {
            return tokenizer.curly_stack[0] === "`";
        }
    },
    {
        key: '/*', bound: '*/', type: "Comments",
        scan_tree: {
            "*": {
                "/": {
                    //_state: MATCH_STATUS.END
                    [MARKS.END]: true
                }
            },
            [MARKS.EOF]: {
                [MARKS.END]: true,
                [MARKS.ERROR]: "Unexpected token"
            }
        },
        scanner: _Scanner(false)
    },
    {
        key: '//', bound: '\n', type: "Comments",
        scan_tree: {
            "\n": {
                [MARKS.END]: true
            },
            [MARKS.EOF]: {
                [MARKS.END]: true
            }
        },
        scanner: _Scanner(false)
    },

    //["(", ")"], ["[", "]"], ["{", "}"],

    "(", ")", "[", "]", "{", "}",
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
    key: '/', type: "RegularExpression",
    scan_tree: {
        '/': {
            [MARKS.END](tokenizer: Tokenizer, self: Record<string, any>) {
                return !self.class_marker;
            }
        },
        '[': {
            [MARKS.ATTACH](tokenizer: Tokenizer, self: Record<string, any>) {
                self.class_marker = true;
            }
        },
        ']': {
            [MARKS.ATTACH](tokenizer: Tokenizer, self: Record<string, any>) {
                self.class_marker = false;
            }
        },
        '\n': {
            [MARKS.ERROR]: "Invalid or unexpected token"
        },
        '\\\n': {
            [MARKS.ERROR]: "Invalid or unexpected token"
        },
        [MARKS.EOF]: {
            [MARKS.END]: true,
            [MARKS.ERROR]: "Invalid or unexpected token"
        }
    },
    overload: true,
    escape_scan: _Scanner(true),
    class_marker: false,
    scanner(tokenizer: Tokenizer, start: number) {
        this.class_marker = false;
        let token = this.escape_scan(tokenizer, start);
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


//const IS_RADIX = NUMERIC_TYPE.BINARY | NUMERIC_TYPE.OCTAL | NUMERIC_TYPE.HEX;


const TYPE_ENUMS = {
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


export {
    TYPE_ENUMS,
    PUNCTUATORS,
    TOKEN_TYPE_SET,
    REGEXP_DESCRIPTOR
}


