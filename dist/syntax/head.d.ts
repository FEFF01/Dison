import { NodeProp, Mark as MarkInterfact, Node, Watcher, Matched, Context, Token } from '../interfaces';
import Parser from '../parser';
declare const enum MATCH_MARKS {
    BOUNDARY = "",
    DEEPTH = " DEEP",
    IDENTIFIER = " ID",
    MATCH_END = " END",
    TYPE_ONLY = " TYPE"
}
declare abstract class Operator {
    operands: Operands;
    private _factors;
    private _watcher;
    sub_operators: any[];
    test: (token: Token, index?: number) => boolean;
    constructor(operands: Operands);
    watch(watcher: Watcher): this;
    get factors(): (Mark | Operator | [string | number, (string | number)[]])[];
    abstract attach(parents: IterationRecord, key: string | null, watchers?: Array<Watcher>): IterationRecord;
    protected map(parents: IterationRecord, factor: [string | number, Array<string | number>] | Operator | Mark, key: string | null, watchers?: Array<Watcher>): IterationRecord;
    private getNode;
    protected setWrap(records: IterationRecord): IterationRecord;
    protected getDeepNodes(parents: IterationRecord, key: string | null, watchers?: Array<Watcher>): IterationRecord;
    protected getNextNodes(parents: IterationRecord, key: string | null, watchers?: Array<Watcher>): any[];
}
declare type Operand = string | number | Operator | Mark;
declare type Operands = Array<Operand>;
declare type IterationRecordItem = [Record<string, any>, Array<NodeProp>, [Record<string, any>, string, string, IterationRecordItem] | null];
declare type IterationRecord = Array<IterationRecordItem>;
declare class Option extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>): any[];
}
declare class Or extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>): any[];
}
declare class Series extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>): IterationRecord;
}
declare class NonCapturing extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>): any[];
}
declare class NonCollecting extends Operator {
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>): any[];
}
declare class Loop extends Operator {
    attach(parents: IterationRecord, key: string): IterationRecord;
}
declare class Mark implements MarkInterfact {
    static MATCHED_RECORD: Matched;
    key: string;
    value: any;
    constructor(value?: any);
    attach(parents: IterationRecord, key: string, watchers?: Array<Watcher>): IterationRecord;
}
declare function _Option(...some: Operands): Option;
declare function _Or(...some: Operands): Or;
declare function _Series(...some: Operands): Series;
declare function _NonCapturing(...some: Operands): NonCapturing;
declare function _NonCollecting(...some: Operands): NonCollecting;
declare function _Loop(...some: Operands): Loop;
declare function _Mark(some?: any): Mark;
declare let NODES: Record<string, (...args: any) => void>;
declare function createMatchTree(data: Record<string, any> | Array<Record<string, any>>, root?: Record<string, any>, block_list?: Array<string>, prevent_update?: boolean): Record<string, any>;
declare function _Context(parser: Parser, tokens: Array<Node>): Context;
declare function isFutureReservedWord(id: string): boolean;
declare function isStrictModeReservedWord(id: string): boolean;
declare function isRestrictedWord(id: string): boolean;
declare const IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN: Or;
declare const EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN: Or;
declare const IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN: Or;
declare const EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN: Or;
declare function validateIdentifier(context: Context, node: Node): boolean;
declare function validateAssignment(context: Context, node: Node): boolean;
declare function validateBinding(context: Context, node: Node): boolean;
declare function validateLineTerminator([collected, parser, tokens, , right]: Context): Record<string, any>;
declare let join_content: ([collected]: Context) => any;
declare let TYPE_ALIAS: {};
declare const ASSIGNMENT_PUNCTUATORS_PATTERN: Or;
declare let AWAIT_LIST: Array<() => void>;
declare const STATEMANT_LIST_ITEM_PATTERN: Or;
declare const RIGHT_SIDE_TOPLEVEL_ITEM_PATTERN: Or;
declare const TOPLEVEL_ITEM_PATTERN: Or;
declare function isAligned(context: Context, left: number, right: number): boolean;
export { Mark, isAligned, STATEMANT_LIST_ITEM_PATTERN, RIGHT_SIDE_TOPLEVEL_ITEM_PATTERN, TOPLEVEL_ITEM_PATTERN, AWAIT_LIST, join_content, IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN, EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN, IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN, EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN, ASSIGNMENT_PUNCTUATORS_PATTERN, validateBinding, validateLineTerminator, NODES, TYPE_ALIAS, MATCH_MARKS, createMatchTree, isRestrictedWord, isFutureReservedWord, isStrictModeReservedWord, validateIdentifier, validateAssignment, _Context, _Option, _Or, _Series, _NonCapturing, _NonCollecting, _Mark, _Loop, };
