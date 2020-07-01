
import {
    Context, CONTEXT, Node, Token
} from '../interfaces';
import {
    isExpression, isStatement, isStatementListItem,
    parse_next_statement, get_inner_group,
} from './index'
import {
    createMatchTree,
    NODES, MATCH_MARKS,
    _Option, _Or, _Series, _NonCollecting, _Mark, _Loop, TYPE_ALIAS,
    validateBinding, validateLineTerminator, _NonCapturing,
    validateIdentifier, validateAssignment,
    STATEMANT_LIST_ITEM_PATTERN,
    TOPLEVEL_ITEM_PATTERN,
    RIGHT_SIDE_TOPLEVEL_ITEM_PATTERN,
    EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
    IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
    IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
    EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
    isAligned,
} from './head'
import {
    EXPRESSION_TREE,
    parseArrayPattern,
    parseObjectPattern,
    parse_params

} from './expression';
import Declaration from './declaration';
const Grouping = NODES.Grouping;
let { VariableDeclaration } = Declaration;

const Statements: Record<string, any> = {
    "": {
        handler([collected, parser]: Context) {
            parser.err(collected.error);
            return [];
        },
        precedence: -1,
        collector: [
            {
                error: _Or("Punctuator", "Keyword"),
                _next: _NonCapturing(RIGHT_SIDE_TOPLEVEL_ITEM_PATTERN),
            }
        ]
    },
    "BreakStatement": {
        handler(context: Context) {
            let [collected, parser] = context;
            validateLineTerminator(context);
            let label = collected.label;
            if (label) {
                if (
                    label instanceof Grouping
                    || context[CONTEXT.labelSet].indexOf(label.name) < 0
                ) {
                    parser.err(label);
                }
            } else if (!context[CONTEXT.inIteration] && !context[CONTEXT.inSwitch]) {
                parser.err(collected);
            }
            return collected;
        },
        filter: [
            function (context: Context, left: number) {
                return isAligned(context, left, left + 1);
            },
            null,
        ],
        collector: [
            {
                token: _NonCollecting("Keyword break"),
                label: IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                _next: _Option("Punctuator ;")
            },
            ["label", _Mark(null)]
        ]
    },
    "ContinueStatement": {
        handler(context: Context) {
            let [collected, parser] = context;
            let label = collected.label;
            validateLineTerminator(context);
            if (label) {
                if (
                    label instanceof Grouping
                    || context[CONTEXT.labelSet].indexOf(label.name) < 0
                ) {
                    parser.err(label);
                }
            } else if (!context[CONTEXT.inIteration]) {
                parser.err(collected);
            }
            return collected;
        },
        filter: "BreakStatement",
        collector: [
            {
                token: _NonCollecting("Keyword continue"),
                label: IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                _next: _Option("Punctuator ;")
            },
            ["label", _Mark(null)],
        ]
    },
    "ReturnStatement": {
        handler(context: Context) {
            let [collected, parser] = context;
            validateLineTerminator(context);
            if (!context[CONTEXT.inFunctionBody]) {
                parser.err(collected);
            }
            return collected;
        },
        validator(context: Context) {
            let [, , tokens, left, right] = context;
            if (left === right) {
                let next_token = tokens[left + 1];
                if (next_token && tokens[left].loc.end.line === next_token.loc.start.line) {
                    return false;
                }
            }
            return true;
        },
        filter: "BreakStatement",
        precedence: 0,
        collector: [
            {
                token: _NonCollecting("Keyword return"),
                argument: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                _next: _Option("Punctuator ;")
            },
            ["argument", _Mark(null)]
        ]
    },
    "BlockStatement": {
        handler(context: Context) {
            let [collected, parser] = context;
            collected.body = parser.parseBlock(context, collected.body);
            return collected;
        },
        overload: true,//和 ObjectPattern 收集器有重叠，在存在 BlockStatement 的环境， ObjectPattern 的 filter 不会返回 true，这里强制覆盖
        precedence: 0,
        collector: [
            {
                _prev: _NonCapturing(TOPLEVEL_ITEM_PATTERN),
                body: "Punctuator {}"
            }
        ]
    },
    "DoWhileStatement": {
        validator: "ForStatement",
        handler(context: Context) {
            let [collected, parser] = context;
            validateLineTerminator(context);
            collected.test = parser.parseExpression(context, collected.test);
            return collected;
        },
        collector: [
            {
                keyword: _NonCollecting("Keyword do"),
            },
            [
                ["body", STATEMANT_LIST_ITEM_PATTERN],
                ["test", _Series(_NonCollecting("Keyword while"), "Punctuator ()")],
                ["_next", _Option("Punctuator ;")]
            ]
        ]
    },
    "EmptyStatement": [
        {
            precedence: 100,
            collector: [
                {
                    _prev: _NonCapturing(TOPLEVEL_ITEM_PATTERN),
                    _: _NonCollecting("Punctuator ;")
                }
            ]
        }
    ],
    "ExpressionStatement": {
        handler(context: Context) {
            let [collected, parser, tokens, left] = context;
            validateLineTerminator(context);
            let prev_node = tokens[left - 1];
            if (
                (!prev_node || prev_node.directive)
                && (
                    tokens === parser.tokens
                    || tokens === context[CONTEXT.inFunctionBody]
                )
            ) {
                collected = parser.parseDirective(collected);
                switch (collected.directive) {
                    case "use strict":
                        context[CONTEXT.strict] = true;
                        break;
                }
            }
            return collected;
        },
        precedence: 0,
        collector: [
            {
                expression: EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
                _next: _Option("Punctuator ;")
            }
        ]
    },
    "ForStatement": {
        validator: [
            function (context: Context) {
                context.wrap(CONTEXT.inIteration, true);
                let res = parse_next_statement(context);
                context.unwrap();
                return res;
            },
            null
        ],
        handler(context: Context) {
            let [collected, parser] = context;
            let { iterator, body, range, loc } = collected;
            let iterator_tokens = iterator.content;
            context.wrap(CONTEXT.isExpression, true);
            context[CONTEXT.tokens] = iterator_tokens;
            parser.parseCustom(FOR_ITERATOR_TREE, context);
            context.unwrap();
            if (iterator_tokens.length > 0) {
                let index = 0;
                if (isStatement(iterator_tokens[0])) {
                    collected = iterator_tokens[0];
                    collected.body = body;
                    collected.range = range;
                    collected.loc = loc;
                    index = 1;
                }
                if (iterator_tokens.length > index) {
                    parser.err(...iterator_tokens.slice(index));
                }
            }
            return collected;
        },
        collector: [
            {
                keyword: _NonCollecting("Keyword for"),
                iterator: "Punctuator ()"
            },
            ["body", STATEMANT_LIST_ITEM_PATTERN]
        ]
    },
    "ForInStatement": {//ForStatement
    },
    "ForOfStatement": {//ForStatement
    },
    "IfStatement": {
        validator(context: Context) {
            let [, , , left, right] = context;
            if ((right - left) % 2 === 1) {
                return parse_next_statement(context);
            }
            return true;
        },
        handler(context: Context) {
            let [collected, parser] = context;
            collected.test = parser.parseExpression(context, collected.test);
            return collected;
        },
        collector: [
            {
                token: _NonCollecting("Keyword if"),
                test: "Punctuator ()",
                consequent: _Mark(null),
                alternate: _Mark(null)
            },
            ["consequent", STATEMANT_LIST_ITEM_PATTERN],
            [
                "alternate", _Series(
                    _NonCollecting("Keyword else"),
                    _Option(STATEMANT_LIST_ITEM_PATTERN)
                )
            ]
        ]
    },
    "LabeledStatement": {
        validator: [
            function (context: Context) {
                let [, parser, tokens, left] = context;
                let label = tokens[left];
                let label_name = label.name;
                let label_set = context[CONTEXT.labelSet];
                if (label_set.indexOf(label_name) >= 0) {
                    parser.err(label);
                }
                let index = label_set.push(label_name) - 1;
                let res = parse_next_statement(context);
                label_set.splice(index, 1);
                return res;
            },
            null
        ],
        precedence: 0,
        collector: [
            {
                label: _Series(
                    IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                    _NonCollecting("Punctuator :")
                )
            },
            ["body", STATEMANT_LIST_ITEM_PATTERN]
        ]
    },
    "SwitchStatement": [
        {
            handler(context: Context) {
                let [collected, parser] = context;
                let { discriminant } = collected;
                collected.discriminant = parser.parseExpression(context, discriminant);
                collected.discriminant || parser.err(discriminant);
                collected.cases = context[CONTEXT.tokens] = collected.cases.content;
                context.wrap(CONTEXT.inSwitch, context[CONTEXT.tokens]);
                parser.parseCustom(parser.SYNTAX_TREE, context);
                context.unwrap();
                let has_default = false;
                for (const item of collected.cases) {
                    if (item.type === "SwitchCase") {
                        if (item.test) {
                            continue;
                        }
                        if (!has_default) {
                            has_default = true;
                            continue;
                        }
                    }
                    parser.err(item);
                }
                return collected;
            },
            collector: [
                {
                    token: _NonCollecting("Keyword switch"),
                    discriminant: "Punctuator ()",
                    cases: "Punctuator {}"
                }
            ]
        },
        {
            handler([collected]: Context) {
                collected.consequent = [];
                return collected;
            },
            precedence: 0,
            filter(content: Context) {
                return content[CONTEXT.inSwitch] === content[CONTEXT.tokens];
            },
            collector: [
                {
                    type: _Mark("SwitchCase"),
                    test: _Or(
                        _Series(
                            _NonCollecting("Keyword case"),
                            EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN
                        ),
                        _Series(
                            _NonCollecting("Keyword default"),
                            _Mark(null)
                        )
                    ),
                    __: _NonCollecting("Punctuator :")
                },
            ]
        },
        {
            handler([collected]: Context) {
                collected.token.consequent.push(collected.consequent)
                return collected.token;
            },
            collector: {
                token: "SwitchCase",
                consequent: STATEMANT_LIST_ITEM_PATTERN
            }
        }
    ],
    "ThrowStatement": {
        handler(context: Context) {
            let [collected, parser] = context;
            validateLineTerminator(context);
            if (collected.loc.start.line !== collected.argument.loc.start.line) {
                parser.err(collected);
            }
            return collected;
        },
        precedence: 0,
        collector: [
            {
                token: _NonCollecting("Keyword throw"),
                argument: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                _next: _Option("Punctuator ;")
            }
        ]
    },
    "TryStatement": {
        handler(context: Context) {
            let [collected, parser] = context;
            let { block, handler, finalizer } = collected;
            collected.block = { type: "BlockStatement", body: parser.parseBlock(context, block) }
            if (handler) {
                let [param, body] = handler;
                let params = parse_params(context, param.content);
                if (params.length !== 1) {
                    parser.err(param);
                }
                collected.handler = {
                    type: "CatchClause",
                    param: params[0],
                    body: { type: "BlockStatement", body: parser.parseBlock(context, body) }
                };
            }
            if (finalizer) {
                collected.finalizer = { type: "BlockStatement", body: parser.parseBlock(context, finalizer) };
            }
            return collected;
        },
        collector: [
            {
                token: _NonCollecting("Keyword try"),
                block: "Punctuator {}",
                handler: _Series(_NonCollecting("Keyword catch"), "Punctuator ()", "Punctuator {}"),
                finalizer: _Mark(null)
            },
            ["finalizer", _Series(_NonCollecting("Keyword finally"), "Punctuator {}")],
            ["handler", _Mark(null)],
        ]
    },
    "WhileStatement": {
        validator: "ForStatement",
        handler(context: Context) {
            let [collected, parser] = context;
            collected.test = parser.parseExpression(context, collected.test);
            return collected;
        },
        collector: [
            {
                token: _NonCollecting("Keyword while"),
                test: "Punctuator ()"
            },
            ["body", STATEMANT_LIST_ITEM_PATTERN]
        ]
    },
    "WithStatement": {
        validator: [
            parse_next_statement,
            null
        ],
        handler(context: Context) {
            let [collected, parser] = context;
            if (context[CONTEXT.strict]) {
                parser.err(collected);
            }
            collected.object = parser.parseExpression(context, collected.object);
            return collected;
        },
        collector: [
            {
                token: "Keyword with",
                object: "Punctuator ()"
            },
            ["body", STATEMANT_LIST_ITEM_PATTERN]
        ]
    }
};

for (const type_name in Statements) {
    if (type_name) {
        type_name && (TYPE_ALIAS[type_name] = [type_name, "[Statement]"]);
    }
}
export default Statements;

let ForIterator = {
    VariableDeclaration,
    ForStatement: [
        {
            collector: [
                {
                    init: _Or(
                        "VariableDeclaration",
                        _Series(
                            _NonCollecting(MATCH_MARKS.BOUNDARY),
                            _Or(EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN, _Mark(null)),//EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS
                            _NonCollecting("Punctuator ;")
                        )
                    ),
                    test: _Series(
                        _Or(EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN, _Mark(null)),
                        _NonCollecting("Punctuator ;")
                    ),
                    update: _Series(
                        _Or(EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN, _Mark(null)),
                        _NonCollecting(MATCH_MARKS.BOUNDARY)
                    ),
                    body: _Mark(null)
                }
            ]
        },
        {
            handler(context: Context) {
                let [collected, parser] = context;
                let { left } = collected;
                let kind: Node, declarator: Node;
                if (left instanceof Array) {
                    [kind, declarator] = left;
                } else {
                    declarator = left;
                }
                if (declarator.value === "()" && declarator.type === "Punctuator") {
                    let wrapper = declarator;
                    declarator = get_inner_group(declarator);
                    if (declarator.content.length > 0) {
                        if (kind) {
                            parser.err(declarator);
                        } else if (declarator.content.length > 1) {
                            parser.err(...declarator.content.slice(1));
                        }
                        declarator = new Grouping(declarator.content[0], wrapper);
                    }
                }
                if (declarator.type === "Punctuator") {
                    switch (declarator.value) {
                        case "{}":
                            declarator = parseObjectPattern(context, declarator);
                            break;
                        case "[]":
                            declarator = parseArrayPattern(context, declarator);
                            break;
                        default:
                            parser.err(declarator);
                            declarator = null;
                    }
                } else if (declarator.type !== "Identifier") {
                    parser.err(declarator);
                    declarator = null;
                } else {
                    validateAssignment(context, declarator);
                }
                if (kind) {
                    left = new NODES.VariableDeclaration();
                    left.declarations = [
                        {
                            type: "VariableDeclarator",
                            id: declarator,
                            init: null
                        }
                    ];
                    left.kind = kind.value;
                    left.range = [kind.range[0], declarator.range[1]];
                    left.loc = {
                        start: kind.loc.start,
                        end: declarator.loc.end
                    };
                    collected.left = left;
                } else {
                    collected.left = declarator;
                }
                return collected;
            },
            validator(context: Context) {
                return context[CONTEXT.right] >= context[CONTEXT.tokens].length;
            },
            filter: [function () { return false }, null],
            precedence: 1.5,
            collector: [
                {
                    _: _Series(//和 VariableDeclaration 不冲突的占位 
                        MATCH_MARKS.BOUNDARY,
                        _Or(
                            _Series(
                                _Or("Keyword var const let"),
                                _Or("Identifier", "Punctuator {} [] ()")
                            ),
                            _Series(
                                "Identifier let",
                                _Or("Identifier", "Punctuator {} ()")
                            )
                        )

                    )
                },
                {
                    type: _Mark("ForOfStatement"),
                    _prev: _NonCollecting(MATCH_MARKS.BOUNDARY),
                    left: _Series(
                        _Option(_Or("Identifier let", "Keyword var const let")),
                        _Or("Identifier", "Punctuator {} [] ()")
                    ),
                    token: _NonCollecting("Identifier of"),
                    right: _Option(
                        _Series(
                            EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
                            _Option(_NonCollecting(MATCH_MARKS.BOUNDARY))
                        )
                    ),
                    body: _Mark(null),
                },
                [
                    ["type", _Mark("ForInStatement")],
                    ["token", _NonCollecting("Keyword in")],
                    ["each", _Mark(false)]
                ]
            ]

        }
    ]
};
let FOR_ITERATOR_TREE = createMatchTree(ForIterator, EXPRESSION_TREE);
