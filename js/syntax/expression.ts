import {
    Node, Token, Context, CONTEXT, MATCHED, MatchTree, MARKS
} from '../interfaces';
import {
    async_getter,
    token_hooks,
    _Punctuator,
    _Keyword,
    _Identifier,
    _Pattern,
    _Validate,
    is_right_parentheses,
    is_right_brackets,
    is_right_braces,
    createMatchTree,
    _Option, _Or, _Series, _NonCollecting, _NonCapturing, _Mark,
    TYPE_ALIAS, _Context, _Loop, NODES, validateIdentifier, validateAssignment,
    validateBinding, validateLineTerminator, ASSIGNMENT_PUNCTUATORS_PATTERN, _SuccessCollector, join_content,

    IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
    EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
    IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
    EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
    TOPLEVEL_ITEM_PATTERN,
    isAligned,
    attachLocation,

    reinterpretIdentifierAsKeyword,
    reinterpretKeywordAsIdentifier,

    extract_success,
    parse_and_extract,
} from './head'

import Parser from '../parser'
import Tokenizer from '../tokenizer'

import {
    parseArrayPattern,
    parseObjectPattern
} from './pattern';
const Grouping = NODES.Grouping;

init_token_hooks();

function walk_primary_expression(context: Context, index: number) {
    context[CONTEXT.parser].parseRange(PRIMARY_EXPRESSION_TREE, context, index, is_right_parentheses);
}


const ARGUMENTS_PATTERN = _Or(
    _Punctuator("(").walk(
        walk_primary_expression
    ),
    "Punctuator ()"
).pipe(
    function (context: Context, token: Token, index: number) {
        let parser = context[CONTEXT.parser];
        let store = context.store(
            CONTEXT.bindingElement, false,
            CONTEXT.spreadElement, true,
            CONTEXT.tokens, token.content
        );
        let res = parser.parseNode(ARGUMENTS_TREE, context, function (node: Token) { return node.type === "Success"; })
        context.restore(store);
        return res ? res.content : [];
    }
);


const PARAMS_PATTERN = _Or(
    _Punctuator("(").walk(
        function (context: Context, left: number) {
            let parser = context[CONTEXT.parser];
            let store = context.store(
                CONTEXT.bindingElement, true,
                CONTEXT.spreadElement, true,
                CONTEXT.bindingSet, []
            );
            parser.parseRange(
                PARAMS_TREE, context, left, is_right_parentheses,
                function (node: Token) { return node.type === "Success"; }
            ).type = "Params";
            context.restore(store);
        }
    ), _Pattern("Params")
).pipe(
    function (context: Context, token: Token, left: number) {
        let [collected, parser] = context;
        let kind = collected.kind;
        let params = token.content ? token.content.content : [];
        let params_count = kind === "get" ? 0 : kind === "set" ? 1 : false;
        if (params_count !== false && params.length !== params_count) {
            parser.err(...params.splice(params_count, params.length - params_count));
        }
        return params;
    }
);
const BODY_PATTERN = _Or(
    _Punctuator("{").walk(
        function (context: Context, left: number) {
            let generator = !!this.generator, async = !!this.async;
            let parser = context[CONTEXT.parser];
            let body_context = _Context(parser);
            body_context[CONTEXT.inFunctionBody] = left + 1;
            body_context[CONTEXT.strict] = context[CONTEXT.strict];
            body_context[CONTEXT.allowYield] = generator;
            body_context[CONTEXT.allowAwait] = async;

            let node = parser.parseRangeAsBlock(body_context, left);
            /*parser.parseRange(
                parser.SYNTAX_TREE, body_context, left, is_right_braces
            )*/
            node.type = "Body";
            node.generator = generator;
            node.async = async;
            let block = new NODES.BlockStatement();
            block.body = node.content;
            attachLocation(block, node);
            node.content = block;
        },
        true
    ), "Body"
);
const FUNCTION_BODY_PATTERN = _Or(
    BODY_PATTERN
).pipe(
    function (context: Context, token: Token) {
        return token.content;
    }
);

const PrimaryExpressions: Record<string, any> = {
    "": [
        {
            collector: {
                type: _Mark("Punctuator"),
                value: _Mark("{}"),
                content: _Punctuator("{").pipe(
                    function (context: Context, token: Token, left: number) {
                        return context[CONTEXT.parser].parseRange(
                            PROPERTIES_TREE, context, left, is_right_braces
                        ).content || [];
                    }
                )
            }
        },
        {
            collector: {
                type: _Mark("Punctuator"),
                value: _Mark("()"),
                content: _Punctuator("(").walk(
                    walk_primary_expression
                ).pipe(
                    function (context: Context, token: Token, index: number) {
                        return token.content;
                    }
                )
            }
        },
        {
            collector: {
                type: _Mark("Punctuator"),
                value: _Mark("[]"),
                content: _Punctuator("[").pipe(
                    function (context: Context, node: Node, index: number) {
                        return context[CONTEXT.parser].parseRange(
                            PRIMARY_EXPRESSION_TREE, context, index, is_right_brackets
                        ).content;
                    }
                )
            }
        },
    ],
    "Identifier": [
    ],
    "Literal": [//已在 tokenizer => token_hooks 中处理
    ],
    "ThisExpression": {
        collector: {
            token: _NonCollecting("Keyword this")
        }
    },
    "TemplateLiteral": {
        filter(context: Context, left: number, right: number) {
            let value = context.getToken(right).value;
            return value[0] === "`";
        },
        collector: [
            {
                _: _NonCapturing(_Option("[Expression]")),
                expressions: _Mark(() => []),
                quasis: _Pattern("Template").pipe(
                    function (context: Context, token: Token, index: number) {
                        let [collected, parser] = context;
                        let value: string;
                        let expressions = collected.expressions;
                        let quasis = [];
                        let tail: boolean = false;
                        let end: number;
                        while (true) {
                            token = context.getToken(index);
                            value = token.value;
                            token.value = "";
                            if (value[value.length - 1] === "`") {
                                end = -1;
                                tail = true;
                            } else {
                                end = -2;
                                tail = false;
                            }
                            quasis.push(
                                {
                                    type: "TemplateElement",
                                    value: {
                                        raw: value.slice(1, end),
                                        cooked: parser._volatility
                                    },
                                    tail
                                }
                            );
                            if (tail) {
                                break;
                            }
                            expressions.push(
                                parser.parseRangeAsExpression(context, index,
                                    function (token: Token) {
                                        return token.type === parser.TYPE_ENUMS.Template
                                            && token.value[0] === "}";
                                    }
                                )
                            )
                        }
                        return quasis;
                    }
                ),
            }
        ]
    },
    "FunctionExpression": [

        {
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
                    params: PARAMS_PATTERN,
                    body: FUNCTION_BODY_PATTERN,
                    expression: _Mark(false)
                }
            ]
        },
        {
            validator(context: Context) {
                let [, parser, left] = context;
                context[CONTEXT.start] = context[CONTEXT.end] = left;
                return reinterpretIdentifierAsKeyword(context.getToken(left))
                //return parser.parseKeyword(context.getToken(left));
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
                    params: _NonCapturing(
                        _Punctuator("(").walk(
                            walk_primary_expression
                        ), "Punctuator ()", "Identifier"),
                    token: _NonCapturing("Punctuator =>"),
                },
            ]
        }
    ],
    "ArrowFunctionExpression": {
        handler: [
            null,
            function (context: Context) {
                let [collected, parser, left, right] = context;
                let token = context.getToken(right);
                token.value = "_=>";
                let body_context = _Context(parser);
                body_context[CONTEXT.strict] = context[CONTEXT.strict];
                body_context[CONTEXT.allowAwait] = collected.async;
                if (
                    parser.parseCustom(
                        parser.EXPRESSION_TREE,
                        body_context,
                        left,
                        (node: Node) => true
                    )
                ) {
                    return null;
                }
            },
            null
        ],
        precedence: [3, true, new Number(3)],
        collector: [
            {//占位使 () 不会被单独收集为表达式
                async: _Or(
                    _Series(_Mark(true), _NonCollecting("Keyword async")),
                    _Mark(false)
                ),
                generator: _Mark(false),
                id: _Mark(null),
                params: _Or(
                    _Punctuator("()").pipe(
                        function (context: Context, token: Token) {
                            context.wrap(CONTEXT.tokens, token.content);
                            let res = parse_params(context, token.content);
                            context.unwrap();
                            return res;
                        }
                    ),
                    _Pattern("Identifier").pipe(
                        function (context: Context, token: Token) {
                            validateAssignment(context, token);
                            return [token];
                        }
                    )
                ),
                token: _NonCollecting("Punctuator =>"),
                body: FUNCTION_BODY_PATTERN,
                expression: _Mark(false)
            },
            ["body", _Mark()],
            [
                //_=>作用为隔断匹配，使后续的表达式使用当前方法声明的环境
                ["token", _NonCollecting("Punctuator _=>")],//"Punctuator _=>"
                ["body", "[Expression]"],
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
                body:
                    _Punctuator("{").pipe(
                        function (context: Context, token: Token, left: number) {
                            let parser = context[CONTEXT.parser];
                            let res = parser.parseRange(
                                METHOD_DEFINITIONS_TREE, context, left, is_right_braces,
                                function (node: Token) { return node.type === "Success"; }
                            );

                            return {
                                type: "ClassBody",
                                body: res.content?.content || [],
                                range: res.range,
                                loc: res.loc
                            };
                        }
                    )
            }
        ]
    },
    "Super": {
        validator(context: Context) {
            let [, parser, left, right] = context;
            if (!context[CONTEXT.inFunctionBody] || right === left) {
                parser.err(context.getToken(left));
            }
            return true;
        },
        collector: {
            token: _NonCollecting("Keyword super"),
            _next: _NonCapturing("Punctuator ( . [")
        }
    },
}

const Expressions: Record<string, any> = async_getter.Expressions = {
    ...PrimaryExpressions,
    "": PrimaryExpressions[""].concat(
        {
            validator(context: Context) {
                let parser = context[CONTEXT.parser];
                let left = context[CONTEXT.left];
                let token = context.getToken(left);
                let store = context.store(
                    CONTEXT.bindingSet, null,
                    CONTEXT.bindingElement, false,
                    CONTEXT.tokens, token.content
                );
                let grouping = new Grouping(
                    parser.parseExpression(context)
                );
                context.restore(store);
                context[CONTEXT.start] = context[CONTEXT.end] = left;
                return grouping;
            },
            collector: {
                token: "Punctuator ()"
            }
        }
    ),
    "ArrayExpression": {
        precedence: 20,
        collector: {
            elements: _Punctuator("[]").pipe(
                function (context: Context, node: Node, index: number) {
                    let store = context.store(
                        CONTEXT.spreadElement, true,
                        CONTEXT.bindingElement, false
                    );
                    let res = parse_and_extract(ARRAY_ELEMENTS_TREE, context, node);
                    context.restore(store);
                    return res;
                }
            ),
        }

    },
    "ObjectExpression": {
        precedence: 20,
        collector: {
            properties: _Punctuator("{}").pipe(
                function (context: Context, node: Node, index: number) {
                    return parse_and_extract(OBJECT_PROPERTIES_TREE, context, node);
                    //return node.content || [];
                }
            ),
        }

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
                        _Pattern("Keyword").pipe(
                            function (context: Context, token: Token) {
                                return reinterpretKeywordAsIdentifier(token);
                                //return context[CONTEXT.parser].parseIdentifier(token);
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
                object: EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN,
                property: _Or(
                    _Punctuator("[").pipe(
                        function (context: Context, token: Token, left: number) {
                            let store = context.store(CONTEXT.bindingElement, false);
                            let res = context[CONTEXT.parser].parseRangeAsExpression(context, left, is_right_brackets);
                            context.restore(store);
                            return res;
                        }
                    ),
                    _Punctuator("[]").pipe(
                        function (context: Context, token: Token, left: number) {
                            let store = context.store(CONTEXT.tokens, token.content, CONTEXT.bindingElement, false);
                            let res = context[CONTEXT.parser].parseExpression(context);
                            context.restore(store);
                            return res;
                        }
                    )
                ),
                computed: _Mark(true)
            }
        }
    ],

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
        precedence: new Number(20)/*_Precedence(20, PRECEDENCE_FEATURES.RIGHT_TERMINAL)*/,//memberexpression new Number(20)
        collector: [
            {
                token: _NonCollecting("Keyword new"),
                callee: _Or(
                    EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN,
                    _Pattern("ArrowFunctionExpression").pipe(
                        function (context: Context, token: Token) {
                            context[CONTEXT.parser].err(token);
                        }
                    )
                ),
                arguments: _Or(_Mark(() => []), ARGUMENTS_PATTERN)
            }
        ]
    },
    "CallExpression": {
        precedence: 20/* _Precedence(20, PRECEDENCE_FEATURES.RIGHT_TERMINAL)*/,
        filter(context: Context, left: number) {
            let tokens = context.tokens;
            let first_token = tokens[left], second_token = tokens[left + 1];
            if (second_token === context[CONTEXT.rightAssociativeNode]) {
                return false;
            }
            let first_token_type = first_token.type;
            if (
                first_token instanceof Grouping
                || first_token_type !== "ArrowFunctionExpression"
            ) {
                return true;
            }
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
                prefix: _Mark(true),
                /*_: _++a(b)*/
            }
        },
        {
            validator(context: Context) {
                let collected = context[CONTEXT.parser].createNode(context);
                collected.operator = collected.operator.value;
                return collected;
            },
            filter(context: Context, left: number, right: number) {
                return isAligned(context, left, left + 1);
            },
            precedence: 18,
            collector: {
                argument: _Or("MemberExpression", IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN),
                operator: "Punctuator ++ --",
                prefix: _Mark(false),
                _: _Option(
                    _NonCapturing(
                        _Punctuator("[", "(").pipe(
                            function (context: Context, token: Token) {
                                context[CONTEXT.rightAssociativeNode] = token;
                            }
                        ),
                        _Punctuator(".").pipe(
                            function (context: Context, token: Token) {
                                context[CONTEXT.parser].err(token);
                            }
                        )
                    )
                )
            }
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
            handler([{ token }]: Context) {
                return reinterpretKeywordAsIdentifier(token);
                //return parser.parseIdentifier(collected.token);
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
                let [, parser, left, right] = context;
                if (right - left >= 4) {
                    return true;
                }
                if (!context[CONTEXT.isExpression] || context[CONTEXT.bindingElement]) {
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
            /*filter(context: Context) {
                return context[CONTEXT.allowYield];
            },*/
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
        /*{
            handler([{ token }]: Context) {
                return reinterpretKeywordAsIdentifier(token)
                //return parser.parseIdentifier(collected.token);
            },
            filter(context: Context) {
                return !context[CONTEXT.allowYield];
            },
            collector: {
                token: "Keyword yield"
            }
        },*/
    ],
    "AssignmentExpression": {
        validator: "LogicalExpression",
        precedence: new Number(3),//Right-associative
        collector: {
            left: _Or(
                _Or("[Expression]").pipe(
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
            let [, , left, right] = context;
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

const COMPUTED_PROPERTY_NAME_PATTERN = _Punctuator("[]").pipe(
    function (context: Context, token: Token) {
        let [collected, parser] = context;
        collected.computed = true;
        context.wrap(CONTEXT.tokens, token.content)
        let res = parser.parseExpression(context);
        context.unwrap();
        return res;
    }
);

const LITERAL_PROPERTY_NAME_PATTERN = _Or("Identifier", "Keyword", "Literal").pipe(
    function (context: Context, key: Token) {
        let [, parser] = context;
        if (key instanceof Grouping) {
            parser.err(key);
        } else {
            switch (key.type) {
                case "Keyword":
                    return reinterpretKeywordAsIdentifier(key);
                //return parser.parseIdentifier(key);
                case "Literal":
                    if (key.regex) {
                        parser.err(key);
                    }
                    break;
            }
        }
    }
);
const PROPERTY_NAME_PATTERN = _Or(COMPUTED_PROPERTY_NAME_PATTERN, LITERAL_PROPERTY_NAME_PATTERN);


const MethodDefinitions = {
    ..._SuccessCollector(_Pattern("MethodDefinition")),
    "": {
        validator(context: Context) {
            context[CONTEXT.start] = context[CONTEXT.end] = context[CONTEXT.right];
            return [];
        },
        collector: {
            _: _NonCapturing(MARKS.BOUNDARY, "Success"),
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
                _prev: _NonCapturing(MARKS.BOUNDARY, "Success"),
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
        collector: [
            {
                _prev: _NonCapturing(MARKS.BOUNDARY, "Success"),
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
                params: PARAMS_PATTERN,
                expression: _Mark(false),
                body: FUNCTION_BODY_PATTERN
            },
            [
                ["generator", _Mark(false)],
                [
                    "kind", _Or("Identifier get set").pipe(
                        function (context: Context, token: Token, left: number) {
                            return token.value;
                        }
                    )
                ]
            ]
        ]
    }
}

const Arguments = {
    "Success": {
        handler: join_content,
        //precedence: 0,
        collector: {
            success: _Or(_NonCollecting(MARKS.BOUNDARY), "Success"),
            content: _Or("SpreadElement", EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN),
            _: _Or(_NonCollecting("Punctuator ,"), MARKS.BOUNDARY, _NonCapturing("Punctuator )")),
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
                success: _Or(_NonCollecting(MARKS.BOUNDARY), "Success"),
                content: "AssignmentPattern",
                _: _Or(_NonCollecting("Punctuator ,", MARKS.BOUNDARY), _NonCapturing("Punctuator )")),
            },
            [
                "content", _Or("Identifier").pipe(
                    function (context: Context, token: Token) {
                        validateBinding(context, token);
                    }
                )
            ],
            ["content", _Or("ArrayPattern", "ObjectPattern")],
            [
                ["content", "RestElement"],
                ["_", _Or(_NonCollecting(MARKS.BOUNDARY), _NonCapturing("Punctuator )"))]
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
                success: _Or(_NonCollecting(MARKS.BOUNDARY), "Success"),
                content: _Or("SpreadElement", EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN),
                _: _NonCollecting("Punctuator ,", MARKS.BOUNDARY),
            },
            [
                ["content", _Mark(null)],
                ["_", _NonCollecting("Punctuator ,")]
            ]
        ]
    }
}

const Properties = {
    "Property": {
        handler(context: Context) {
            let [collected, parser, left, right] = context;
            let { value: [params, body] } = collected;
            let expr = new NODES.FunctionExpression();
            expr.id = null;
            expr.params = params;
            expr.body = body.content;
            expr.generator = body.generator;
            expr.expression = false;
            expr.async = body.async;
            attachLocation(expr, collected, context.getToken(right - 1));
            collected.value = expr;
            collected.type = "ObjectProperty"
            return collected;
        },
        collector: [
            {
                _prev: _NonCapturing(MARKS.BOUNDARY, "Punctuator ,", "ObjectProperty"),
                async: _Option(_NonCollecting("Identifier async")),
                generator: _Option(_NonCollecting("Punctuator *")),
                kind: _Mark("init"),
                computed: _Mark(false),
                key: PROPERTY_NAME_PATTERN,
                value: _Series(PARAMS_PATTERN, BODY_PATTERN),
                _next: _Or(
                    _NonCollecting(MARKS.BOUNDARY, "Punctuator ,"),
                    _NonCapturing("Punctuator }")
                ),
                //_NonCapturing(MATCH_MARKS.BOUNDARY, "Punctuator ,", "Punctuator }"),
                method: _Mark(true),
                shorthand: _Mark(false)
            },
            [
                ["async", _Mark()],
                ["generator", _Mark()],
                [
                    "kind", _Or(
                        _Series(_NonCollecting("Identifier get"), _Mark("get")),
                        _Series(_NonCollecting("Identifier set"), _Mark("set"))
                    )
                ],//"Identifier get set"
                ["method", _Mark(false)]
            ]
        ]
    }
}

const ObjectProperties = {
    ..._SuccessCollector(_Or(
        "Property",
        _Or("ObjectProperty").pipe(
            function (context: Context, token: Token) {
                token.type = "Property";
            }
        )
    )),
    "Property": {
        collector: [
            {
                _prev: _NonCapturing(MARKS.BOUNDARY, "Success"),
                key: PROPERTY_NAME_PATTERN,//"TemplateLiteral"
                value: _Series(
                    _NonCollecting("Punctuator :"),
                    EXPRESSION_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN
                ),
                _next: _Or(_NonCollecting(MARKS.BOUNDARY, "Punctuator ,"), _NonCapturing("Punctuator }")),
                kind: _Mark("init"),
                computed: _Mark(false),
                method: _Mark(false),
                shorthand: _Mark(false),
            },
            [
                ["key", "Identifier"],
                ["value", (window as any).test1 = _Mark(function (context: Context) {
                    return context[CONTEXT.collected].key;
                })],
                ["shorthand", _Mark(true)]
            ]
        ]
    }
}
/*
let PRIMARY_EXPRESSION_TREE = createMatchTree(
    PrimaryExpressions
)
let METHOD_DEFINITIONS_TREE = createMatchTree(
    MethodDefinitions, PRIMARY_EXPRESSION_TREE
);
let PROPERTIES_TREE = createMatchTree(
    Properties,
    PRIMARY_EXPRESSION_TREE
);*/

let PRIMARY_EXPRESSION_TREE: MatchTree,
    METHOD_DEFINITIONS_TREE: MatchTree,
    PROPERTIES_TREE: MatchTree,
    UNIT_EXPRESSION_TREE: MatchTree,
    ARRAY_ELEMENTS_TREE: MatchTree,
    OBJECT_PROPERTIES_TREE: MatchTree,
    PARAMS_TREE: MatchTree,
    ARGUMENTS_TREE: MatchTree,
    EXPRESSION_TREE: MatchTree;



async_getter.get(
    "Patterns",
    function (Patterns: Record<string, any>) {
        PRIMARY_EXPRESSION_TREE = createMatchTree(
            PrimaryExpressions
        )
        METHOD_DEFINITIONS_TREE = createMatchTree(
            MethodDefinitions, PRIMARY_EXPRESSION_TREE
        );
        PROPERTIES_TREE = createMatchTree(
            Properties,
            PRIMARY_EXPRESSION_TREE
        );

        UNIT_EXPRESSION_TREE = createMatchTree(
            [Expressions, Patterns],
            undefined,
            ["SequenceExpression"]
        );
        ARRAY_ELEMENTS_TREE = createMatchTree(ArrayElements, UNIT_EXPRESSION_TREE);

        OBJECT_PROPERTIES_TREE = createMatchTree(
            ObjectProperties,
            UNIT_EXPRESSION_TREE
        );
        PARAMS_TREE = createMatchTree(
            Params,
            UNIT_EXPRESSION_TREE
        );
        ARGUMENTS_TREE = createMatchTree(
            Arguments,
            UNIT_EXPRESSION_TREE
        );
        EXPRESSION_TREE = createMatchTree(
            { SequenceExpression: Expressions.SequenceExpression }
            , UNIT_EXPRESSION_TREE
        );
        async_getter.EXPRESSION_TREE = EXPRESSION_TREE;
        async_getter.UNIT_EXPRESSION_TREE = UNIT_EXPRESSION_TREE;
    }
)


async_getter.get("Expressions", function (expressions: Record<string, any>) {
    for (const type_name in expressions) {
        if (type_name) {
            TYPE_ALIAS[type_name] = [type_name, "[Expression]"];
        }
    }
});
export default Expressions;
export {
    PrimaryExpressions,
    Expressions,
    parseArrayPattern,
    parseObjectPattern,
    parse_params
};
function parse_params(context: Context, tokens: Array<Token>) {//
    if (tokens.length) {
        let parser = context[CONTEXT.parser];
        let restore = context.store(
            CONTEXT.tokens, tokens,
            CONTEXT.bindingElement, true
        );
        context[CONTEXT.strict] && context.wrap(CONTEXT.bindingSet, []);
        parser.parseCustom(PARAMS_TREE, context);
        context.restore(restore);
        return extract_success(parser, tokens);
    }
    return [];
}


function init_token_hooks() {
    function getLiteral(parse_value: (token: Token, tokenizer: Tokenizer) => any, token: Token, tokenizer: Tokenizer) {
        return {
            type: "Literal",
            value: parse_value(token, tokenizer),
            raw: token.value,
            range: token.range,
            loc: token.loc
        }
    }

    let getStringLiteral = getLiteral.bind(null, (token: Token, tokenizer: Tokenizer) => tokenizer._volatility);
    let getRegularLiteral = getLiteral.bind(null, (token: Token, tokenizer: Tokenizer) => {
        let regex = token.regex;
        try {
            return new RegExp(regex.pattern, regex.flags);
        } catch (e) {
            return null;
        }
    });

    token_hooks.Keyword = function (token: Token, parser: Parser) {
        let context = parser.context_stack[0];
        if (!context[CONTEXT.allowYield] && token.value === "yield") {
            return reinterpretKeywordAsIdentifier(token);
        }
        return token;
    };
    token_hooks.Identifier = reinterpretKeywordAsIdentifier;
    token_hooks.Numeric = getLiteral.bind(null, (token: Token) => Number(token.value));
    token_hooks.Boolean = getLiteral.bind(null, (token: Token) => token.value === "true");
    token_hooks.String = function (token: Token, parser: Parser) {
        token = getStringLiteral(token, parser);
        if (parser._scopes.octal && parser.context_stack[0][CONTEXT.strict]) {
            parser.err(token);
        }
        return token;
    };
    token_hooks.Null = getLiteral.bind(null, () => null);
    token_hooks.RegularExpression = function (token: Token, tokenizer: Tokenizer) {
        let res = getRegularLiteral(token, tokenizer);
        res.regex = token.regex;
        return res;
    };
}
