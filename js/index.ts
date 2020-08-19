

import {
    Token, Node, Context, CONTEXT, MatchTree
} from './interfaces';

import { createSearchTree } from './lexical/head'

import {
    TYPE_MAPPINGS,
    PUNCTUATORS,
    TOKEN_TYPE_SET,
    REGEXP_DESCRIPTOR
} from "./lexical/index";

import Parser from './parser';
import TokenizerOrigin from './tokenizer';

import { async_getter, token_hooks, createMatchTree } from './syntax/head'

import Expressions from './syntax/expression'
import Declarations from './syntax/declaration'
import Statements from './syntax/statement'
import ModuleDeclarations from './syntax/module_declaration'


async_getter.open();
let EXPRESSION_TREE: MatchTree = async_getter.EXPRESSION_TREE;

const SYNTAX_TREE = createMatchTree([
    Declarations,
    ModuleDeclarations,
    Statements
], EXPRESSION_TREE);


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


const TOKEN_TYPE_MAPPERS: Record<string, string | number> = TOKEN_TYPE_SET.reduce(
    (map, [type, id_set]) => {
        for (let id of id_set) {
            map[" " + id] = type;
        }
        return map;
    }, {}
);
const PUNCTUATORS_TREE = createSearchTree(PUNCTUATORS);
const PRIMARY_EXPR_START_PUNCTUATORS_TREE = createSearchTree(
    [REGEXP_DESCRIPTOR],
    createSearchTree(PUNCTUATORS, undefined, ["/="]),
);



class Tokenizer extends TokenizerOrigin {
    TYPE_MAPPINGS = TYPE_MAPPINGS;
    PRIMARY_EXPR_START_PUNCTUATORS_TREE = PRIMARY_EXPR_START_PUNCTUATORS_TREE;
    PUNCTUATORS_TREE = PUNCTUATORS_TREE;
}
class Dison extends Parser {
    token_hooks = token_hooks;
    TYPE_MAPPINGS = TYPE_MAPPINGS;
    PRIMARY_EXPR_START_PUNCTUATORS_TREE = PRIMARY_EXPR_START_PUNCTUATORS_TREE;
    PUNCTUATORS_TREE = PUNCTUATORS_TREE;
    TOKEN_TYPE_MAPPERS = TOKEN_TYPE_MAPPERS;
    SYNTAX_TREE = SYNTAX_TREE;
    EXPRESSION_TREE = EXPRESSION_TREE;

    isExpression = isExpression;
    isStatement = isStatement;
    isStatementListItem = isStatementListItem;
    isDeclaration = isDeclaration;
    isModuleItem = isModuleItem;
}
export {
    Tokenizer,
    Dison as Parser
};
export default Dison;
