


import {
    NodeProp,
    Mark as MarkInterfact,
    Node, Watcher,
    Matched, CONTEXT, Context, Token, SourceLocation,
    MATCHED
} from '../interfaces';

import Parser from '../parser'
const enum MATCH_MARKS {
    BOUNDARY = "",
    DEEPTH = " DEEP",
    IDENTIFIER = " ID",
    MATCH_END = " END",
    TYPE_ONLY = " TYPE"
    /*
    FOLLOW = " FOLLOW",
    NOT = " NOT",
    OR = " OR",
    AND = " AND",*/
}
let OPERATOR_ID = 0;
abstract class Operator {
    private _factors: Array<[string | number, Array<string | number>] | Operator | Mark>;
    private _watcher: Array<Watcher>;
    public sub_operators = [];
    public test: (token: Token, index?: number) => boolean;
    constructor(public operands: Operands) { }
    public watch(watcher: Watcher) {
        if (this._watcher) {
            this._watcher.push(watcher);
        } else {
            this._watcher = [watcher];
        }
        return this;
    }
    public get factors() {
        if (!this._factors) {
            this._factors = [];
            for (const operand of this.operands) {
                if (operand instanceof Operator || operand instanceof Mark) {
                    this._factors.push(operand);
                } else {
                    let parts = typeof operand === "string" ?
                        operand.replace(/^\s+|\s+$/g, "").split(/\s+/) :
                        [operand];
                    this._factors.push(
                        [
                            parts[0],
                            parts.length > 1
                                ? parts.slice(1)
                                : [MATCH_MARKS.TYPE_ONLY]
                        ]);
                }
            }
        }
        return this._factors;
    }
    abstract attach(parents: IterationRecord, key: string | null, watchers?: Array<Watcher>): IterationRecord;
    protected map(
        parents: IterationRecord,
        factor: [string | number, Array<string | number>] | Operator | Mark,
        key: string | null,

        watchers?: Array<Watcher>
    ) {
        let result: IterationRecord = [];
        let _watcher = watchers
            ? this._watcher ?
                this._watcher.concat(watchers)
                : watchers
            : this._watcher;
        if (factor instanceof Operator || factor instanceof Mark) {
            return factor.attach(parents, key, _watcher);
        } else {
            for (const prev_item of parents) {
                let [root, keys] = prev_item;
                (keys = keys.slice()).push([key, _watcher]);
                let parent = this.getNode(root, factor[0]);
                for (const value of factor[1]) {
                    result.push(
                        [
                            this.getNode(parent, value, root),
                            keys,
                            null/*[root, factor[0], value, prev_item]//Loop*/
                        ]
                    );
                }
            }

        }
        return result;
    }
    private getNode(parent: any, key: string | number, root?: any) {
        let child = parent[key];
        if (child) {
            if (child[MATCH_MARKS.IDENTIFIER] !== OPERATOR_ID) {
                parent[key] = child = { ...child };
                child[MATCH_MARKS.IDENTIFIER] = OPERATOR_ID;
            }
            return child;
        }

        child = parent[key] = {
            [MATCH_MARKS.IDENTIFIER]: OPERATOR_ID
        };
        root && (child[MATCH_MARKS.DEEPTH] = root[MATCH_MARKS.DEEPTH] + 1);
        return child;
    }
    protected setWrap(records: IterationRecord) {//Loop
        throw 'not used';
        for (const record of records) {
            let prev_item = record, curr_item = prev_item;
            while ((curr_item = prev_item[2] && prev_item[2][3]) && curr_item[2]) {
                prev_item = curr_item;
            }
            if (prev_item[2]) {
                let linked = prev_item[2];
                let node = this.getNode(record[0], linked[1]);
                if (node[linked[2]] && node[linked[2]] !== prev_item[0]) {
                    throw node[linked[2]];
                }
                node[linked[2]] = prev_item[0];
            }
        }
        return records;
    }
    protected getDeepNodes(parents: IterationRecord, key: string | null, watchers?: Array<Watcher>) {
        let children = parents, factors = this.factors;
        for (const factor of factors) {
            children = this.map(children, factor, key, watchers);
        }
        return children;
    }
    protected getNextNodes(parents: IterationRecord, key: string | null, watchers?: Array<Watcher>) {
        let children = [], factors = this.factors;
        for (const factor of factors) {
            Array.prototype.push.apply(children, this.map(parents, factor, key, watchers));
        }
        return children;
    }
}

type Operand = string | number | Operator | Mark;
type Operands = Array<Operand>;
type IterationRecordItem = [
    Record<string, any>,
    Array<NodeProp>,
    [Record<string, any>, string, string, IterationRecordItem] | null
]
type IterationRecord = Array<IterationRecordItem>;

class Option extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>) {
        let children = this.getNextNodes(parents, key, watchers).concat(parents);
        return children;
    }
}
class Or extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>) {
        return this.getNextNodes(parents, key, watchers);
    }
}

class Series extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>) {
        return this.getDeepNodes(parents, key, watchers);
    }
}
/*
class And extends Operator  {
    attach(parents: IterationRecord, key: string) {
        throw "not used";
        return [];
    }
}
class Not extends Operator {
    attach(parents: IterationRecord, key: string) {
        throw "not used";
        return [];
        
    }
}*/
class NonCapturing extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>) {
        return this.getNextNodes(parents, null, watchers);
    }
}

class NonCollecting extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>) {
        return this.getNextNodes(parents, "", watchers);
    }
}

class Loop extends Operator {
    //Loop 内部的 Option 可能会导致 Loop 取值混乱(当前用不到这种情况，不处理这种情况能减少消耗)
    attach(parents: IterationRecord, key: string) {
        throw 'not used';
        //有点耗费性能，不是很必要用这个，已在parser核心部分去除Loop的支持
        let baks = [];
        for (const parent of parents) {
            baks.push(parent[2]);
            parent[2] = null;
        }
        let res = this.setWrap(this.getNextNodes(parents, key));
        for (const index in parents) {
            parents[index][2] = baks[index];
        }
        return res;
    }
}

class Mark implements MarkInterfact {
    static MATCHED_RECORD: Matched;
    public key: string;
    public value: any;
    constructor(value?: any) {
        if (typeof value === "function") {
            Object.defineProperty(this, "value", {
                configurable: true,
                enumerable: true,
                get: value
            });
        } else {
            this.value = value;
        }
    }
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>) {
        let value = this.value;
        if (key && value !== undefined) {
            if (key === "type") {
                Mark.MATCHED_RECORD[MATCHED.wrapper] = _get_wrapper_function(value);;
            } else {
                this.key = key;
                for (const parent of parents) {
                    parent[1] = parent[1].concat(this);
                }
            }
        }
        return parents;
    }
}

function _Option(...some: Operands) {
    return new Option(some);
}
/*
function _Not(...some: Operands) {
    return new Not(some);
}
function _And(...some: Operands) {
    return new And(some);
}*/
function _Or(...some: Operands) {
    return new Or(some);
}
function _Series(...some: Operands) {
    return new Series(some);
}
function _NonCapturing(...some: Operands) {
    return new NonCapturing(some);
}
function _NonCollecting(...some: Operands) {
    return new NonCollecting(some);
}


function _Loop(...some: Operands) {
    return new Loop(some);
}
function _Mark(some?: any) {
    return new Mark(some);
}
let NODES: Record<string, (...args: any) => void> = {
    Grouping(node?: Record<string, any>, grouping?: Token) {
        for (const key in node) {
            this[key] = node[key];
        }
        if (grouping) {
            this.range = grouping.range;
            this.loc = grouping.loc;
        }
    },
    Directive(
        type: string,
        expression: Node,
        directive: string,
        range: [number, number],
        loc: SourceLocation
    ) {
        this.type = type;
        this.expression = expression;
        this.directive = directive;
        this.range = range;
        this.loc = loc;
    },
    Script(body: Array<Node>, range: [number, number], loc: SourceLocation) {
        this.type = "Program";
        this.sourceType = "script";
        this.body = body;
        this.range = range;
        this.loc = loc;
    },
    Module(body: Array<Node>, range: [number, number], loc: SourceLocation) {
        this.type = "Program";
        this.sourceType = "module";
        this.body = body;
        this.range = range;
        this.loc = loc;
    }
};
function _get_adapt(data: any, index: number) {
    return data instanceof Array ? index < data.length
        ? data[index]
        : data[data.length - 1] : data;
}
function _get_wrapper_function(type: string) {
    return NODES[type]
        || (
            NODES[type]
            = eval(`(function ${type}(){this.type="${type}"})`)
        );
}
function createMatchTree(
    data: Record<string, any> | Array<Record<string, any>>,
    root?: Record<string, any>,
    block_list: Array<string> = [],
    prevent_update = false
) {
    prevent_update || (OPERATOR_ID += 1);
    root = root ? prevent_update ? root : { ...root } : { [MATCH_MARKS.DEEPTH]: -1 };

    if (data instanceof Array) {
        for (const item of data) {
            root = createMatchTree(item, root, block_list, true);
        }
    } else {
        for (const type in data) {
            let wrapper = _get_wrapper_function(type);
            for (let item of data[type] instanceof Array ? data[type] : [data[type]]) {
                let {
                    collector: collectors,
                    handler: handlers,
                    overload,
                    precedence: precedences = 100,
                    filter: filters,
                    validator: validators
                } = item;
                if (!collectors || ~block_list.indexOf(type)) {
                    continue;
                }
                typeof filters === "string" && (filters = data[filters].filter);
                typeof handlers === "string" && (handlers = data[handlers].handler);
                typeof validators === "string" && (validators = data[validators].validator);
                collectors instanceof Array || (collectors = [collectors]);

                for (let index = 0; index < collectors.length; index++) {
                    let collector = collectors[index];

                    let precedence: Matched[MATCHED.precedence] = _get_adapt(precedences, index);
                    let handler: Matched[MATCHED.handler] = _get_adapt(handlers, index);
                    let filter: Matched[MATCHED.filter] = _get_adapt(filters, index);
                    let validator: Matched[MATCHED.validator] = _get_adapt(validators, index);
                    Mark.MATCHED_RECORD = [
                        precedence, null, wrapper, handler, validator, filter
                    ];
                    if (collector instanceof Array) {
                        let _collector = { ...collectors[index - 1] };
                        collector[0] && !(collector[0] instanceof Array) && (collector = [collector]);
                        for (const [key, value] of collector) {
                            _collector[key] = value;
                        }
                        collectors[index] = collector = _collector;
                    }

                    let nodes: IterationRecord = [[root, [], null]];

                    //保证所有 key 都是同类型字符开头(否则可能会出现遍历顺序与定义顺序不同)
                    for (const key in collector) {
                        let operator = collector[key];
                        if (!(operator instanceof Operator || operator instanceof Mark)) {
                            operator = _Or(operator);
                        }
                        nodes = operator.attach(nodes, key);
                    }

                    for (const [last_node, props] of nodes) {
                        let matched_record = Mark.MATCHED_RECORD.slice();
                        matched_record[MATCHED.props] = props;
                        if (!overload && last_node[MATCH_MARKS.MATCH_END]) {
                            console.warn(
                                "conflict:",
                                last_node,
                                last_node[MATCH_MARKS.MATCH_END],
                                matched_record
                            );
                        }
                        last_node[MATCH_MARKS.MATCH_END] = matched_record
                    }
                }

            }
        }
    }
    return root;

}




function _Context(parser: Parser, tokens: Array<Node>): Context {
    let state_stack = [];
    let context: any = new Array(CONTEXT.length);
    context[CONTEXT.parser] = parser;
    context[CONTEXT.tokens] = tokens;
    context[CONTEXT.labelSet] = [];
    context.wrap = wrap;
    context.unwrap = unwrap;
    context.store = store;
    context.restore = restore;
    //context.getToken = getToken;
    return context;

    /*function getToken(index: number) {
        return context[CONTEXT.tokens][index];
    }*/
    function wrap(key: CONTEXT, value: any) {
        state_stack.push(context[key], key);
        context[key] = value;
        return context;
    };
    function unwrap() {
        context[state_stack.pop()] = state_stack.pop();
        return context;
    };
    function store() {
        let restore_point = state_stack.length;
        for (let index = 0; index < arguments.length; index += 2) {
            wrap(arguments[index], arguments[index + 1]);
        }
        return restore_point;
    }
    function restore(point: number) {
        while (state_stack.length > point) {
            unwrap();
        }
        return state_stack.length;
    }
}
const FutureReservedWord = ["enum", "export", "import", "super"];
const StrictModeReservedWord = [
    "implements", "interface", "package", "private", "protected", "public", "static", "yield", "let"
];
const RestrictedWord = ["eval", "arguments"];

function isFutureReservedWord(id: string) {
    return FutureReservedWord.indexOf(id) >= 0;
}
function isStrictModeReservedWord(id: string) {
    return StrictModeReservedWord.indexOf(id) >= 0;
}
function isRestrictedWord(id: string) {
    return RestrictedWord.indexOf(id) >= 0;
}


function _if_strict_throw_err(context: Context, token: Token) {
    if (context[CONTEXT.strict]) {
        context[CONTEXT.parser].err(token);
    }
}
const THROW_RESTRICT_WORDS_PATTERN = _Or(
    "Identifier eval arguments"
).watch(_if_strict_throw_err);
const THROW_STRICT_RESERVED_WORDS_PATTERN = _Or(
    "Identifier implements interface package private protected public static yield let"
).watch(_if_strict_throw_err);

const IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN = _Or("Identifier", THROW_STRICT_RESERVED_WORDS_PATTERN);
const EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN = _Or("[Expression]", THROW_STRICT_RESERVED_WORDS_PATTERN);

const IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN = _Or("Identifier").watch(validateIdentifier);
const EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN = _Or(
    "[Expression]",
    IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN
);


/*const STRICT_RESERVED_WORDS = _Or(
    "Identifier implements interface package private protected public static yield let"
);*/
function validateIdentifier(context: Context, node: Node) {
    if (
        context[CONTEXT.strict]
    ) {
        if (!isStrictModeReservedWord(node.name)) {
            return true;
        }
        context[CONTEXT.parser].err(node);
        return false;
    }
}
function validateAssignment(context: Context, node: Node) {
    if (
        context[CONTEXT.strict]
    ) {
        if (!(
            isRestrictedWord(node.name)
            || isStrictModeReservedWord(node.name)
        )) {
            return true;
        }
        context[CONTEXT.parser].err(node);
        return false;
    }
}
function validateBinding(context: Context, node: Node) {
    if (validateAssignment(context, node) === true) {
        let binding_set = context[CONTEXT.bindingSet];
        if (binding_set) {
            binding_set.push(node.name);
            if (binding_set.indexOf(node.name) !== binding_set.length - 1) {
                context[CONTEXT.parser].err(node);
                return false;
            }
        }
        return true;
    }
}

function validateLineTerminator([collected, parser, tokens, , right]: Context) {
    if (collected._next) {
        delete collected._next;
    } else {
        let next_token = tokens[right + 1];
        if (next_token && next_token.loc.start.line === collected.loc.end.line) {
            parser.err(next_token);
        }
    }
    return collected;
}

let join_content = function ([collected]: Context) {
    let { success, content } = collected;
    if (success) {
        success.content.push(content);
        return success;
    } else {
        collected.content = [content];
        return collected;
    }
};

let TYPE_ALIAS = {};

const ASSIGNMENT_PUNCTUATORS_PATTERN = _Or("Punctuator = += -= **= *= /= %= <<= >>= >>>= &= ^= |=");

let AWAIT_LIST: Array<() => void> = [];

const MODULE_ITEM_PATTERN = _Or(
    "ImportDeclaration",
    "ExportAllDeclaration",
    "ExportNamedDeclaration",
    "ExportDefaultDeclaration"
);
const STATEMANT_LIST_ITEM_PATTERN = _Or("[Declaration]", "[Statement]");

const RIGHT_SIDE_TOPLEVEL_ITEM_PATTERN = _Or(
    "SwitchCase",
    MODULE_ITEM_PATTERN,
    STATEMANT_LIST_ITEM_PATTERN
);
const TOPLEVEL_ITEM_PATTERN = _Or(
    MATCH_MARKS.BOUNDARY,
    "SwitchCase",
    MODULE_ITEM_PATTERN,
    STATEMANT_LIST_ITEM_PATTERN
);

function isAligned(context: Context, left: number, right: number) {
    let tokens = context[CONTEXT.tokens];
    for (let index = left; index < right; index++) {
        if (tokens[index].loc.end.line !== tokens[index + 1].loc.start.line) {
            return false;
        }
    }
    return true;
}
export {
    Mark, isAligned,
    STATEMANT_LIST_ITEM_PATTERN,
    RIGHT_SIDE_TOPLEVEL_ITEM_PATTERN,
    TOPLEVEL_ITEM_PATTERN,
    AWAIT_LIST,
    join_content,
    IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
    EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
    IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
    EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
    ASSIGNMENT_PUNCTUATORS_PATTERN,
    validateBinding, validateLineTerminator,
    NODES,
    TYPE_ALIAS,
    MATCH_MARKS,
    createMatchTree,
    isRestrictedWord,
    isFutureReservedWord,
    isStrictModeReservedWord,
    validateIdentifier,
    validateAssignment,
    _Context,
    _Option, _Or, _Series, _NonCapturing, _NonCollecting, _Mark, _Loop,
}
