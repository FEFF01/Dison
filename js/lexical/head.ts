
import {
    Token, SearchTree, MATCH_STATUS
} from '../interfaces';

import Tokenizer from '../tokenizer'

function createSearchTree(
    data: Array<string | string[] | Record<string, any>>,
    root: Record<string, any> = {},
    block_list: Array<string> = []
): SearchTree {
    for (let item of data as any) {
        let node = root;
        switch (true) {
            case typeof item === "string":
                item = {
                    type: "Punctuator",
                    key: item,
                }
                break;
            default:
                item.type === undefined && (item.type = "Punctuator");
                break;
        }
        if (~block_list.indexOf(item.key)) {
            continue;
        }
        for (const part of item.key) {
            node = node[part] || (node[part] = {});
        }
        if (node.__ && !item.overload) {
            let next_item = node.__;
            let curr_item = item;
            if (typeof next_item === "function") {
                if (curr_item.filter) {
                    node.__ = function (tokenizer: Tokenizer) {
                        return curr_item.filter(tokenizer) ? curr_item : next_item(tokenizer);
                    }
                } else {
                    node.__ = function (tokenizer: Tokenizer) {
                        return next_item(tokenizer) || curr_item;
                    }
                }
                continue;
            } else if (curr_item.filter) {
                node.__ = function (tokenizer: Tokenizer) {
                    return curr_item.filter(tokenizer) ? curr_item : next_item;
                }
                continue;
            } else {
                console.warn("conflict:", node, node.__, item);
            }
        }
        node.__ = item.filter ?
            function (tokenizer: Tokenizer) { return item.filter(tokenizer) && item; } :
            item;
    }
    return root;
}


const enum MARKS {
    EOF = "",
    ESCAPE = "\\"
}
function escape_scan(
    tokenizer: Tokenizer,
    start: number,
    scope?: Record<string, any>,
) {
    let error: string;
    let line_number = tokenizer.line_number;
    let line_start = tokenizer.line_start;
    let root = this.match_tree;
    let node = root;
    let path = "";
    let str = "";
    let char: string;
    let backslash_count = 0;
    let token: Token;
    let self = this;

    while (char = tokenizer.input[tokenizer.index++]) {
        let has_escape = backslash_count % 2;
        if (char === MARKS.ESCAPE) {
            backslash_count += 1;
            if (has_escape) {
                path += char;
                node = node[MARKS.ESCAPE]
            }
        } else {
            path += char;
            backslash_count = 0;
            if (tokenizer.isLineTerminator(char.charCodeAt(0))) {
                node = node[
                    has_escape
                        ? `${MARKS.ESCAPE}\n`
                        : "\n"
                ];
                if (node && node._state === MATCH_STATUS.END) {
                    tokenizer.index -= 1;
                    if ((token = _next())) {
                        return token;
                    }
                    tokenizer.index += 1;
                }
                tokenizer.line_number += 1;
                tokenizer.line_start = tokenizer.index;
            } else {
                node = node[!has_escape ? char : MARKS.ESCAPE + char];
            }
        }
        if (node && (token = _next())) {
            return token;
        }
        if (!node) {
            str += path;
            node = root;
            path = "";
        }
    }
    if ((node = root[MARKS.EOF])) {
        return _next();
    } else {
        tokenizer.err(_finally());
    }
    function _finally() {
        tokenizer._scope = scope;
        tokenizer._volatility = str;
        return tokenizer.createToken(
            self.type,
            [start, tokenizer.index],
            undefined, { line: line_number, column: start - line_start }
        );
    }
    function _next() {
        node._error && (error = node._error);
        switch (node._state) {
            case MATCH_STATUS.END:
                if (
                    !node._end
                    || node._end(tokenizer, scope, start, error)
                ) {
                    let token = _finally();
                    if (node._error || error) {
                        token.error = (node._error || error);
                        tokenizer.err(token);
                    }
                    return token;
                }
                break;
            case MATCH_STATUS.ATTACH:
                let res = node._attach(tokenizer, scope, start, error);
                res && (path = res);
                break;
            case MATCH_STATUS.ERROR:
                error || (error = "Invalid or unexpected token");
            case MATCH_STATUS.NEXT:
                if (node._next) {
                    tokenizer._volatility = str;
                    return node._next(tokenizer, scope, start, error);
                }
                break;
            default:
                if (node._str === undefined) {
                    return;
                } else {
                    path = node._str;
                }
        }
        node = null;
    }
}
/*
function search_scan(tokenizer: Tokenizer, start: number) {
    let bound = this.bound;
    let start_line = tokenizer.line_number;
    let start_column = start - tokenizer.line_start;
    let matched_count = 0;
    for (
        let char = tokenizer.input[tokenizer.index++];
        char;
        char = tokenizer.input[tokenizer.index++]
    ) {
        if (tokenizer.isLineTerminator(char.charCodeAt(0))) {
            if (bound === "\n") {
                tokenizer.index -= 1;
                break;
            }
            tokenizer.line_number += 1;
            tokenizer.line_start = tokenizer.index;
        } else if (char === bound[matched_count]) {
            if (bound.length > ++matched_count) {
                continue;
            } else {
                break;
            }
        }
        matched_count = 0;
    }
    let token = tokenizer.createToken(
        this.type,
        [start, tokenizer.index],
        undefined,
        { line: start_line, column: start_column }
    );
    if (matched_count !== bound.length && bound !== "\n" && bound !== "EOF") {
        token.error = "Invalid or unexpected token";
        tokenizer.err(token);
    }
    return token;
}*/
export {
    createSearchTree, escape_scan, MARKS
}