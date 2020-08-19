

import {
    Context, CONTEXT, SourceLocation, Node, Token, MATCH_MARKS, MatchTree
} from '../interfaces';
import {
    async_getter,
    _Punctuator,
    _Keyword,
    _Identifier,
    _Pattern,
    isRestrictedWord,
    STATEMANT_LIST_ITEM_PATTERN,
    TOPLEVEL_ITEM_PATTERN,
    _Option, _Or, _Series, _NonCollecting, _Mark, NODES, TYPE_ALIAS,
    validateBinding, validateLineTerminator, createMatchTree, join_content, _NonCapturing
} from './head'
//import { Expressions, UNIT_EXPRESSION_TREE } from './expression';

let Grouping = NODES.Grouping;


function get_variable_declarator(context: Context, id: Node, init: Node, range: [number, number], loc: SourceLocation): Node {
    let parser = context[CONTEXT.parser];
    if (id instanceof Grouping) {
        parser.err(id);
    } else if (context[CONTEXT.strict]) {
        init || validateBinding(context, id);
    } if (id.name === "let") {
        let kind = context.tokens[context[CONTEXT.begin] - 1];
        if (kind.value === "let" || kind.value === "const") {
            parser.err(id);
        }
    }
    return {
        type: "VariableDeclarator",
        id, init, range, loc
    };
}

let VariableDeclarators = {
    Success: {
        handler: [
            join_content,
            function (context: Context) {
                let [collected] = context;
                validateLineTerminator(context);
                collected.content = join_content(context).content;
                return collected;
            }
        ],
        precedence: [true, 0],
        collector: [
            {
                success: _Or("Success", MATCH_MARKS.BOUNDARY),
                content: _Or(
                    _Pattern("Identifier").pipe(
                        function (context: Context, identifier: Node) {
                            return get_variable_declarator(
                                context,
                                identifier,
                                null,
                                identifier.range,
                                identifier.loc
                            );
                        }
                    ),
                    _Pattern("AssignmentPattern").pipe(
                        function (context: Context, pattern: Node) {
                            return get_variable_declarator(
                                context,
                                pattern.left,
                                pattern.right,
                                pattern.range,
                                pattern.loc
                            );
                        }
                    )
                ),
                _next: _NonCollecting("Punctuator ,"),
            },
            [
                ["type", _Mark("VariableDeclarators")],
                ["_next", _Option("Punctuator ;")]
            ]
        ]
    }
}


let VARIABLE_DECLARATOR_TREE: MatchTree;

async_getter.get(
    "UNIT_EXPRESSION_TREE",
    function (UNIT_EXPRESSION_TREE: MatchTree) {
        VARIABLE_DECLARATOR_TREE = createMatchTree(VariableDeclarators, UNIT_EXPRESSION_TREE);
    }
);

function reinterpreat_expression_as_declaration(context: Context, expr: Node) {
    let [collected, parser] = context;
    expr.type = collected.type;
    if (expr.id) {
        if (isRestrictedWord(expr.id.name)) {
            parser.err(expr.id);
        }
    } else {
        parser.err(expr);
    }
    for (let key in expr) {
        collected[key] = expr[key];
    }
    return expr.id;
}

const Declarations: Record<string, any> = async_getter.Declarations = {
    "ClassDeclaration": { //<= ClassExpression
        filter(context: Context, left: number, right: number) {
            let tokens = context.tokens;
            return !(tokens[right] instanceof Grouping);
        },
        collector: [
            {
                _prev: _NonCapturing(TOPLEVEL_ITEM_PATTERN),
                id: _Pattern("ClassExpression").pipe(reinterpreat_expression_as_declaration)
            }
        ]
    },
    "FunctionDeclaration": {
        filter: "ClassDeclaration",
        collector: [
            {
                _prev: _NonCapturing(TOPLEVEL_ITEM_PATTERN),
                id: _Pattern("FunctionExpression").pipe(reinterpreat_expression_as_declaration)
            }
        ]
    },
    "VariableDeclaration": [
        {
            validator: [
                function (context: Context) {
                    let [, parser, left] = context;
                    context.wrap(CONTEXT.bindingElement, true);
                    let res = parser.parseCustom(
                        VARIABLE_DECLARATOR_TREE,
                        context,
                        left + 1,
                        (node: Node) => node.type === "VariableDeclarators"
                    );
                    context.unwrap();
                    return res && 0;
                }, null
            ],
            collector: [
                {
                    //_: _NonCapturing(TOPLEVEL_ITEM_PATTERN),
                    kind: _Or("Keyword var const let", "Identifier let").pipe(
                        function (context: Context, token: Token) {
                            return token.name === undefined ? token.value : token.name;
                        }
                    ),
                    declarations: _Or(
                        "Identifier",
                        "Punctuator [ {"
                    )
                },
                [
                    ["declarations", _Pattern("VariableDeclarators").pipe(
                        function (context: Context, token: Token) {
                            return token.content;
                        }
                    )],
                ]
            ]
        }
    ]

};
async_getter.get("Declarations", function (declarations: Record<string, any>) {
    for (const type_name in declarations) {
        type_name && (TYPE_ALIAS[type_name] = [type_name, "[Declaration]"]);
    }

})
export default Declarations;
