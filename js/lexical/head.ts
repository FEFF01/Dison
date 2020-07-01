
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
                item = [item];
            case item instanceof Array:
                item = {
                    type: "Punctuator",
                    keys: item,
                    value: item.join("")
                }
                break;
            default:
                item.type === undefined && (item.type = "Punctuator");
                item.value === undefined && (item.value = item.keys.join(""));
                break;
        }
        if (~block_list.indexOf(item.keys[0])) {
            continue;
        }
        for (const part of item.keys[0]) {
            node = node[part] || (node[part] = {});
        }
        if (node.__ && !item.overload) {
            console.warn("conflict:", node, node.__, item);
        }
        node.__ = item;
    }
    return root;
}

function escape_scan(
    tokenizer: Tokenizer,
    scope?: Record<string, any>,
    start: number = tokenizer.index - this.keys[0].length
) {
    let error: string;
    let line_number = tokenizer.line_number;
    let line_start = tokenizer.line_start;
    let str = "";
    let root = this.match_tree;
    let node = root;
    let _next = () => {
        let token: Token;
        let res: string | boolean;
        switch (node._state) {
            case MATCH_STATUS.END:
                if (!node._end || (res = node._end.call(this, tokenizer, scope, start, error)) === true) {
                    token = tokenizer.getToken(
                        this.type,
                        [start, tokenizer.index],
                        undefined, { line: line_number, column: start - line_start }
                    );
                    tokenizer._scope = scope;
                    tokenizer._bak = str;
                    if (node._error || error) {
                        token.error = (node._error || error);
                        tokenizer.err(token);
                    }
                    return token;
                } else if (typeof res === "string") {
                    str += res;
                }
                break;
            case MATCH_STATUS.ATTACH:
                res = node._attach.call(this, tokenizer, scope, start, error);
                if (res !== false) {
                    res && (str += res);
                    break;
                }
            case MATCH_STATUS.ERROR:
                error = node._message || "Invalid or unexpected token";
            case MATCH_STATUS.NEXT:
                if (node._next) {
                    tokenizer._bak = str;
                    return node._next.call(this, tokenizer, scope, start, error);
                }
                break;
            default:
                if (node._str === undefined) {
                    return;
                }
                str += node._str;
        }
        node = root;
    }
    for (
        let char = tokenizer.input[tokenizer.index++],
        backslash_count = 0,
        token: Token;
        char;
        char = tokenizer.input[tokenizer.index++]
    ) {
        let has_escape = backslash_count % 2;
        if (char === "\\") {
            backslash_count += 1;
            has_escape && (node = node["\\"]);
        } else {
            backslash_count = 0;
            if (tokenizer.isLineTerminator(char.charCodeAt(0))) {
                tokenizer.line_number += 1;
                tokenizer.line_start = tokenizer.index;
                node = node[
                    has_escape
                        ? "\\\n"
                        : "\n"
                ];
            } else {
                node = node[!has_escape ? char : "\\" + char];
            }
        }

        if (!node) {
            str += char;
            node = root;
        } else if ((token = _next())) {
            return token;
        }
    }
    if (root.EOF) {
        node = root.EOF;
        return _next();
    }
}
function search_scan(tokenizer: Tokenizer) {
    let start = tokenizer.index - this.keys[0].length;
    let bound = this.keys[1];
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
    let token = tokenizer.getToken(
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
}
export {
    createSearchTree, escape_scan, search_scan
}