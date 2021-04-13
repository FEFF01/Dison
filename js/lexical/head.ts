
import {
    Token, SearchTree, MARKS
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
        if (node[MARKS.END] && !item.overload) {
            let next_item = node[MARKS.END];
            let curr_item = item;
            if (typeof next_item === "function") {
                if (curr_item.filter) {
                    node[MARKS.END] = function (tokenizer: Tokenizer) {
                        return curr_item.filter(tokenizer) ? curr_item : next_item(tokenizer);
                    }
                } else {
                    node[MARKS.END] = function (tokenizer: Tokenizer) {
                        return next_item(tokenizer) || curr_item;
                    }
                }
                continue;
            } else if (curr_item.filter) {
                node[MARKS.END] = function (tokenizer: Tokenizer) {
                    return curr_item.filter(tokenizer) ? curr_item : next_item;
                }
                continue;
            } else {
                console.warn("conflict:", node, node[MARKS.END], item);
            }
        }
        node[MARKS.END] = item.filter ?
            function (tokenizer: Tokenizer) { return item.filter(tokenizer) && item; } :
            item;
    }
    return root;
}


function _Scanner(
    use_escape_mode: boolean = false
) {
    return function (
        tokenizer: Tokenizer,
        start: number = tokenizer.index
    ) {
        let error: string;
        let line_number = tokenizer.line_number;
        let line_start = tokenizer.line_start;
        let root = this.scan_tree;
        let nodes: Array<any> = [];
        let str = "";
        let char: string;
        let backslash_count = 0;
        let token: Token;
        let self = this;
        if (use_escape_mode) {
            let has_escape: number;
            while (char = tokenizer.input[tokenizer.index++]) {
                has_escape = backslash_count % 2;
                if (char === MARKS.ESCAPE) {
                    backslash_count += 1;
                    if (has_escape) {
                        str += char;
                        token = _next(MARKS.ESCAPE);
                        if (token) {
                            return token;
                        }
                    }
                } else {
                    str += char;
                    backslash_count = 0;
                    if (tokenizer.isLineTerminator(char.charCodeAt(0))) {
                        tokenizer.index -= 1;
                        token = _next(has_escape ? `${MARKS.ESCAPE}\n` : "\n");
                        if (token) {
                            return token;
                        }
                        tokenizer.index += 1;
                        tokenizer.line_number += 1;
                        tokenizer.line_start = tokenizer.index;
                    } else {
                        token = _next(!has_escape ? char : MARKS.ESCAPE + char);
                        if (token) {
                            return token;
                        }
                    }
                }
            }
        } else {
            while (char = tokenizer.input[tokenizer.index]) {
                str += char;
                backslash_count = 0;
                if (tokenizer.isLineTerminator(char.charCodeAt(0))) {
                    token = _next("\n");
                    if (token) {
                        return token;
                    }
                    tokenizer.index += 1;
                    tokenizer.line_number += 1;
                    tokenizer.line_start = tokenizer.index;
                } else {
                    tokenizer.index += 1;
                    token = _next(char);
                    if (token) {
                        return token;
                    }
                }
            }
        }
        if ((token = _next(MARKS.EOF))) {
            return token;
        } else {
            let token = _get_token(tokenizer.index);
            tokenizer.err(token);
            return token;
        }

        function _next(key: string) {
            let index = 0, node: any, res: any;
            for (; index < nodes.length; index += 2) {
                node = nodes[index][key];
                if (node) {
                    if (res = _finally(node, nodes[index + 1])) {
                        if (res === MARKS.RESET) {
                            nodes.length = 0;
                            return;
                        }
                        return res;
                    }
                    nodes[index] = node;
                } else {
                    nodes.splice(index, 2);
                    index -= 2;
                }
            }
            if (node = root[key]) {
                if (res = _finally(node, str.length - 1)) {
                    if (res == MARKS.RESET) {
                        nodes.length = 0;
                        return;
                    }
                    return res;
                }
                nodes.push(node, str.length - 1);
            }
        }
        function _get_token(end_index: number) {
            tokenizer._scopes = self;
            tokenizer._volatility = str.slice(0, end_index);
            return tokenizer.createToken(
                self.type,
                [start, tokenizer.index],
                undefined,
                { line: line_number, column: start - line_start }
            );
        }
        function _finally(node: Record<string, any>, end_index: number) {
            node[MARKS.ERROR] && (error = node[MARKS.ERROR]);
            let part: string = node[MARKS.ATTACH] ? node[MARKS.ATTACH](tokenizer, self) : node[MARKS.STRING];
            if (part !== undefined) {
                str = str.slice(0, end_index) + part;
            }
            switch (true) {
                case node[MARKS.END] && true:
                    if (node[MARKS.END] === true || node[MARKS.END](tokenizer, self)) {
                        let token = _get_token(end_index);
                        if (error) {
                            token.error = error;
                            tokenizer.err(token);
                        }
                        return token;
                    }
                    break;
                case node[MARKS.NEXT] && true:
                    tokenizer._scopes = self;
                    tokenizer._volatility = str.slice(0, end_index);
                    return node[MARKS.NEXT](tokenizer, self);
            }
        }
    }

}



export {
    createSearchTree, _Scanner
}


/**
function createScanTree(data: Array<any>[]) {
    let root: Record<string, any> = {};
    for (let branch of data) {
        let node = root;
        for (let i = 0, limit = branch.length - 1, part: string; i < limit; i++) {
            part = branch[i];
            node = node[part] || (node[part] = {});
        }
        let actions = branch[branch.length - 1];
        for (let i = 0; i < actions.length; i += 2) {
            node[actions[i]] = actions[i + 1];
        }
    }
    return root;
}



 */