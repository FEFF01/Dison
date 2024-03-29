
import {
    Node, Token, Context, CONTEXT, MARKS, MatchTree
} from '../interfaces';
import {
    async_getter,
    attachLocation,
    createMatchTree,
    _Option, _Or, _Series, _NonCollecting, _NonCapturing, _Mark,
    TYPE_ALIAS, _Context, _Loop, NODES,
    validateBinding, validateLineTerminator, ASSIGNMENT_PUNCTUATORS_PATTERN, _SuccessCollector, join_content, TOPLEVEL_ITEM_PATTERN,
    extract_success,
    parse_and_extract,
    get_inner_group,
    _Pattern,
} from './head'

//import { UNIT_EXPRESSION_TREE } from './expression';
const Grouping = NODES.Grouping;

let UNIT_EXPRESSION_TREE: Record<string, any>;
let PETTERN_ELEMENTS_TREE: Record<string, any>;
let PATTERN_PROPERTIES_TREE: Record<string, any>;

//console.log(123123, UNIT_EXPRESSION_TREE, UNIT_EXPRESSION_TREE);

async_getter.get("UNIT_EXPRESSION_TREE", function (data: MatchTree) {
    UNIT_EXPRESSION_TREE = data;
    PETTERN_ELEMENTS_TREE = createMatchTree(
        PatternElements,
        UNIT_EXPRESSION_TREE
    );
    PATTERN_PROPERTIES_TREE = createMatchTree(
        PatternProperties,
        UNIT_EXPRESSION_TREE
    );
});


const Patterns: Record<string, any> = async_getter.Patterns = {
    ArrayPattern: {
        handler(context: Context) {
            let [collected] = context;
            collected.is_binding || context.wrap(CONTEXT.bindingSet, null);
            let res = parseArrayPattern(context, collected.elements);
            collected.is_binding || context.unwrap();
            return res;
        },
        precedence: 20,
        filter: [
            null,
            function (context: Context) {
                return context[CONTEXT.bindingElement]/* === context[CONTEXT.tokens]*/;
            }
        ],
        collector: [
            {
                elements: _Or("Punctuator []"),
                _next: _NonCapturing(ASSIGNMENT_PUNCTUATORS_PATTERN),//+=
            },
            {
                _prev: _NonCapturing("Punctuator  ...", MARKS.BOUNDARY, "Success"),
                elements: _Or("Punctuator []"),
                is_binding: _Mark(true)
            }
        ]
    },
    ObjectPattern: {
        handler: function (context: Context) {
            let [collected] = context;
            collected.is_binding || context.wrap(CONTEXT.bindingSet, null);
            let res = parseObjectPattern(context, collected.properties);
            collected.is_binding || context.unwrap();
            return res;
        },
        precedence: 20,
        filter: [
            null, null,
            function (context: Context, left: number, right: number) {
                return context[CONTEXT.bindingElement]/* === tokens*/
                    || context[CONTEXT.isExpression];
            },
            function (context: Context) {
                return context[CONTEXT.bindingElement] /*=== context[CONTEXT.tokens]*/;
            }
        ],
        collector: [
            {
                _prev: _NonCapturing(ASSIGNMENT_PUNCTUATORS_PATTERN),
                properties: _Or("Punctuator {}"),
                _next: _NonCapturing(ASSIGNMENT_PUNCTUATORS_PATTERN)
            },
            [
                ["_prev", _NonCapturing("Punctuator  ,")],
                ["is_binding", _Mark(true)]
            ],
            ["_prev", _Mark()],
            [
                ["_prev", _NonCapturing("Punctuator ...", MARKS.BOUNDARY, "Success")],
                ["_next", _Mark()],
            ]
        ]
    },
    AssignmentPattern: {
        filter(context: Context) {
            return context[CONTEXT.bindingElement]/* === context[CONTEXT.tokens]*/;
        },
        precedence: 1.5,
        collector: {
            _: _NonCapturing(MARKS.BOUNDARY, "Success"),
            left: _Or(
                "ArrayPattern", "ObjectPattern",
                "Identifier"
                /*_Or("Identifier").pipe(
                    function (context: Context, identifier: Node) {
                        if (identifier instanceof Grouping) {
                            context[CONTEXT.parser].err(identifier);
                        } else {
                            validateBinding(context, identifier);
                        }
                    }
                )*/
            ),
            __: _NonCollecting("Punctuator ="),
            right: "[Expression]"
        }
    },
    "": [
        {
            handler(context: Context) {
                let [{ token }, parser, left, right] = context;
                token = get_inner_group(token);
                let store = context.store(
                    CONTEXT.tokens, token.content,
                    CONTEXT.bindingElement, true,
                    CONTEXT.bindingSet, null
                );
                let node = parser.parseNode(
                    UNIT_EXPRESSION_TREE,
                    context,
                    node => parser.isExpression(node)
                        || node.type === "ArrayPattern"
                        || node.type === "ObjectPattern"
                        || node.type === "AssignmentPattern",
                );
                context.restore(store);
                if (!node) {
                    parser.err(token);
                }
                return new Grouping(node, token);
            },
            collector: [
                {
                    _prev: _NonCapturing(
                        _Series("Keyword export", "Keyword default"),
                        "Punctuator ,", "Success", TOPLEVEL_ITEM_PATTERN, ASSIGNMENT_PUNCTUATORS_PATTERN
                    ),
                    token: _Or("Punctuator ()"),
                    _next: _NonCapturing(ASSIGNMENT_PUNCTUATORS_PATTERN)
                }
            ]
        },

        {
            validator(context: Context) {
                let [, parser, , right] = context;
                let argument = context.getToken(right);
                argument instanceof Grouping && parser.err(argument);
                return true;
            },
            filter(context: Context) {
                return context[CONTEXT.spreadElement];
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
                let [, parser, , right] = context;
                let argument = context.getToken(right);
                argument instanceof Grouping && parser.err(argument);
                return true;
            },
            filter: function (context: Context) {
                return context[CONTEXT.bindingElement];
            },
            precedence: 1.5,
            collector: {
                type: _Mark("RestElement"),
                token: _NonCollecting("Punctuator ..."),
                argument: _Or(
                    /*_Or("Identifier").pipe(
                        function (context: Context, token: Token) {
                            validateBinding(context, token)
                        }
                    )*/
                    "Identifier", "MemberExpression"
                    , "ArrayPattern", "ObjectPattern"
                )
            }
        }
    ]
};
export {
    Patterns,
    parseArrayPattern,
    parseObjectPattern
}


function parseArrayPattern(context: Context, token: Token): Node {
    let pattern = new NODES.ArrayPattern();
    context.wrap(CONTEXT.bindingElement, true);
    pattern.elements = parse_and_extract(PETTERN_ELEMENTS_TREE, context, token);
    context.unwrap();
    pattern.range = token.range;
    pattern.loc = token.loc;
    return pattern;
}
function parseObjectPattern(context: Context, token: Token): Node {
    let pattern = new NODES.ObjectPattern();
    context.wrap(CONTEXT.bindingElement, true);
    pattern.properties = parse_and_extract(PATTERN_PROPERTIES_TREE, context, token);
    context.unwrap();
    pattern.range = token.range;
    pattern.loc = token.loc;
    return pattern;
}

let PatternElements = {
    Success: {
        handler: join_content,
        collector: [
            {
                success: _Or(MARKS.BOUNDARY, "Success"),
                content: _Or(
                    /*_Or("Identifier").pipe(
                        function (context: Context, identifier: Token) {
                            if (identifier instanceof Grouping) {
                                context[CONTEXT.parser].err(identifier);
                            } else {
                            validateBinding(context, identifier);
                            }
                        }
                    ),*/
                    "Identifier", "MemberExpression",
                    _Or("ArrayPattern", "ObjectPattern", "AssignmentPattern")
                ),
                _next: _NonCollecting(_Or("Punctuator ,", MARKS.BOUNDARY))
            },
            [
                ["content", "RestElement"],
                ["_next", _NonCollecting(MARKS.BOUNDARY)]
            ],
            {
                success: _Or(MARKS.BOUNDARY, "Success"),
                content: _Mark(null),
                _next: _NonCollecting("Punctuator ,")
            }
        ]
    }
}


const PatternProperties = {
    ..._SuccessCollector(_Pattern("Property")),
    Property: [
        {
            collector: [
                {
                    _prev: _NonCapturing(MARKS.BOUNDARY, "Success"),
                    key: _Or("Punctuator []").pipe(
                        function (context: Context, token: Token) {
                            context.wrap(CONTEXT.tokens, token.content);
                            let res = context[CONTEXT.parser].parseExpression(context);
                            context.unwrap();
                            return res;
                        }
                    ),
                    value: _Series(
                        _NonCollecting("Punctuator :"),
                        _Or(
                            /*_Or("Identifier").pipe(function (context: Context, token: Token) {
                                validateBinding(context, token);
                            }),
                            _Or("MemberExpression"),*/
                            "Identifier", "MemberExpression",
                            _Or("Punctuator []").pipe(parseArrayPattern),
                            _Or("Punctuator {}").pipe(parseObjectPattern),
                        ),
                        _Option(_Series(_NonCollecting("Punctuator ="), "[Expression]")),
                        _Mark(
                            function (context: Context) {
                                let [collected] = context;
                                let { value } = collected;
                                if (value.length > 1) {
                                    let _value = new NODES.AssignmentPattern();
                                    _value.left = value[0];
                                    _value.right = value[1];
                                    attachLocation(_value, value[0], value[1]);
                                    collected.value = _value;
                                } else {
                                    collected.value = value[0];
                                }
                                return undefined;
                            }
                        )
                    ),
                    _next: _NonCollecting(MARKS.BOUNDARY, "Punctuator ,"),
                    computed: _Mark(true),
                    kind: _Mark("init"),
                    method: _Mark(false),
                    shorthand: _Mark(false),
                },
                [
                    [
                        "key",
                        _Or("Identifier").pipe(
                            function (context: Context, identifier: Node) {
                                if (identifier instanceof Grouping) {
                                    context[CONTEXT.parser].err(identifier);
                                }
                            }
                        )
                    ],
                    ["computed", _Mark(false)]
                ],
                [
                    [
                        "value", _Or(
                            _Series(_NonCollecting("Punctuator ="), "[Expression]").pipe(
                                function (context: Context, token: Token) {
                                    let [collected] = context;
                                    let left = collected.key;
                                    let res = new NODES.AssignmentPattern();
                                    res.left = left;
                                    res.right = token;
                                    attachLocation(res, left, token);
                                    return res;
                                }
                            ),
                            _Mark(
                                function (context: Context) {
                                    return context[CONTEXT.collected].key;
                                }
                            )
                        )
                    ],
                    [
                        "shorthand",
                        _Mark(true)
                        /*_Mark(
                            function (context: Context) {
                                validateBinding(context, context[CONTEXT.collected].key);
                                return true;
                            }
                        )*/
                    ]
                ]
            ]
        },
        {
            validator() {//匹配占位
                return false;
            },
            precedence: new Number(3),
            collector: {
                __: _Series(
                    _Or(MARKS.BOUNDARY, "Success"),
                    _Or(
                        "Punctuator []",
                        "Identifier",
                    ),
                    "Punctuator :",
                    _Or(
                        "Identifier",
                        "Punctuator [] {}",
                    ),
                    "Punctuator ="
                )
            }
        }
    ]
}
