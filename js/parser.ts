
import Tokenizer from "./tokenizer"
import {
    NodeProp,
    MATCHED,
    Matched,
    MATCHED_RECORDS,
    MatchedRecords,
    Token, Node, Pipe,
    Mark as MarkInterface,
    SearchTree, NUMERIC_TYPE, Context, CONTEXT,
    SourceLocation,
    PRECEDENCE, Precedence, Validate, MARKS, MatchTree
} from "./interfaces";

import { _Context, TYPE_ALIAS, NODES, Mark, Cover, attachLocation, is_right_braces } from "./syntax/head";

type Extreme = MatchedRecords;
type Longest = MatchedRecords;

const { Script, Module } = NODES;



export default class extends Tokenizer {
    SYNTAX_TREE: MatchTree;
    EXPRESSION_TREE: MatchTree;
    TYPE_ALIAS: Record<string, string[]> = TYPE_ALIAS;
    padding_token: Token = {
        type: MARKS.BOUNDARY,
        value: MARKS.BOUNDARY
    };
    error_logs: Array<any>;
    save_comments = false;
    match_tree_stack: Array<MatchTree>;
    context_stack: Array<Context>;
    isExpression: (token: Token) => boolean;
    isStatement: (token: Token) => boolean;
    isStatementListItem: (token: Token) => boolean;
    is_primary_expr_start() {
        if (this.tokens.length) {
            let last_node: any = this.tokens[this.tokens.length - 1];
            return this.isStatementListItem(last_node)
                || last_node.type === this.TYPE_ENUMS.Keyword
                || last_node.type === this.TYPE_ENUMS.Punctuator && !(/^\{\}|\(\)|\[\]$/.test(last_node.value));
        } else {
            return true;
        }
    }
    //token_hooks: Record<string, (token: Token, tokenizer?: Tokenizer) => Token> = token_hooks;
    err(...args: any) {
        debugger;
        this.error_logs.push.apply(this.error_logs, args);
    }
    constructor() {
        super();
    }
    parse(input: string) {
        return this.parseScript(input);
    }
    parseModule(input: string) {
        let tokens = this._parse(input, CONTEXT.isModule, true, CONTEXT.strict, true);
        let module = new Module(tokens);
        if (tokens.length) {
            attachLocation(module, tokens[0], tokens[tokens.length - 1]);
        }
        return module;
    }
    parseScript(input: string) {
        let tokens = this._parse(input);
        let script = new Script(tokens);
        if (tokens.length) {
            attachLocation(module, tokens[0], tokens[tokens.length - 1]);
        }
        return script;
    }
    parseExpression(context: Context): Node {
        context.wrap(CONTEXT.isExpression, true);
        let res = this.parseNode(this.EXPRESSION_TREE, context, this.isExpression);
        context.unwrap();
        return res;
    }
    parseNode(
        match_tree: MatchTree,
        context: Context,
        test: (node: Node) => boolean
    ): Node {
        let tokens = context.tokens;
        this.parseCustom(match_tree, context);
        let res: Node;
        if (tokens.length) {
            let index = 0;
            if (test(tokens[0])) {
                index = 1;
                res = tokens[0];
            }
            if (tokens.length > index) {
                this.err(...tokens.slice(index));
            }
        }
        return res;
    }
    parseRangeAsNode(
        match_tree: MatchTree,
        context: Context,
        left: number,
        lexcal_terminator: Validate,
        test: (node: Node) => boolean
    ): Node {
        let res = this.parseRange(match_tree, context, left, lexcal_terminator, test);
        if (!res.content) {
            this.err(res);
        }
        return res.content;
    }
    parseRangeAsExpression(
        context: Context,
        left: number,
        lexcal_terminator: Validate,
    ): Node {
        context.wrap(CONTEXT.isExpression, true);
        let res = this.parseRangeAsNode(this.EXPRESSION_TREE, context, left, lexcal_terminator, this.isExpression);
        context.unwrap();
        return res;
    }
    parseRangeAsBlock(
        context: Context,
        left: number,
        lexcal_terminator: Validate = is_right_braces,
    ) {
        let res = this.parseRange(this.SYNTAX_TREE, context, left, lexcal_terminator);
        res.type = "Block";
        let tokens = res.content
        if (tokens.length) {
            if (!this.isStatementListItem(tokens[tokens.length - 1])) {
                this.err(tokens.pop());
            }
        }
        return res;
    }
    private _parse(input: string, ...environments: Array<number | any>) {
        //this.logs = [];
        this.match_tree_stack = [];
        this.context_stack = [];
        this.init(input);
        let context = _Context(this);
        environments.length && context.store(...environments);
        //this.parseBlock(context);
        let tokens = context.tokens;
        this.parseCustom(
            this.SYNTAX_TREE,
            context
        );
        if (tokens.length) {
            if (!this.isStatementListItem(tokens[tokens.length - 1])) {
                this.err(tokens.pop());
            }
        }
        if (this.error_logs.length) {
            console.warn("error:", this.error_logs);
        }
        //console.log("logs:", this.logs);
        return this.tokens;
    }
    parseCustom(
        root: MatchTree,
        context: Context,
        begin: number = 0,
        test?: Function
    ) {
        let point = context.store(CONTEXT.begin, begin);
        let cursor: number = begin - 1;
        let backflow_tape: Array<number> = new Array(begin);
        backflow_tape.push(cursor);
        let extreme: Extreme;
        let state: number;
        this.context_stack.unshift(context);
        this.match_tree_stack.unshift(root);
        while (true) {
            if (cursor < begin || context.getToken(cursor)) {
                if (
                    !(
                        extreme
                        && (
                            extreme[MATCHED_RECORDS.right] < cursor
                            && backflow_tape.length <= 3 + extreme[MATCHED_RECORDS.right]
                            //匹配边界断句
                        )
                        && (
                            (state = this.finallize(context, extreme))
                            || (extreme = undefined)
                        )
                    )
                ) {
                    let longest = this.walk(
                        root,
                        context,
                        cursor,
                        backflow_tape,
                        extreme?.[MATCHED_RECORDS.right]
                    );
                    //longest && this.logs.push("walk", longest[MATCHED_RECORDS.left], longest[MATCHED_RECORDS.right], longest[MATCHED_RECORDS.matched][MATCHED.wrapper].name);
                    if (longest) {
                        let longest_precedence = longest[MATCHED_RECORDS.precedence];
                        let extreme_precedence = extreme && extreme[MATCHED_RECORDS.precedence];
                        if (
                            (//如果该记录优先级为true，则立即处理
                                longest_precedence[PRECEDENCE.VALUE] !== true
                                || (extreme = longest, false)
                            ) && (
                                !extreme_precedence
                                || !(
                                    extreme_precedence[PRECEDENCE.VALUE] > longest_precedence[PRECEDENCE.VALUE]
                                    || extreme_precedence[PRECEDENCE.RIGHT_ASSOCIATIVE] === longest_precedence[PRECEDENCE.VALUE] //左结合
                                )
                            ) || !(state = this.finallize(context, extreme))
                        ) {

                            extreme = longest;
                            //cursor += 1;
                            //也可以单步步进，不过这样更效率一些也和当前收集器无冲突
                            cursor += longest[MATCHED_RECORDS.right] - longest[MATCHED_RECORDS.left] || 1;
                            continue;
                        }
                    } else {
                        cursor += 1;
                        continue;
                    }
                }
            } else if (
                !(
                    extreme
                    && (state = this.finallize(context, extreme))
                )
            ) {
                break;
            }
            if (extreme) {
                if (
                    test
                    && extreme[MATCHED_RECORDS.left] <= begin
                    && test(context.getToken(begin))
                ) {
                    context.restore(point);
                    this.context_stack.shift();
                    this.match_tree_stack.shift();
                    return context.getToken(begin);
                }
                cursor = extreme[MATCHED_RECORDS.left];
            }
            cursor >= begin && state !== -1 && (cursor = backflow_tape[cursor]);
            state = 0;
            extreme = undefined;
            backflow_tape.splice(cursor + 1, backflow_tape.length - (cursor + 1));
        }
        this.context_stack.shift();
        this.match_tree_stack.shift();
        context.restore(point);
    }
    parseRange(
        match_tree: MatchTree,
        context: Context,
        left: number,
        lexcal_terminator: Validate,
        test?: (node: Node) => boolean,
    ) {
        let tokens = context.tokens;
        this.terminator_stack.unshift(lexcal_terminator);
        this.parseCustom(
            match_tree,
            context,
            left + 1
        );
        this.terminator_stack.shift();
        let before_token = tokens[left];
        let after_token = tokens[tokens.length - 1];
        let value = before_token.value;
        let end = tokens.length - 1;
        if (lexcal_terminator(after_token)) {
            value += after_token.value;
        } else {
            end += 1;
            this.err(before_token);
        }
        let content: any = null, next = left + 1;
        if (test) {
            if (test(tokens[next])) {
                content = tokens[next];
                next += 1;
            }
            if (next < end) {
                this.err(...this.tokens.splice(next, end - next));
            }
        } else {
            content = tokens.splice(next, end - next);
        }
        let res: Token = {
            type: this.TYPE_ENUMS.Punctuator,
            value,
            content
        };
        attachLocation(res, before_token, after_token);
        tokens.splice(left, tokens.length - left, res);
        return res;
    }
    walk(
        root: MatchTree,
        context: Context,
        start: number,
        backflow_tape: Array<number>,
        minimum: number
    ): Longest {
        let padding_token = this.padding_token;
        let TYPE_ALIAS = this.TYPE_ALIAS;
        let tokens = context.tokens;
        let begin = context[CONTEXT.begin];
        //let steps: Array<number> = [];
        return explore(
            root,
            start
        );
        function get_records(matched: Matched, end: number): MatchedRecords {
            if (
                !matched[MATCHED.filter]
                || matched[MATCHED.filter](context, start, end)
            ) {
                return [
                    matched[MATCHED.precedence],
                    start,
                    end,
                    matched
                ];
            }
        }
        function explore(parent: MatchTree, index: number): Longest {

            let res: Longest;
            let matched: Matched;
            if (parent[MARKS.WALKER]) {
                parent[MARKS.WALKER](context, index - 1);
            }
            if (parent[MARKS.TERMINAL]) {
                if (!(index - 1 <= minimum)) {
                    matched = parent[MARKS.END];
                    if (matched && (res = get_records(matched, index - 1))) {
                        minimum = index - 1;
                    }
                }
                return res;
            }

            let token = index >= begin
                ? context.getToken(index) || (index <= tokens.length && padding_token)
                : padding_token;
            if (!token) {
                return;
            }
            let has_backflow = false;
            if (backflow_tape.length <= index + 1) {
                has_backflow = true;
                backflow_tape.push(start);
            }
            let matched_node: MatchTree;
            let alias = TYPE_ALIAS[token.type];
            let cursor = 0, length = 1, type: string | number;
            let longest: Longest;
            let node: MatchTree;
            let value_node: MatchTree, type_node: MatchTree;
            if (alias) {
                length = alias.length;
                type = alias[cursor];
            } else {
                type = token.type;
            }
            while (true) {
                if (node = parent[type]) {
                    res = undefined;
                    if (
                        !(
                            (value_node = node[token.value])
                            && (res = explore(value_node, index + 1))
                        )
                        && !(
                            (type_node = node[MARKS.TYPE_ONLY])
                            && (res = explore(type_node, index + 1))
                        )
                        && !(index <= minimum)
                    ) {
                        if (
                            matched = (matched_node = value_node) && matched_node[MARKS.END]
                            || (matched_node = type_node) && matched_node[MARKS.END]
                        ) {
                            if (
                                (res = get_records(matched, index))
                            ) {
                                minimum = index;
                            } else if (has_backflow && index > start) {
                                backflow_tape.splice(index + 1, backflow_tape.length - index - 1);
                            }
                        }
                    }
                    longest = res || longest;
                }
                if (++cursor >= length) {
                    return longest;
                } else {
                    type = alias[cursor];
                }
            }
        }
    }
    createNode(context: Context) {
        let left = context[CONTEXT.left];
        let right = context[CONTEXT.right];
        let matched = context[CONTEXT.matched];
        let tokens = context.tokens;
        let begin = context[CONTEXT.begin];
        let node: any = new matched[MATCHED.wrapper]();
        let length = tokens.length;
        let start = left, end = right < length ? right : length - 1;
        let offset = left, key: string | Cover | Mark, pipes: Array<Pipe>, nth: number;
        let token: any, res: any;
        context[CONTEXT.collected] = node;

        function restore_volatility() {
            context[CONTEXT.left] = left;
            context[CONTEXT.right] = right;
            context[CONTEXT.matched] = matched;
            context[CONTEXT.collected] = node
        }

        for (const prop of matched[MATCHED.props]) {
            [key, nth, pipes] = prop as any;
            if (key instanceof Mark) {
                token = key.data(context, offset);
                restore_volatility();
                if (token === undefined) {
                    continue;
                }
                key = key.key;
            } else {
                token = offset >= begin && offset < length ? tokens[offset] : null;

                for (let i in pipes) {
                    res = pipes[i](context, token, offset);
                    res === undefined || (token = res);
                    restore_volatility();
                }
                if (key instanceof Cover) {
                    if (key.value === null) {
                        if (offset === start) {
                            offset < end && (start = offset + 1);
                        } else if (offset > begin && offset - 1 < end) {
                            end = offset - 1;
                        }
                    } else if (offset < length && end < offset) {
                        end = offset;
                    }
                    offset += 1;
                    continue;
                } else if (offset < length && end < offset) {
                    end = offset;
                }
                offset += 1;
            }
            if (nth <= 1) {
                node[key] = nth === 0 ? token : [token];
            } else {
                node[key].push(token);
            }
        }

        start >= begin || (start = begin);

        let start_token = tokens[start];
        let end_token = tokens[end];
        attachLocation(node, start_token, end_token);
        context[CONTEXT.start] = start;
        context[CONTEXT.end] = end;
        return node;
    }
    getToken(index: number) {
        return this.tokens.length > index ? this.tokens[index] : this.nextToken();
    }
    finallize(
        context: Context,
        record: Extreme
    ) {
        let [, left, right, matched/*, steps*/] = record;
        let validator = matched[MATCHED.validator];
        let collected: any;
        let start: number, end: number;
        context[CONTEXT.left] = left;
        context[CONTEXT.right] = right;
        context[CONTEXT.matched] = matched;
        let tokens = context.tokens;
        let handler = matched[MATCHED.handler];
        //this.logs.push("finallize", left, right, matched[MATCHED.wrapper].name);
        if (!validator || (collected = validator(context)) === true) {
            collected = this.createNode(context);
            start = context[CONTEXT.start];
            end = context[CONTEXT.end];
            if (handler) {
                collected = handler(context);
            }
        } else if (collected) {
            start = context[CONTEXT.start];
            end = context[CONTEXT.end];
        }
        if (!collected) {
            return collected === undefined || collected === false
                ? 0
                : (collected === null ? 1 : -1);
        }
        //debugger;
        //this.logs.push("finallize", collected);
        let length = end - start + 1;
        if (collected instanceof Array) {
            tokens.splice(start, length, ...collected);
        } else {
            tokens.splice(start, length, collected);
        }
        return length;
    }
}
