import Tokenizer from "./tokenizer"
import {
    NodeProp,
    MATCHED,
    Matched,
    MATCHED_RECORDS,
    MatchedRecords,
    Token, Node, Watcher,
    SearchTree, NUMERIC_TYPE, Context, CONTEXT,
    SourceLocation
} from "./interfaces";
import {
    SYNTAX_TREE,
    MATCH_MARKS,
    EXPRESSION_TREE,
    isExpression, isStatementListItem
} from "./syntax/index";
import { _Context, TYPE_ALIAS, NODES, AWAIT_LIST, Mark } from "./syntax/head";
type Extreme = MatchedRecords;
type Longest = MatchedRecords;
for (const cbfun of AWAIT_LIST) {
    cbfun();
}

const { Script, Module, Directive } = NODES;
function parseIdentifier({ value, range, loc }: Token, tokenizer?: Tokenizer): Node {
    let name = tokenizer ? tokenizer._bak : value;
    let identifier = {
        type: "Identifier", name, range, loc
    };
    Object.defineProperty(identifier, "value", {
        configurable: true,
        enumerable: false,
        value: name
    });
    return identifier;

}

function getLiteral(parse_value: (token: Token, tokenizer: Tokenizer) => any, token: Token, tokenizer: Tokenizer) {
    return {
        type: "Literal",
        value: parse_value(token, tokenizer),
        raw: token.value,
        range: token.range,
        loc: token.loc
    }
}

let tokenizer = new Tokenizer({
    save_comments: false, token_hooks: {
        Identifier: parseIdentifier,
        Numeric: getLiteral.bind(null, (token: Token) => Number(token.value)),
        Boolean: getLiteral.bind(null, (token: Token) => token.value === "true"),
        String(token: Token, tokenizer: Tokenizer) {
            if (!tokenizer._scope.octal) {
                return {
                    type: "Literal",
                    value: tokenizer._bak,
                    raw: token.value,
                    range: token.range,
                    loc: token.loc
                };
            }
            token.str = tokenizer._bak;
            token.octal = tokenizer._scope.octal;
            return token;
        },
        Null: getLiteral.bind(null, () => null),
        RegularExpression(token: Token, tokenizer: Tokenizer) {
            let regex = token.regex;
            let expr = {
                type: "Literal",
                value: null,
                raw: token.value,
                regex,
                range: token.range,
                loc: token.loc
            }
            try {
                expr.value = new RegExp(regex.pattern, regex.flags);
            } catch (e) { }
            return expr;
        }
    }
});

export default class {
    tokens: Array<Token>;
    SYNTAX_TREE = SYNTAX_TREE;
    EXPRESSION_TREE = EXPRESSION_TREE;
    tokenizer = tokenizer;
    TYPE_ALIAS = TYPE_ALIAS;
    padding_token: Token = {
        type: MATCH_MARKS.BOUNDARY,
        value: MATCH_MARKS.BOUNDARY
    };
    error_logs: Array<any>;
    err(...args: any) {
        //debugger;
        this.error_logs.push.apply(this.error_logs, args);
    }
    constructor() {
    }
    parse(input: string) {
        return this.parseScript(input);
    }
    parseModule(input: string) {
        return new Module(this._parse(input, CONTEXT.isModule, true, CONTEXT.strict, true), this.range, this.loc);
    }
    parseScript(input: string) {
        return new Script(this._parse(input), this.range, this.loc);
    }
    parseBlock(context: Context, token?: Token) {
        token && (context[CONTEXT.tokens] = token.content);
        let tokens = context[CONTEXT.tokens];
        this.parseCustom(
            SYNTAX_TREE,
            context
        );
        let last_node = tokens[tokens.length - 1];
        if (last_node && !isStatementListItem(last_node)) {
            this.err(tokens.pop());
        }
        return tokens;
    }
    parseExpression(
        context: Context,
        token?: Token,
        match_tree: Record<string, any> = EXPRESSION_TREE
    ) {
        return this.parseNode(match_tree, isExpression, context, token);
    }
    private range: [number, number];
    private loc: SourceLocation;
    private _parse(input: string, ...environments: Array<number | any>) {
        this.tokens = this.tokenizer.tokenize(input);
        this.range = [0, this.tokenizer.index];
        this.loc = {
            start: {
                line: 0,
                column: 0
            },
            end: {
                line: this.tokenizer.line_number,
                column: this.tokenizer.index - this.tokenizer.line_start
            }
        };
        this.error_logs = this.tokenizer.error_logs;
        let context = _Context(this, this.tokens);
        environments.length && context.store(...environments);
        this.parseBlock(context);
        if (this.error_logs.length) {
            console.warn("error:", this.error_logs);
        }
        return this.tokens;
    }
    parseCustom(
        root: Record<string, any>,
        context: Context,
        begin: number = 0,
        hook?: Function
    ) {
        let point = context.store(CONTEXT.begin, begin);
        let cursor: number = begin - 1;
        let tokens = context[CONTEXT.tokens];
        let backflow_tape: Array<number> = new Array(begin);
        backflow_tape.push(cursor);
        let extreme: Extreme;
        let state: number;
        while (true) {
            if (cursor < tokens.length) {
                //debugger;
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
                    if (longest) {
                        if (
                            !extreme
                            || !(
                                extreme[MATCHED_RECORDS.precedence] > longest[MATCHED_RECORDS.precedence]
                                || extreme[MATCHED_RECORDS.precedence] === Number(longest[MATCHED_RECORDS.precedence]) //左结合
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
                if (hook && extreme[MATCHED_RECORDS.left] <= begin && hook(tokens[begin])) {
                    context.restore(point);
                    return tokens[begin];
                }
                cursor = extreme[MATCHED_RECORDS.left];
            }
            cursor >= begin && state !== -1 && (cursor = backflow_tape[cursor]);
            state = 0;
            extreme = undefined;
            backflow_tape.splice(cursor + 1, backflow_tape.length - (cursor + 1));
        }
        context.restore(point);
    }
    parseNode(
        match_tree: Record<string, any>,
        test: (node: Node) => boolean,
        context: Context,
        token?: Token
    ) {
        let tokens = token
            ? (context[CONTEXT.tokens] = token.content)
            : context[CONTEXT.tokens];
        context.wrap(CONTEXT.isExpression, true);
        this.parseCustom(
            match_tree,
            context
        );
        context.unwrap();
        if (tokens.length) {
            if (test(tokens[0])) {
                tokens.length > 1 && this.err(...tokens.slice(1));
                return tokens[0];
            }
            this.err(...tokens);
        } else if (token) {
            this.err(token);
        }
    }
    parseIdentifier = parseIdentifier;
    parseKeyword({ value, range, loc }: Token): Node {
        return {
            type: "Keyword",
            value,
            range,
            loc
        };
    }
    parseDirective(node: Node) {
        let expression = node.expression;
        if (
            expression
            && expression.type === "Literal"
            && typeof expression.value === "string"
            && expression.raw.length > 2
        ) {
            return new Directive(
                node.type,
                node.expression,
                expression.raw.slice(1, -1),
                node.range,
                node.loc
            );
        }
        return node;
    }

    walk(
        root: Record<string, any>,
        context: Context,
        index: number,
        backflow_tape: Array<number>,
        minimum: number
    ): Longest {
        let padding_token = this.padding_token;
        let TYPE_ALIAS = this.TYPE_ALIAS;
        let tokens = context[CONTEXT.tokens];
        //let steps: Array<number> = [];
        return next(
            root,
            index >= context[CONTEXT.begin] ? tokens[index] : padding_token,
            index,
            index
        );

        function next(parent: Record<string, any>, token: Token, start: number, end: number): Longest {
            let has_backflow = false;
            if (backflow_tape.length <= end + 1) {
                has_backflow = true;
                backflow_tape.push(start);
            }
            let alias = TYPE_ALIAS[token.type];
            if (!alias) {
                return explore(token.type);
            } else {
                let index = 0, longest: Extreme;
                while (index < alias.length) {
                    longest = explore(alias[index++]) || longest;
                }
                return longest;
            }

            function explore(type: string | number): Longest {
                let node: Record<string, any>, next_token: Record<string, any>;
                let res: Longest, matched: Matched, matched_node: Record<string, any>;
                let value_node: Record<string, any>, type_node: Record<string, any>;
                if (!(node = parent[type])) {
                    return;
                }
                next_token = tokens[end + 1] || (end < tokens.length && padding_token);//末尾溢出一个填充节点
                value_node = node[token.value];
                if (!(
                    next_token && value_node
                    && (res = next(value_node, next_token, start, end + 1))
                )) {
                    type_node = node[MATCH_MARKS.TYPE_ONLY];
                    if (!(
                        next_token && type_node
                        && (res = next(type_node, next_token, start, end + 1))
                    )) {
                        if (
                            !(end <= minimum)
                            && (
                                matched =
                                (matched_node = value_node) && matched_node[MATCH_MARKS.MATCH_END]
                                || (matched_node = type_node) && matched_node[MATCH_MARKS.MATCH_END]
                            )
                        ) {
                            if (
                                !matched[MATCHED.filter]
                                || matched[MATCHED.filter](context, start, end)
                            ) {
                                minimum = end;
                                res = [
                                    matched[MATCHED.precedence],
                                    start,
                                    end,
                                    matched
                                ];
                            } else if (has_backflow && end > start) {
                                backflow_tape.splice(end + 1, backflow_tape.length - end - 1);
                            }
                        }
                    }
                }
                return res;
            }
        }
    }
    createNode(context: Context) {
        let left = context[CONTEXT.left];
        let right = context[CONTEXT.right];
        let matched = context[CONTEXT.matched];
        let tokens = context[CONTEXT.tokens];
        let begin = context[CONTEXT.begin];
        let node: any = new matched[MATCHED.wrapper]();
        let length = tokens.length;
        let start = left, end = right < length ? right : length - 1;
        let offset = left, key: string, watchers: Array<Watcher>;

        context[CONTEXT.collected] = node;
        for (const prop of matched[MATCHED.props]) {
            if (!(prop instanceof Mark)) {
                [key, watchers] = (prop as any);
                let token: Token = offset >= begin && offset < length ? tokens[offset] : null;
                if (key) {
                    if (token && end < offset) {
                        end = offset;
                    }
                    if (node[key] === undefined) {
                        node[key] = token;
                    } else {
                        if (node[key] instanceof Array) {
                            node[key].push(token)
                        } else {
                            node[key] = [node[key], token];
                        }
                    }
                } else if (key === null) {
                    if (offset === start) {
                        offset < end && (start = offset + 1);
                    } else if (offset > begin && offset - 1 < end) {
                        end = offset - 1;
                    }
                } else if (token && end < offset) {
                    end = offset;
                }
                for (let i in watchers) {
                    watchers[i](context, token);
                    context[CONTEXT.left] = left;
                    context[CONTEXT.right] = right;
                    context[CONTEXT.matched] = matched;
                    context[CONTEXT.tokens] = tokens;
                    context[CONTEXT.collected] = node
                }
                offset += 1;
            } else {
                node[prop.key] = prop.value;
            }
        }

        start >= begin || (start = begin);

        let start_token = tokens[start];
        let end_token = tokens[end];
        node.range = [start_token.range[0], end_token.range[1]];
        node.loc = {
            start: start_token.loc.start,
            end: end_token.loc.end
        }
        context[CONTEXT.start] = start;
        context[CONTEXT.end] = end;
        return node;
    }
    finallize(
        context: Context,
        record: Extreme
    ) {
        let [_, left, right, matched/*, steps*/] = record;
        let validator = matched[MATCHED.validator];
        let collected: any;
        let start: number, end: number;
        context[CONTEXT.left] = left;
        context[CONTEXT.right] = right;
        context[CONTEXT.matched] = matched;
        let tokens = context[CONTEXT.tokens];
        let handler = matched[MATCHED.handler];
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
        context[CONTEXT.tokens] = tokens;
        if (!collected) {
            return collected === undefined || collected === false
                ? 0
                : (collected === null ? 1 : -1);
        }
        //debugger;
        /*if (tokens === this.tokens) {
            debugger;
        }*/

        let length = end - start + 1;
        if (collected instanceof Array) {
            tokens.splice(start, length, ...collected);
        } else {
            tokens.splice(start, length, collected);
        }
        return length;
    }
}
