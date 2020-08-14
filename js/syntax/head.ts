


import {
    NodeProp,
    Cover as CoverInterface,
    Mark as MarkInterface,
    Node, Pipe, Connector,
    Matched, CONTEXT, Context, Token, SourceLocation,
    MATCHED,
    /*PRECEDENCE_FEATURES,*/ PRECEDENCE, Precedence as PrecedenceInterface, MATCHED_RECORDS, Validate,
} from '../interfaces';

import Tokenizer from "../tokenizer"
import { TOKEN_TYPE_ENUMS } from '../lexical/index'
let type_punctuator = TOKEN_TYPE_ENUMS.Punctuator;
let type_keyword = TOKEN_TYPE_ENUMS.Keyword;
let type_identifier = TOKEN_TYPE_ENUMS.Identifier;


function _Punctuator(...values: Array<string | number>) {
    values.unshift(type_punctuator);
    return _Or(values);
}
function _Keyword(...values: Array<string | number>) {
    values.unshift(type_keyword);
    return _Or(values);
}
function _Identifier(...values: Array<string | number>) {
    values.unshift(type_identifier);
    return _Or(values);
}
function _Pattern(...args: Array<string | number>) {
    return _Or(args);
}

import Parser from '../parser'
const enum MATCH_MARKS {
    BOUNDARY = "",
    DEEPTH = " DEEP",
    IDENTIFIER = " ID",
    MATCH_END = " END",
    TYPE_ONLY = " TYPE",
    WALKER = " WAL",
    TERMINAL = " TER"
    /*
    FOLLOW = " FOLLOW",
    NOT = " NOT",
    OR = " OR",
    AND = " AND",*/
}
let OPERATOR_ID = 0;

function _calc_nth(props: Array<NodeProp>, key: string | Mark | Cover) {
    let nth = 0;
    if (!(key instanceof Cover) && props.length) {
        key instanceof Mark && (key = key.key);
        for (let i = props.length - 1; i >= 0; i--) {
            let prop = props[i], _key = prop[0];
            if (
                _key === key
                || _key instanceof Mark
                && _key.key === key
                && (_key.value !== undefined || _key.data !== Mark.prototype.data)
            ) {
                if (prop[1] === 0) {
                    prop = props[i] = [prop[0], 1, prop[2]];
                }
                nth = prop[1] + 1;
            } else if (
                !(_key instanceof Cover && _key.origin === key)
            ) {
                break;
            }
        }
    }
    return nth;
}

abstract class Operator {
    private _factors: Array<[string | number, Array<string | number>] | Operator | Mark>;
    private _pipes: Array<Pipe>;
    private _walker: Connector;
    private _bind_env: boolean;
    public sub_operators = [];
    public test: (token: Token, index?: number) => boolean;
    constructor(public operands: Operands) { }
    public pipe(pipe: Pipe) {
        if (this._pipes) {
            this._pipes.push(pipe);
        } else {
            this._pipes = [pipe];
        }
        return this;
    }
    public walk(walker: Connector, bind_env?: boolean) {
        this._walker = walker;
        this._bind_env = !!bind_env;
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
                        operand;
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
    abstract attach(parents: IterationRecord, key: string | Cover, pipes?: Array<Pipe>): IterationRecord;

    protected map(
        parents: IterationRecord,
        factor: [string | number, Array<string | number>] | Operator | Mark,
        key: string | Cover,
        pipes?: Array<Pipe>
    ) {
        let result: IterationRecord = [];
        let _pipes = pipes
            ? this._pipes ?
                this._pipes.concat(pipes)
                : pipes
            : this._pipes;
        if (factor instanceof Operator || factor instanceof Mark) {
            return factor.attach(parents, key, _pipes);
        } else {
            let type = factor[0], values = factor[1];
            for (const prev_item of parents) {
                let [root, props] = prev_item;
                props = props.slice();
                props.push([key, _calc_nth(props, key), _pipes]);
                let parent = this.getNode(root, type);

                let walker = this._walker;
                if (walker && this._bind_env) {
                    walker = walker.bind(
                        props.reduce((res, prop) => {
                            let key = prop[0];
                            if (key instanceof Mark) {
                                res[key.key] = key.value;
                            } else {
                                res[key instanceof Cover ? key.origin : key] = true;
                            }
                            return res;
                        }, {})
                    );
                }

                for (const value of values) {
                    let value_node = this.getNode(parent, value, root);
                    if (
                        value_node[MATCH_MARKS.WALKER]
                        && value_node[MATCH_MARKS.WALKER] !== walker
                    ) {
                        console.warn(
                            "conflict:",
                            value_node,
                            value_node[MATCH_MARKS.WALKER],
                            walker
                        );
                    }
                    if (walker) {
                        value_node[MATCH_MARKS.WALKER] = walker;
                    }
                    result.push(
                        [
                            value_node,
                            props,
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
        if (root) {
            child[MATCH_MARKS.DEEPTH] = root[MATCH_MARKS.DEEPTH] + 1;
            root[MATCH_MARKS.TERMINAL] = false;
            child[MATCH_MARKS.TERMINAL] = true;
            /*if (root[MATCH_MARKS.MATCH_END]) {
                root[MATCH_MARKS.MATCH_END][MATCHED_RECORDS.precedence][PRECEDENCE.TERMINAL] = false;
            }*/
        }
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
    protected getDeepNodes(parents: IterationRecord, key: string | Cover, pipes?: Array<Pipe>) {
        let children = parents, factors = this.factors;
        for (const factor of factors) {
            children = this.map(children, factor, key, pipes);
        }
        return children;
    }
    protected getNextNodes(parents: IterationRecord, key: string | Cover, pipes?: Array<Pipe>) {
        let children = [], factors = this.factors;
        for (const factor of factors) {
            Array.prototype.push.apply(children, this.map(parents, factor, key, pipes));
        }
        return children;
    }
}

type Operand = string | /*number |*/ Operator | Mark | Array<string | number>;
type Operands = Array<Operand>;
type IterationRecordItem = [
    Record<string, any>,
    Array<NodeProp>,
    [Record<string, any>, string, string, IterationRecordItem] | null
]
type IterationRecord = Array<IterationRecordItem>;

class Option extends Operator {
    attach(parents: IterationRecord, key: string, pipes?: Array<Pipe>) {
        let children = this.getNextNodes(parents, key, pipes).concat(parents);
        return children;
    }
}
class Or extends Operator {
    attach(parents: IterationRecord, key: string, pipes?: Array<Pipe>) {
        return this.getNextNodes(parents, key, pipes);
    }
}

class Series extends Operator {
    attach(parents: IterationRecord, key: string, pipes?: Array<Pipe>) {
        return this.getDeepNodes(parents, key, pipes);
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
class Cover implements CoverInterface {
    constructor(public origin: any, public value: any) {
        if (origin instanceof Cover) {
            this.origin = origin.origin;
        }
    }
}
class NonCapturing extends Operator {
    attach(parents: IterationRecord, key: string | Cover, pipes?: Array<Pipe>) {
        return this.getNextNodes(parents, new Cover(key, null), pipes);
    }
}

class NonCollecting extends Operator {
    attach(parents: IterationRecord, key: string | Cover, pipes?: Array<Pipe>) {
        return this.getNextNodes(parents, new Cover(key, ""), pipes);
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

class Mark implements MarkInterface {
    static MATCHED_RECORD: Matched;
    public key: string;
    public value: any;
    constructor(value?: any) {
        if (typeof value === "function") {
            this.data = value;
        } else {
            this.value = value;
        }
    }
    data(context: Context, index: number) {
        return this.value;
    }
    attach(parents: IterationRecord, key: string | Cover, pipes?: Array<Pipe>) {
        let value = this.value;
        if (!(key instanceof Cover) && (value !== undefined || this.data !== Mark.prototype.data)) {
            if (key === "type") {
                Mark.MATCHED_RECORD[MATCHED.wrapper] = _get_wrapper_function(value);;
            } else {
                let result: IterationRecord = [];
                this.key = key;
                for (const parent of parents) {
                    let props = parent[1].slice();
                    props.push([this, _calc_nth(props, this), undefined]);
                    result.push([parent[0], props, parent[2]]);
                }
                return result;
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
        this.type = "Grouping";
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
    Script(body: Array<Node>) {
        this.type = "Program";
        this.sourceType = "script";
        this.body = body;
    },
    Module(body: Array<Node>) {
        this.type = "Program";
        this.sourceType = "module";
        this.body = body;
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
            = type ? eval(`(function ${type}(){this.type="${type}"})`) : function () { }
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
                    precedence: precedences = true/*PRECEDENCE_FEATURES.IMMEDIATE*/,
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

                    let precedence: any = _get_adapt(precedences, index);
                    let handler: Matched[MATCHED.handler] = _get_adapt(handlers, index);
                    let filter: Matched[MATCHED.filter] = _get_adapt(filters, index);
                    let validator: Matched[MATCHED.validator] = _get_adapt(validators, index);
                    Mark.MATCHED_RECORD = [
                        [precedence instanceof Number ? Number(precedence) : precedence, precedence],
                        null,
                        wrapper,
                        handler,
                        validator,
                        filter
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

function _Context(parser: Parser): Context {
    let state_stack = [];
    let context: any = new Array(CONTEXT.length);
    context[CONTEXT.parser] = parser;
    context[CONTEXT.labelSet] = [];
    //context[CONTEXT.tokens] = tokens;
    context.wrap = wrap;
    context.unwrap = unwrap;
    context.store = store;
    context.restore = restore;
    context.getToken = getToken;
    Object.defineProperty(context, "tokens", {
        get() {
            return this[CONTEXT.tokens] || this[CONTEXT.parser].tokens;
        }
    })
    return context;

    function getToken(index: number) {
        let tokens = this[CONTEXT.tokens];
        return !tokens ? this[CONTEXT.parser].getToken(index) : tokens[index];
        //return context[CONTEXT.tokens][index];
    }
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
function _if_reserved_throw_err(context: Context, token: Token) {
    validateIdentifier(context, token);
}
const THROW_RESTRICT_WORDS_PATTERN = _Or(
    "Identifier eval arguments"
).pipe(_if_strict_throw_err);
const THROW_STRICT_RESERVED_WORDS_PATTERN = _Or(
    "Identifier implements interface package private protected public static yield let"
).pipe(_if_strict_throw_err);

const IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN = _Or("Identifier", THROW_STRICT_RESERVED_WORDS_PATTERN);
const EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN = _Or("[Expression]", THROW_STRICT_RESERVED_WORDS_PATTERN);

const IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN = _Or("Identifier").pipe(_if_reserved_throw_err);
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
function validateLineTerminator(context: Context) {
    let [collected, parser, , right] = context;
    if (collected._next) {
        delete collected._next;
    } else {
        let next_token = context.getToken(right + 1);
        if (
            next_token
            && !(next_token.type === TOKEN_TYPE_ENUMS.Punctuator && next_token.value === "}")
            && next_token.loc.start.line === collected.loc.end.line
        ) {
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
    let tokens = context.tokens;
    for (let index = left; index < right; index++) {
        if (tokens[index].loc.end.line !== tokens[index + 1].loc.start.line) {
            return false;
        }
    }
    return true;
}

function attachLocation(source: Node, start: Node, end: Node = start) {
    source.range = [start.range[0], end.range[1]];
    source.loc = {
        start: start.loc.start,
        end: end.loc.end
    };
}


function reinterpretKeywordAsIdentifier({ value, range, loc }: Token, tokenizer?: Tokenizer): Node {
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
function reinterpretIdentifierAsKeyword({ value, range, loc }: Token): Node {
    return {
        type: "Keyword",
        value,
        range,
        loc
    };
}

function _Validate(type: string | number, value: string): Validate {
    return function (token: Token) {
        return token.type === type && token.value === value;
    }
}


let is_right_parentheses = _Validate(type_punctuator, ")");
let is_right_brackets = _Validate(type_punctuator, "]");
let is_right_braces = _Validate(type_punctuator, "}");
export {
    _Punctuator,
    _Keyword,
    _Identifier,
    _Pattern,
    is_right_parentheses,
    is_right_brackets,
    is_right_braces,
    _Validate,
    reinterpretIdentifierAsKeyword,
    reinterpretKeywordAsIdentifier,
    attachLocation,
    Cover,
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
