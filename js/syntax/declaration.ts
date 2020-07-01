

import {
    Context, CONTEXT, SourceLocation, Node
} from '../interfaces';
import {
    isRestrictedWord,
    STATEMANT_LIST_ITEM_PATTERN,
    TOPLEVEL_ITEM_PATTERN,
    _Option, _Or, _Series, _NonCollecting, _Mark, NODES, TYPE_ALIAS,
    validateBinding, validateLineTerminator, AWAIT_LIST, createMatchTree, join_content, _NonCapturing, MATCH_MARKS
} from './head'
import { Expressions, PRIMARY_EXPRESSION_TREE } from './expression';

let Grouping = NODES.Grouping;


function get_variable_declarator(context: Context, id: Node, init: Node, range: [number, number], loc: SourceLocation): Node {
    if (id instanceof Grouping) {
        context[CONTEXT.parser].err(id);
    } else if (context[CONTEXT.strict]) {
        init || validateBinding(context, id);
    } if (id.name === "let") {
        let kind = context[CONTEXT.tokens][context[CONTEXT.begin] - 1];
        if (kind.value === "let" || kind.value === "const") {
            context[CONTEXT.parser].err(id);
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
        precedence: [100, 0],
        collector: [
            {
                success: _Or("Success", MATCH_MARKS.BOUNDARY),
                content: _Or(
                    _Or("Identifier").watch(
                        function (context: Context, identifier: Node) {
                            context[CONTEXT.collected].content = get_variable_declarator(
                                context,
                                identifier,
                                null,
                                identifier.range,
                                identifier.loc
                            );
                        }
                    ),
                    _Or("AssignmentPattern").watch(
                        function (context: Context, pattern: Node) {
                            context[CONTEXT.collected].content = get_variable_declarator(
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
let VARIABLE_DECLARATOR_TREE: Record<string, any>;

AWAIT_LIST.push(function () {
    VARIABLE_DECLARATOR_TREE = createMatchTree(VariableDeclarators, PRIMARY_EXPRESSION_TREE);
});

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
}
const Declarations: Record<string, any> = {
    "ClassDeclaration": { //<= ClassExpression
        filter(context: Context, left: number, right: number) {
            let tokens = context[CONTEXT.tokens];
            return !(tokens[right] instanceof Grouping);
        },
        collector: [
            {
                _prev: _NonCapturing(TOPLEVEL_ITEM_PATTERN),
                id: _Or("ClassExpression").watch(reinterpreat_expression_as_declaration)
            }
        ]
    },
    "FunctionDeclaration": {
        filter: "ClassDeclaration",
        collector: [
            {
                _prev: _NonCapturing(TOPLEVEL_ITEM_PATTERN),
                id: _Or("FunctionExpression").watch(reinterpreat_expression_as_declaration)
            }
        ]
    },
    "VariableDeclaration": [
        {
            validator(context: Context) {
                let [, parser, tokens, left] = context;
                context[CONTEXT.start] = context[CONTEXT.end] = left + 1;
                return parser.parseKeyword(tokens[left + 1]);
            },
            collector: {
                _: TOPLEVEL_ITEM_PATTERN,
                __: "Identifier let",
                ___: "Punctuator []"
            }
        },
        {
            validator: [
                function (context: Context) {
                    let [, parser, tokens, left] = context;
                    context.wrap(CONTEXT.bindingElement, tokens);
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
            handler(context: Context) {
                let [collected] = context;
                let { declarations, kind } = collected;
                collected.declarations = declarations.content;
                collected.kind = kind.value || kind.name;
                return collected;
            },
            collector: [
                {
                    //_: _NonCapturing(TOPLEVEL_ITEM_PATTERN),
                    kind: _Or("Keyword var const let", "Identifier let"),
                    declarations: _Or(
                        "Identifier",
                        _Series("Punctuator [] {}", "Punctuator =")
                    )
                },
                [
                    ["declarations", "VariableDeclarators"],
                ]
            ]
        }
    ]

};
for (const type_name in Declarations) {
    type_name && (TYPE_ALIAS[type_name] = [type_name, "[Declaration]"]);
}

export default Declarations;
