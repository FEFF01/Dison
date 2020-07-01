
import {
    Token, Node, Context, CONTEXT
} from '../interfaces';
import {
    MATCH_MARKS,
    createMatchTree,
    _Option, _Or, _Series, _NonCollecting, _Mark
} from './head'
import Parser from '../parser'


import {
    Expressions,
    EXPRESSION_TREE
} from './expression'
import Declarations from './declaration'
import Statements from './statement'
import ModuleDeclarations from './module_declaration'



let EXPRESSION_ITEM_PATTERN = {};
let DECLARATION_ITEM_PATTERN = {};
let STATEMENT_ITEM_PATTERN = {};
let STATEMENT_LIST_ITEM_PATTERN = {};
let MODULE_ITEM_PATTERN = {};
for (
    const [descriptor, patterns]
    of
    [
        [
            Expressions,
            [EXPRESSION_ITEM_PATTERN]
        ],
        [
            Declarations,
            [DECLARATION_ITEM_PATTERN, STATEMENT_LIST_ITEM_PATTERN]
        ],
        [
            Statements,
            [STATEMENT_ITEM_PATTERN, STATEMENT_LIST_ITEM_PATTERN]
        ],
        [
            ModuleDeclarations,
            [MODULE_ITEM_PATTERN, STATEMENT_LIST_ITEM_PATTERN]
        ],
    ] as Array<[Record<string, any>, Array<Record<string, boolean>>]>
) {
    for (const key in descriptor) {
        if (key) {
            for (const pattern of patterns) {
                pattern[key] = true;
            }
        }
    }
}

function isExpression(node: Node) {
    return EXPRESSION_ITEM_PATTERN[node.type];
}
function isDeclaration(node: Node) {
    return DECLARATION_ITEM_PATTERN[node.type];
}
function isStatement(node: Node) {
    return STATEMENT_ITEM_PATTERN[node.type];
}
function isStatementListItem(node: Node) {
    return STATEMENT_LIST_ITEM_PATTERN[node.type];
}
function isModuleItem(node: Node) {
    return MODULE_ITEM_PATTERN[node.type];
}


const SYNTAX_TREE = createMatchTree([
    Declarations,
    ModuleDeclarations,
    Statements
], EXPRESSION_TREE);


function parse_next_statement(context: Context, start = context[CONTEXT.right] + 1) {
    let parser = context[CONTEXT.parser];
    if (
        parser.parseCustom(
            parser.SYNTAX_TREE,
            context,
            start,
            isStatementListItem
        )
    ) {
        return 0;
    }
}
function get_inner_group(token: Token) {
    while (
        token.content.length === 1
        && token.content[0].value === "()"
        && token.content[0].type === "Punctuator"
    ) {
        token = token.content[0];
    }
    return token;
}

function extract_success(parser: Parser, nodes: Array<Node>) {
    let res: Array<Node> = nodes;
    if (nodes.length) {
        if (nodes[0].type === "Success") {
            res = nodes[0].content;
            nodes.length > 1 && parser.err(...nodes.slice(1));
        } else {
            res = [];
            parser.err(...nodes);
        }
    }
    return res;
}

function parse_and_extract(match_tree: Record<string, any>, context: Context, node: Node) {
    let [, parser] = context;
    let tokens = node.content;
    if (tokens.length) {
        context[CONTEXT.tokens] = tokens;
        parser.parseCustom(match_tree, context);
        tokens = extract_success(parser, tokens)
    }
    return tokens;
}
/*
function isCommaSeparator(node) {
    return node.type === "Punctuator" && node.value === ",";
}*/


export {
    parse_next_statement,
    get_inner_group,
    extract_success,
    parse_and_extract,
    MATCH_MARKS,
    isExpression, isDeclaration, isStatement, isStatementListItem, isModuleItem,
    SYNTAX_TREE, EXPRESSION_TREE
}



