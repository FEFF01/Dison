import {
    Node, Token, Context, CONTEXT, MATCHED
} from '../interfaces';
import {
    createMatchTree,
    _Option, _Or, _Series, _NonCollecting, _NonCapturing, _Mark,
    TYPE_ALIAS, _Context, _Loop, NODES, validateIdentifier, validateAssignment,
    validateBinding, validateLineTerminator, ASSIGNMENT_PUNCTUATORS_PATTERN, join_content,

    IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
    EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
    IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
    EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
    TOPLEVEL_ITEM_PATTERN,
    MATCH_MARKS,
    isAligned
} from './head'
import { extract_success, parse_and_extract } from './index';

import {
    Patterns,
    parseArrayPattern,
    parseObjectPattern
} from './pattern';
const Grouping = NODES.Grouping;


const ARGUMENTS_PATTERN = _Or("Punctuator ()").watch(
    function (context: Context, token: Token) {
        let [collected] = context;
        collected.arguments = parse_arguments(context, token.content);
    }
);


const Expressions: Record<string, any> = {
    "": [
        {
            handler(context: Context) {
                let [collected, parser] = context;
                context.wrap(CONTEXT.bindingSet, null);
                let node = parser.parseExpression(context, collected.token);
                context.unwrap();
                return node ? new Grouping(node, collected.token) : [];
            },
            precedence: 20,
            collector: {
                type: _Mark("Grouping"),
                token: "Punctuator ()"
            }
        },
        {
            validator(context: Context) {
                let [, parser, tokens, , right] = context;
                tokens[right] instanceof Grouping && parser.err(tokens[right]);
                return true;
            },
            filter(context: Context) {
                return context[CONTEXT.spreadElement] === context[CONTEXT.tokens];
            },
            precedence: 1.5,
            collector: {
                type: _Mark("SpreadElement"),
                token: _NonCollecting("Punctuator ..."),
                argument: "[Expression]"
            }
        },
        {
            validator(context: Context) {
                let [, parser, tokens, , right] = context;
                let argument = tokens[right];
                argument instanceof Grouping && parser.err(argument);
                return true;
            },
            filter: function (context: Context) {
                return context[CONTEXT.bindingElement] === context[CONTEXT.tokens];
            },
            precedence: 1.5,
            collector: {
                type: _Mark("RestElement"),
                token: _NonCollecting("Punctuator ..."),
                argument: _Or(_Or("Identifier").watch(validateBinding), "ArrayPattern", "ObjectPattern")
            }
        }
    ],
    "Identifier": [
    ],
    "Literal": [//已在 tokenizer => token_hooks 中处理
        {
            handler(context: Context) {
                let [collected, parser] = context;
                let { str: value, octal, value: raw } = collected.value;
                collected.value = value;
                collected.raw = raw;
                if (octal && context[CONTEXT.strict]) {
                    parser.err(collected);
                }
                return collected;
            },
            collector: {
                value: "String",
                raw: _Mark(null)
            }
        }
    ],
    "ThisExpression": {
        collector: {
            token: _NonCollecting("Keyword this")
        }
    },
    "TemplateLiteral": {
        handler(context: Context) {
            let [collected, parser, tokens, , right] = context;
            let content = tokens[right].content;
            for (const item of content) {
                if (item.type === "TemplateElement") {
                    collected.quasis.push(item);
                } else {
                    collected.expressions.push(parser.parseExpression(context, item));
                }
            }
            return collected;
        },
        collector: [
            {
                _: _NonCapturing(_Option("[Expression]")),
                __: _NonCollecting("Template ``"),
                quasis: _Mark(Array),
                expressions: _Mark(Array)
            }
        ]
    },
    "ArrayExpression": {
        precedence: 20,
        collector: {
            elements: _Or("Punctuator []").watch(
                function (context: Context, node: Node) {
                    let [collected] = context;
                    context.wrap(CONTEXT.spreadElement, node.content);
                    collected.elements = parse_and_extract(ARRAY_ELEMENTS_TREE, context, node);
                    context.unwrap();
                }
            ),
        }

    },
    "ObjectExpression": {
        handler(context: Context) {
            let [collected] = context;
            collected.properties = parse_and_extract(OBJECT_PROPERTIES_TREE, context, collected.properties);
            return collected;
        },
        precedence: 20,
        collector: {
            properties: "Punctuator {}",
        }

    },
    "FunctionExpression": [
        {
            handler: parse_function_expression,
            collector: [
                {
                    async: _Or(
                        _Series(_Mark(true), _NonCollecting("Keyword async")),
                        _Mark(false)
                    ),
                    __: _NonCollecting("Keyword function"),
                    generator: _Or(
                        _Series(_Mark(true), _NonCollecting("Punctuator *")),
                        _Mark(false)
                    ),
                    id: _Or(IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN, _Mark(null)),
                    params: "Punctuator ()",
                    body: "Punctuator {}",
                    expression: _Mark(false)
                }
            ]
        },
        {
            handler([collected, parser]: Context) {
                return parser.parseKeyword(collected.async);
            },
            filter: [
                function () {
                    return false;
                },
                isAligned
            ],
            collector: [
                { _: _Series("Identifier async", "Identifier") },
                {
                    async: "Identifier async",
                    _next: _NonCapturing("Keyword function"),
                },
                {
                    async: "Identifier async",
                    params: _NonCapturing("Punctuator ()", "Identifier"),
                    token: _NonCapturing("Punctuator =>"),
                },
            ]
        }
    ],
    "ArrowFunctionExpression": {
        handler(context: Context) {
            let [collected, parser, tokens, left] = context;
            let { async, token, params, body, expression } = collected;
            if (body) {
                if (params.type === "Identifier") {
                    validateAssignment(context, params);
                    collected.params = [params];
                } else {
                    collected.params = parse_params(context, params)
                }
                if (!expression) {
                    let body_context = _Context(parser, body.content);
                    body_context[CONTEXT.inFunctionBody] = body.content;
                    body_context[CONTEXT.allowAwait] = async;
                    collected.body = {
                        type: "BlockStatement",
                        body: parser.parseBlock(body_context)
                    };
                }
                return collected;
            } if (token) {
                token.value = "_=>";
                let body_context = _Context(parser, tokens);
                body_context[CONTEXT.strict] = context[CONTEXT.strict];
                body_context[CONTEXT.allowAwait] = !!async;
                if (
                    parser.parseCustom(
                        parser.EXPRESSION_TREE,
                        body_context,
                        left,
                        (node: Node) => true/*node.type === "ArrowFunctionExpression"*/
                    )
                ) {
                    return null;
                }
            }
        },
        precedence: new Number(3),
        collector: [
            {//占位使 () 不会被单独收集为表达式
                async: _Or(
                    _Series(_Mark(true), _NonCollecting("Keyword async")),
                    _Mark(false)
                ),
                generator: _Mark(false),
                id: _Mark(null),
                params: _Or("Punctuator ()", "Identifier"),
                token: _NonCollecting("Punctuator =>"),
                body: "Punctuator {}",
                expression: _Mark(false)
            },
            [
                ["token", "Punctuator =>"],
                ["body", _Mark()]
            ],
            [
                //_=>作用为隔断匹配，使后续的表达式使用当前方法声明的环境
                ["token", _NonCollecting("Punctuator _=>")],
                ["body", _Option("[Expression]")],
                ["expression", _Mark(true)]
            ]
        ]
    },
    "ClassExpression": {
        collector: [
            {
                _: _NonCollecting("Keyword class"),
                id: _Or(IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN, _Mark(null)),
                superClass: _Or(
                    _Series(
                        _NonCollecting("Keyword extends"),
                        IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN
                    ),
                    _Mark(null)
                ),
                body: _Or("Punctuator {}").watch(
                    function (context: Context, body: Token) {
                        let [collected] = context;
                        collected.body = {
                            type: "ClassBody",
                            body: parse_and_extract(METHOD_DEFINITIONS_TREE, context, body),
                            range: body.range,
                            loc: body.loc
                        };
                    }
                )
            }
        ]
    },
    "TaggedTemplateExpression": {
        collector: [
            {
                tag: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                quasi: "TemplateLiteral"
            }
        ]
    },
    "MemberExpression": [
        {
            precedence: 20,
            collector: {
                object: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                property: _Series(
                    _NonCollecting("Punctuator ."),
                    _Or(
                        "Identifier",
                        _Or("Keyword").watch(
                            function (context: Context, token: Token) {
                                let [collected, parser] = context;
                                collected.property = parser.parseIdentifier(token);
                            }
                        )
                    )
                ),
                computed: _Mark(false)
            }
        },
        {
            filter: "CallExpression",
            precedence: 20,
            collector: {
                object: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                property: _Or("Punctuator []").watch(
                    function (context: Context, token: Token) {
                        let [collected, parser] = context;
                        collected.property = parser.parseExpression(context, token);
                    }
                ),
                computed: _Mark(true)
            }
        }
    ],
    "Super": {
        handler(context: Context) {
            let [collected, parser, tokens, left, right] = context;
            if (context[CONTEXT.inFunctionBody]) {
                if (right === left) {
                    parser.err(tokens[left]);
                }
            } else {
                parser.err(tokens[left]);
            }
            return context[CONTEXT.collected];
        },
        collector: {
            token: _NonCollecting("Keyword super"),
            _next: _NonCapturing("Punctuator () . []")
        }
    },
    "MetaProperty": {
        handler([collected]: Context) {
            collected.meta.type = "Identifier";
            return collected;
        },
        collector: [
            {
                meta: "Keyword import",
                _: _NonCollecting("Punctuator ."),
                property: "Identifier meta"
            },
            {
                meta: "Keyword new",
                _: _NonCollecting("Punctuator ."),
                property: "Identifier target"
            }
        ]
    },
    "NewExpression": {
        precedence: new Number(20),//memberexpression
        collector: [
            {
                token: _NonCollecting("Keyword new"),
                _: _Option(_NonCollecting("Punctuator ++ --").watch(
                    function (context: Context, token: Token) {
                        context[CONTEXT.parser].err(token);
                    }
                )),
                callee: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                arguments: _Or(_Mark(Array), ARGUMENTS_PATTERN)
            }
        ]
    },
    "CallExpression": {
        precedence: 20,
        filter(context: Context, left: number) {
            let tokens = context[CONTEXT.tokens];
            let first_token = tokens[left], second_token = tokens[left + 1];
            if (second_token === context[CONTEXT.rightAssociativeNode]) {
                return false;
            }
            if (
                first_token.type !== "UpdateExpression"
                || first_token instanceof Grouping
                || isAligned(context, left, left + 1)
            ) {
                return true;
            }
            context[CONTEXT.rightAssociativeNode] = second_token;
        },
        collector: {
            callee: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
            arguments: ARGUMENTS_PATTERN
        }

    },
    "UpdateExpression": [
        {
            handler(context: Context) {
                let [collected] = context;
                collected.operator = collected.operator.value;
                return collected;
            },
            precedence: 17,
            collector: {
                operator: "Punctuator ++ --",
                argument: _Or("MemberExpression", IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN),
                prefix: _Mark(true)
            }
        },
        {
            validator(context: Context) {
                let collected = context[CONTEXT.parser].createNode(context);
                collected.operator = collected.operator.value;
                return collected;
            },
            filter: [
                function (context: Context, left: number, right: number) {
                    return isAligned(context, left, left + 1);
                },
                isAligned,
            ],
            precedence: 18,
            collector: [
                {
                    argument: _Or("MemberExpression", IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN),
                    operator: "Punctuator ++ --",
                    _: _NonCapturing(_Option("Punctuator .").watch(
                        function (context: Context, token: Token) {
                            context[CONTEXT.parser].err(token);
                        }
                    )),
                    prefix: _Mark(false)
                },
                ["_", _NonCapturing("Punctuator [] ()").watch(
                    function (context: Context, token: Token) {
                        context[CONTEXT.parser].err(token);
                    }
                )]
            ]
        }
    ],
    "AwaitExpression": [
        {
            precedence: 17,
            filter(context: Context) {
                return context[CONTEXT.allowAwait];
            },
            collector: {
                token: _NonCollecting("Keyword await"),
                argument: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN
            }
        },
        {
            handler([collected, parser]: Context) {
                return parser.parseIdentifier(collected.token);
            },
            filter(context: Context) {
                return !context[CONTEXT.allowAwait];
            },
            collector: {
                token: "Keyword await",
            }
        },
    ],
    "UnaryExpression": {
        handler(context: Context) {
            let [collected] = context;
            collected.operator = collected.operator.value;
            return collected;
        },
        precedence: 17,
        collector: [
            {
                operator: _Or("Punctuator ~ ! + -", "Keyword delete void typeof"),
                argument: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                prefix: _Mark(true)
            }
        ]
    },
    "BinaryExpression": {
        handler(context: Context) {
            let [collected] = context;
            collected.operator = collected.operator.value;
            return collected;
        },
        validator(context: Context) {
            return context[CONTEXT.right] - context[CONTEXT.left] >= 2
        },
        precedence: [16, 15, 14, 13, 12, 11, 10, 9, 8, 7],
        collector: [
            {
                left: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                operator: `Punctuator **`,
                right: _Option(EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN)
            },
            ["operator", `Punctuator * / %`],
            ["operator", `Punctuator + -`],
            ["operator", `Punctuator << >> >>>`],
            ["operator", _Or(`Punctuator < <= > >=`, `Keyword in instanceof`)],
            ["operator", `Punctuator == != === !==`],
            ["operator", `Punctuator &`],
            ["operator", `Punctuator ^`],
            ["operator", `Punctuator |`],
            ["operator", `Punctuator ??`]
        ]
    },
    "LogicalExpression": {
        validator(context: Context) {
            if (context[CONTEXT.right] - context[CONTEXT.left] === 2) {
                let collected = context[CONTEXT.parser].createNode(context);
                collected.operator = collected.operator.value;
                return collected;
            }
        },
        precedence: [6, 5],
        collector: [
            {
                left: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                operator: "Punctuator &&",
                right: _Option(EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN)
            },
            ["operator", "Punctuator ||"]
        ]
    },
    "ConditionalExpression": [
        {
            validator(context: Context) {
                let [, parser, tokens, left, right] = context;
                if (right - left >= 4) {
                    return true;
                }
                if (!context[CONTEXT.isExpression] || context[CONTEXT.bindingElement] === tokens) {
                    let store = context.store(CONTEXT.isExpression, true, CONTEXT.bindingElement, null);
                    parser.parseCustom(
                        parser.EXPRESSION_TREE,
                        context,
                        left,
                        (node: Node) => node.type === "ConditionalExpression"
                    );
                    context.restore(store);
                    return null;
                }
            },
            precedence: new Number(3),//与 Assignment 为右优先
            collector: [
                {
                    test: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,//EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS
                    token: _NonCollecting("Punctuator ?")
                },
                ["consequent", EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN],
                ["_", _NonCollecting("Punctuator :")],
                ["alternate", EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN]
            ]
        },
    ],
    "YieldExpression": [
        {
            filter(context: Context) {
                return context[CONTEXT.allowYield];
            },
            precedence: 2,
            collector: [
                {
                    token: _NonCollecting("Keyword yield"),
                    _: _NonCollecting("Punctuator *"),
                    argument: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                    delegate: _Mark(true)
                },
                {
                    token: _NonCollecting("Keyword yield"),
                    argument: EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                    delegate: _Mark(false)
                }
            ]
        },
        {
            handler([collected, parser]: Context) {
                return parser.parseIdentifier(collected.token);
            },
            filter(context: Context) {
                return !context[CONTEXT.allowYield];
            },
            collector: {
                token: "Keyword yield"
            }
        },
    ],
    "AssignmentExpression": {
        validator: "LogicalExpression",
        precedence: new Number(3),//Right-associative
        collector: {
            left: _Or(
                _Or("[Expression]").watch(
                    function (context: Context, expr: Node) {
                        context[CONTEXT.parser].err(expr);
                    }
                ),
                "AssignmentExpression",
                "MemberExpression",
                "AssignmentPattern",
                "ArrayPattern",
                "ObjectPattern",
                IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN
            ),
            operator: ASSIGNMENT_PUNCTUATORS_PATTERN,
            right: _Option("[Expression]")//占位避免错误断句
        }
    },
    "SequenceExpression": {
        handler(context: Context) {
            let [collected] = context;
            let expressions: Array<Node> = collected.expressions;
            if (expressions[0] instanceof NODES.SequenceExpression) {
                expressions[0].expressions.push(expressions[1]);
                collected.expressions = expressions[0].expressions
            }
            return collected
        },
        validator(context: Context) {
            let [, , , left, right] = context;
            if (right - left === 2) {
                return true;
            }
        },
        precedence: 1,
        collector: {
            expressions: _Series(
                EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                _NonCollecting("Punctuator ,"),
                _Option(EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN)
            )
        }

    }
}

const COMPUTED_PROPERTY_NAME_PATTERN = _Or("Punctuator []").watch(
    function (context: Context, token: Token) {
        let [collected, parser] = context;
        collected.computed = true;
        collected.key = parser.parseExpression(context, token, PRIMARY_EXPRESSION_TREE);
    }
);

const PROPERTY_NAME_PATTERN = _Or(
    _Or(
        _Or("Identifier", "Keyword", "Literal").watch(
            function (context: Context, token: Token) {
                if (token instanceof Grouping) {
                    context[CONTEXT.parser].err(token);
                }
            }
        ),
        COMPUTED_PROPERTY_NAME_PATTERN
    ).watch(
        function (context: Context) {
            let [collected, parser] = context;
            let { key } = collected;
            switch (key.type) {
                case "Keyword":
                    collected.key = parser.parseIdentifier(key);
                    break;
                case "Literal":
                    if (key.regex) {
                        parser.err(key);
                    }
                    break;
            }
        }
    )
);


const MethodDefinitions = {
    "Success": {
        handler: join_content,
        precedence: 0,
        collector: [
            {
                success: _Or(_NonCollecting(MATCH_MARKS.BOUNDARY), "Success"),
                content: "MethodDefinition",
            }
        ]
    },
    "": {
        validator(context: Context) {
            context[CONTEXT.start] = context[CONTEXT.end] = context[CONTEXT.right];
            return [];
        },
        collector: {
            _: _NonCapturing(MATCH_MARKS.BOUNDARY, "Success"),
            __: "Punctuator ;"
        }
    },
    MethodDefinition: {
        handler(context: Context) {
            let [collected] = context;
            let { value } = collected;
            collected.kind = value.kind;
            delete value.kind;
            collected.computed = value.computed;
            delete value.computed;
            collected.key = value.key;
            delete value.key;
            return collected;
        },
        collector: [
            {
                _prev: _NonCapturing(MATCH_MARKS.BOUNDARY, "Success"),
                key: _Mark(""),
                static: _Mark(true),
                computed: _Mark(false),
                _static: _NonCollecting("Identifier static"),
                value: "FunctionExpression",
                kind: _Mark(""),
            },
            [
                ["static", _Mark(false)],
                ["_static", _Mark()]
            ]
        ]
    },
    FunctionExpression: {
        handler(context: Context) {
            let [collected] = context;
            let kind = collected.kind;
            let param_count: number;
            if (typeof kind === "object") {
                collected.kind = kind.name;
                param_count = collected.kind === "get" ? 0 : 1;
            }
            parse_function_expression(context, param_count);
            return collected;
        },
        collector: [
            {
                _prev: _NonCapturing(MATCH_MARKS.BOUNDARY, "Success"),
                static: _Option(_NonCapturing("Identifier static")),
                async: _Or(
                    _Series(_Mark(true), _NonCollecting("Identifier async")),
                    _Mark(false)
                ),
                generator: _Or(
                    _Series(_Mark(true), _NonCollecting("Punctuator *")),
                    _Mark(false)
                ),
                kind: _Mark("method"),
                computed: _Mark(false),
                key: PROPERTY_NAME_PATTERN,
                id: _Mark(null),
                params: "Punctuator ()",
                expression: _Mark(false),
                body: "Punctuator {}"
            },
            [
                ["generator", _Mark(false)],
                ["kind", "Identifier get set"]
            ]
        ]
    }
}

const Arguments = {
    "Success": {
        handler: join_content,
        //precedence: 0,
        collector: {
            success: _Or(_NonCollecting(MATCH_MARKS.BOUNDARY), "Success"),
            content: _Or("SpreadElement", EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN),
            _: _NonCollecting("Punctuator ,", MATCH_MARKS.BOUNDARY),
        }
    }
}

const Params = {
    "Success": {
        handler(context: Context) {
            let [collected, parser] = context;
            if (collected.content instanceof Grouping) {
                parser.err(collected.content);
            }
            return join_content(context);
        },
        collector: [
            {
                success: _Or(_NonCollecting(MATCH_MARKS.BOUNDARY), "Success"),
                content: "AssignmentPattern",
                _: _NonCollecting("Punctuator ,", MATCH_MARKS.BOUNDARY),
            },
            ["content", _Or("Identifier").watch(validateBinding)],
            ["content", _Or("ArrayPattern", "ObjectPattern")],
            [
                ["content", "RestElement"],
                ["_", _NonCollecting(MATCH_MARKS.BOUNDARY)]
            ]
        ]
    }
}

const ArrayElements = {
    "Success": {
        handler: join_content,
        precedence: 0,
        collector: [
            {
                success: _Or(_NonCollecting(MATCH_MARKS.BOUNDARY), "Success"),
                content: _Or("SpreadElement", EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN),
                _: _NonCollecting("Punctuator ,", MATCH_MARKS.BOUNDARY),
            },
            [
                ["content", _Mark(null)],
                ["_", _NonCollecting("Punctuator ,")]
            ]
        ]
    }
}

const ObjectProperties = {
    "Success": {
        handler: join_content,
        precedence: 0,
        collector: [
            {
                success: _Or(_NonCollecting(MATCH_MARKS.BOUNDARY), "Success"),
                content: "Property",
            }
        ]
    },
    "Property": {
        handler(context: Context) {
            let [collected] = context;
            let { type, key, value, kind, computed, method, shorthand, range, loc } = collected;
            let param_count = undefined;
            switch (true) {
                case typeof kind === "object":
                    kind = kind.name;
                    param_count = kind === "get" ? 0 : 1;
                case method:
                    value = context[CONTEXT.collected] = new NODES.FunctionExpression();
                    value.async = !!collected.async;
                    value.generator = !!collected.generator;
                    value.id = null;
                    value.params = collected.params;
                    value.body = collected.body;
                    value.expression = false;
                    value.range = range;
                    value.loc = loc;
                    value = parse_function_expression(context, param_count);
                    break;
            }
            return { type, key, value: value || key, kind, computed, method, shorthand, range, loc };
        },
        collector: [
            {
                _prev: _NonCapturing(MATCH_MARKS.BOUNDARY, "Success"),
                key: PROPERTY_NAME_PATTERN,//"TemplateLiteral"
                value: _Series(_NonCollecting("Punctuator :"), EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN),
                _next: _NonCollecting(_Or(MATCH_MARKS.BOUNDARY, "Punctuator ,")),
                kind: _Mark("init"),
                computed: _Mark(false),
                method: _Mark(false),
                shorthand: _Mark(false),
            },
            [
                ["key", "Identifier"],
                ["value", _Mark(null)],
                ["shorthand", _Mark(true)]
            ],
            {
                _prev: _NonCapturing(MATCH_MARKS.BOUNDARY, "Success"),
                async: _Option("Identifier async"),
                generator: _Option("Punctuator *"),
                kind: _Mark("init"),
                key: PROPERTY_NAME_PATTERN,
                params: "Punctuator ()",
                body: "Punctuator {}",
                _next: _NonCollecting(_Or(MATCH_MARKS.BOUNDARY, "Punctuator ,")),
                computed: _Mark(false),
                method: _Mark(true),
                shorthand: _Mark(false),
            },
            [
                ["async", _Mark(false)],
                ["generator", _Mark(false)],
                ["kind", "Identifier get set"],
                ["method", _Mark(false)]
            ]
        ]
    }
}


let PRIMARY_EXPRESSION_TREE = createMatchTree(
    [Expressions, Patterns],
    undefined,
    ["SequenceExpression"]
);
let METHOD_DEFINITIONS_TREE = createMatchTree(
    MethodDefinitions, PRIMARY_EXPRESSION_TREE
);
let ARRAY_ELEMENTS_TREE = createMatchTree(ArrayElements, PRIMARY_EXPRESSION_TREE);
let OBJECT_PROPERTIES_TREE = createMatchTree(
    ObjectProperties,
    PRIMARY_EXPRESSION_TREE
);

const PARAMS_TREE = createMatchTree(
    Params,
    PRIMARY_EXPRESSION_TREE
);
const ARGUMENTS_TREE = createMatchTree(
    Arguments,
    PRIMARY_EXPRESSION_TREE
);

let EXPRESSION_TREE = createMatchTree(
    { SequenceExpression: Expressions.SequenceExpression }
    , PRIMARY_EXPRESSION_TREE
)

for (const type_name in Expressions) {
    if (type_name) {
        TYPE_ALIAS[type_name] = [type_name, "[Expression]"];
    }
}
export {
    Expressions,
    EXPRESSION_TREE,
    PRIMARY_EXPRESSION_TREE,
    parseArrayPattern,
    parseObjectPattern,
    parse_params,
    parse_arguments,
};

function parse_function_expression(context: Context, param_count?: number) {
    let [collected, parser] = context;
    let { async, generator, params, body } = collected;
    collected.params = parse_params(context, params.content);
    if (param_count !== undefined && collected.params.length !== param_count) {
        parser.err(params);
    }
    let body_context = _Context(parser, body.content);
    body_context[CONTEXT.inFunctionBody] = body.content;
    body_context[CONTEXT.strict] = context[CONTEXT.strict];
    body_context[CONTEXT.allowYield] = generator;
    body_context[CONTEXT.allowAwait] = async;
    if (generator && async) {
        parser.err(collected);
    }
    collected.body = { type: "BlockStatement", body: parser.parseBlock(body_context) };
    return collected;
}
function parse_arguments(context: Context, tokens: Array<Token>) {
    if (tokens.length) {
        let parser = context[CONTEXT.parser];
        let restore = context.store(
            CONTEXT.tokens, tokens,
            CONTEXT.spreadElement, tokens
        );
        parser.parseCustom(ARGUMENTS_TREE, context);
        context.restore(restore);
        return extract_success(parser, tokens);
    }
    return [];
}
function parse_params(context: Context, tokens: Array<Token>) {//
    if (tokens.length) {
        let parser = context[CONTEXT.parser];
        let restore = context.store(
            CONTEXT.tokens, tokens,
            CONTEXT.bindingElement, tokens
        );
        context[CONTEXT.strict] && context.wrap(CONTEXT.bindingSet, []);
        parser.parseCustom(PARAMS_TREE, context);
        context.restore(restore);
        return extract_success(parser, tokens);
    }
    return [];
}
