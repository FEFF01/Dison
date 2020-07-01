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
    content?: Array<Token>,
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
    Function | { [propName: string]: MatchTree }
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
    tokens,
    left,
    right,
    start,
    end,
    begin,
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
    [CONTEXT.tokens]: Array<Node>,
    [CONTEXT.left]?: number,
    [CONTEXT.right]?: number,
    [CONTEXT.start]?: number,
    [CONTEXT.end]?: number,
    [CONTEXT.begin]?: number,
    [CONTEXT.rightAssociativeNode]?: Node,
    [CONTEXT.matched]?: Matched,
    [CONTEXT.bindingSet]?: Array<string>,
    [CONTEXT.labelSet]?: Array<string>,
    [CONTEXT.strict]?: boolean,
    [CONTEXT.isModule]?: boolean,
    [CONTEXT.isExpression]?: boolean,
    [CONTEXT.inIteration]?: boolean,
    [CONTEXT.inFunctionBody]?: Array<Node>,
    [CONTEXT.inSwitch]?: Array<Node>,
    [CONTEXT.bindingElement]?: Array<Node>,
    [CONTEXT.spreadElement]?: Array<Node>,

    [CONTEXT.allowAwait]?: boolean,
    [CONTEXT.allowYield]?: boolean,


    wrap(key: number, value: any): Context,
    unwrap(): Context,
    store(...args: Array<CONTEXT | any>): number,
    restore(point: number): number,
    //getToken(index: number): Token
}

const enum MATCH_STATUS {
    END = 1,
    ERROR = -1,
    NEXT = 2,
    ATTACH = 3
}

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
    value: string
}
type Operation = null | 0 | undefined | false;
type NodeProp = [string | null, Array<Watcher> | undefined] | Mark;
type Watcher = (context: Context, token: Token | null) => void;
interface Matched extends Array<any> {
    [MATCHED.precedence]: number | Number,
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
    [MATCHED_RECORDS.precedence]: number | Number,
    [MATCHED_RECORDS.left]: number,
    [MATCHED_RECORDS.right]: number,
    [MATCHED_RECORDS.matched]: Matched
}
export {
    NodeProp,
    Mark,
    Watcher,
    Position,
    SourceLocation,
    MATCHED_RECORDS,
    MatchedRecords,
    Matched,
    MATCHED,
    Token, Context,
    CONTEXT, Expression,
    Program, NUMERIC_TYPE, MATCH_STATUS, MatchTree, SearchTree,/* Tokenizer, Parser,*/ Node
}