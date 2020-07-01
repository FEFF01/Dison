import Parser from './parser';
interface Position {
    line: number;
    column: number;
}
interface SourceLocation {
    start: Position;
    end: Position;
}
interface Node {
    type?: string | number;
    range?: [number, number];
    loc?: SourceLocation;
    [propName: string]: any;
}
interface Token extends Node {
    value?: any;
    content?: Array<Token>;
    regex?: {
        pattern: string;
        flags: string;
    };
    [propName: string]: any;
}
interface Expression extends Node {
    elements?: Array<Expression>;
    expressions?: Array<Expression>;
}
declare type Program = Expression;
declare type MatchTree = Record<string, Function | {
    [propName: string]: MatchTree;
}>;
declare type SearchTree = MatchTree | Record<string, number | string | Array<string>>;
declare const enum NUMERIC_TYPE {
    BINARY = 1,
    OCTAL = 2,
    DECIMAL = 4,
    HEX = 8,
    FLOAT = 32,
    E = 64,
    NAN = 128
}
declare const enum CONTEXT {
    collected = 0,
    parser = 1,
    tokens = 2,
    left = 3,
    right = 4,
    start = 5,
    end = 6,
    begin = 7,
    rightAssociativeNode = 8,
    matched = 9,
    bindingSet = 10,
    labelSet = 11,
    strict = 12,
    isModule = 13,
    isExpression = 14,
    inFunctionBody = 15,
    inIteration = 16,
    inSwitch = 17,
    bindingElement = 18,
    spreadElement = 19,
    allowAwait = 20,
    allowYield = 21,
    length = 22
}
interface Context extends Array<any> {
    [CONTEXT.collected]?: Record<string, Node | string | any | Array<Node | string | any>>;
    [CONTEXT.parser]: Parser;
    [CONTEXT.tokens]: Array<Node>;
    [CONTEXT.left]?: number;
    [CONTEXT.right]?: number;
    [CONTEXT.start]?: number;
    [CONTEXT.end]?: number;
    [CONTEXT.begin]?: number;
    [CONTEXT.rightAssociativeNode]?: Node;
    [CONTEXT.matched]?: Matched;
    [CONTEXT.bindingSet]?: Array<string>;
    [CONTEXT.labelSet]?: Array<string>;
    [CONTEXT.strict]?: boolean;
    [CONTEXT.isModule]?: boolean;
    [CONTEXT.isExpression]?: boolean;
    [CONTEXT.inIteration]?: boolean;
    [CONTEXT.inFunctionBody]?: Array<Node>;
    [CONTEXT.inSwitch]?: Array<Node>;
    [CONTEXT.bindingElement]?: Array<Node>;
    [CONTEXT.spreadElement]?: Array<Node>;
    [CONTEXT.allowAwait]?: boolean;
    [CONTEXT.allowYield]?: boolean;
    wrap(key: number, value: any): Context;
    unwrap(): Context;
    store(...args: Array<CONTEXT | any>): number;
    restore(point: number): number;
}
declare const enum MATCH_STATUS {
    END = 1,
    ERROR = -1,
    NEXT = 2,
    ATTACH = 3
}
interface Wrapper {
    (): void;
    [propName: string]: any;
}
declare const enum MATCHED {
    precedence = 0,
    props = 1,
    wrapper = 2,
    handler = 3,
    validator = 4,
    filter = 5
}
interface Mark {
    key: string;
    value: string;
}
declare type Operation = null | 0 | undefined | false;
declare type NodeProp = [string | null, Array<Watcher> | undefined] | Mark;
declare type Watcher = (context: Context, token: Token | null) => void;
interface Matched extends Array<any> {
    [MATCHED.precedence]: number | Number;
    [MATCHED.props]: Array<NodeProp>;
    [MATCHED.wrapper]: Wrapper;
    [MATCHED.handler]?: (context: Context) => Operation | Node | Array<Node>;
    [MATCHED.validator]?: (context: Context) => Operation | true | Node | Array<Node>;
    [MATCHED.filter]?: (context: Context, left?: number, right?: number) => boolean;
}
declare const enum MATCHED_RECORDS {
    precedence = 0,
    left = 1,
    right = 2,
    matched = 3
}
interface MatchedRecords extends Array<any> {
    [MATCHED_RECORDS.precedence]: number | Number;
    [MATCHED_RECORDS.left]: number;
    [MATCHED_RECORDS.right]: number;
    [MATCHED_RECORDS.matched]: Matched;
}
export { NodeProp, Mark, Watcher, Position, SourceLocation, MATCHED_RECORDS, MatchedRecords, Matched, MATCHED, Token, Context, CONTEXT, Expression, Program, NUMERIC_TYPE, MATCH_STATUS, MatchTree, SearchTree, /* Tokenizer, Parser,*/ Node };
