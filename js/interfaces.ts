import Parser from './parser'

interface Position {
    line: number,// >=0
    column: number// >=0
}
interface SourceLocation {
    start: Position,
    end: Position
}

interface Node {
    type?: string | number,
    range?: [number, number],
    loc?: SourceLocation,
    [propName: string]: any
}

interface Token extends Node {
    value?: any,
    content?: any,
    regex?: { pattern: string, flags: string },
    [propName: string]: any
}
interface Expression extends Node {
    elements?: Array<Expression>,
    expressions?: Array<Expression>
}

type Program = Expression;
type MatchTree = Record<
    string,
    any
//(...args: any) => any | { [propName: string]: MatchTree }
>;
type SearchTree = MatchTree | Record<
    string,
    number | string | Array<string>
>;

const enum NUMERIC_TYPE {
    BINARY = 0b1 << 0,
    OCTAL = 0b1 << 1,
    DECIMAL = 0b1 << 2,
    HEX = 0b1 << 3,
    //INTEGER = 0b1 << 4,
    FLOAT = 0b1 << 5,
    E = 0b1 << 6,
    NAN = 0b1 << 7,
}

const enum CONTEXT {
    collected,
    parser,
    left,
    right,
    start,
    end,
    begin,
    tokens,
    rightAssociativeNode,
    matched,
    bindingSet,
    labelSet,
    strict,
    isModule,
    isExpression,
    inFunctionBody,
    inIteration,
    inSwitch,
    bindingElement,
    spreadElement,
    allowAwait,
    allowYield,
    length
}
interface Context extends Array<any> {
    [CONTEXT.collected]?: Record<string, Node | string | any | Array<Node | string | any>>,
    [CONTEXT.parser]: Parser,
    [CONTEXT.left]?: number,
    [CONTEXT.right]?: number,
    [CONTEXT.start]?: number,
    [CONTEXT.end]?: number,
    [CONTEXT.begin]?: number,
    [CONTEXT.tokens]?: Array<Node>,
    [CONTEXT.rightAssociativeNode]?: Node,
    [CONTEXT.matched]?: Matched,
    [CONTEXT.bindingSet]?: Array<string>,
    [CONTEXT.labelSet]?: Array<string>,
    [CONTEXT.strict]?: boolean,
    [CONTEXT.isModule]?: boolean,
    [CONTEXT.isExpression]?: boolean,
    [CONTEXT.inIteration]?: boolean,
    [CONTEXT.inFunctionBody]?: number,
    [CONTEXT.inSwitch]?: boolean,
    [CONTEXT.bindingElement]?: boolean,
    [CONTEXT.spreadElement]?: boolean,

    [CONTEXT.allowAwait]?: boolean,
    [CONTEXT.allowYield]?: boolean,

    tokens: Array<Token>,
    getToken(index: number): Token,
    wrap(key: number, value: any): Context,
    unwrap(): Context,
    store(...args: Array<CONTEXT | any>): number,
    restore(point: number): number,
}
/*
const enum MATCH_STATUS {
    END = 1,
    ERROR = -1,
    NEXT = 2,
    ATTACH = 3
}*/

interface Wrapper {
    (): void,
    [propName: string]: any
}
const enum MATCHED {
    precedence,
    props,
    wrapper,
    handler,
    validator,
    filter,
}
interface Mark {
    key: string,
    value: string,
    data: (context: Context, index: number) => any
}
interface Cover {
    origin: any,
    value: any
}
type Operation = null | 0 | undefined | false;
type NodeProp = [string | Cover | Mark, number, Array<Pipe> | undefined] /*| Mark*/;
type Pipe = (context: Context, token: Token | null, index: number) => any | undefined;
type Connector = (context: Context, index: number) => void;
interface Matched extends Array<any> {
    [MATCHED.precedence]: Precedence,
    [MATCHED.props]: Array<NodeProp>,
    [MATCHED.wrapper]: Wrapper,
    [MATCHED.handler]?: (context: Context) => Operation | Node | Array<Node>,
    [MATCHED.validator]?: (context: Context) => Operation | true | Node | Array<Node>,
    [MATCHED.filter]?: (context: Context, left?: number, right?: number) => boolean,
}

const enum MATCHED_RECORDS {
    precedence,
    left,
    right,
    matched
}
interface MatchedRecords extends Array<any> {
    [MATCHED_RECORDS.precedence]: Precedence,
    [MATCHED_RECORDS.left]: number,
    [MATCHED_RECORDS.right]: number,
    [MATCHED_RECORDS.matched]: Matched
}


const enum PRECEDENCE {
    VALUE,
    RIGHT_ASSOCIATIVE
}
interface Precedence extends Array<any> {
    [PRECEDENCE.VALUE]: number | true,
    [PRECEDENCE.RIGHT_ASSOCIATIVE]: number | Number
}
type Validate = (token: Token) => boolean;


const enum MARKS {
    BOUNDARY = "",
    DEEPTH = " DEEP",
    IDENTIFIER = " ID",
    END = " END",
    TYPE_ONLY = " TYPE",
    WALKER = " WAL",
    TERMINAL = " TER",

    EOF = "",
    ESCAPE = "\\",

    ERROR = " ERR",
    NEXT = " NEXT",
    RESET = " RESET",
    ATTACH = " ATT",
    STRING = " STR"

    /*
    FOLLOW = " FOLLOW",
    NOT = " NOT",
    OR = " OR",
    AND = " AND",*/
}


enum NUMERIC_KEYWORD_MAPPINGS {
    "." = NUMERIC_TYPE.FLOAT | NUMERIC_TYPE.DECIMAL,
    "x" = NUMERIC_TYPE.HEX,
    "b" = NUMERIC_TYPE.BINARY,
    "o" = NUMERIC_TYPE.OCTAL,

    "X" = NUMERIC_TYPE.HEX,
    "B" = NUMERIC_TYPE.BINARY,
    "O" = NUMERIC_TYPE.OCTAL,
};
export {
    NUMERIC_KEYWORD_MAPPINGS,
    MARKS,
    Validate,
    PRECEDENCE, Precedence,
    NodeProp,
    Mark, Cover,
    Pipe,
    Connector,
    Position,
    SourceLocation,
    MATCHED_RECORDS,
    MatchedRecords,
    Matched,
    MATCHED,
    Token, Context,
    CONTEXT, Expression,
    Program, NUMERIC_TYPE, MatchTree, SearchTree,/* Tokenizer, Parser,*/ Node
}