
import {
    Node, Token, Context, CONTEXT
} from '../interfaces';
import {
    attachLocation,
    createMatchTree,
    _Option, _Or, _Series, _NonCollecting, _NonCapturing, _Mark,
    TYPE_ALIAS, _Context, _Loop, NODES, MATCH_MARKS,
    validateBinding, validateLineTerminator, ASSIGNMENT_PUNCTUATORS_PATTERN, join_content, AWAIT_LIST, TOPLEVEL_ITEM_PATTERN
} from './head'
import { isExpression, isStatementListItem, get_inner_group, parse_and_extract } from './index';

import { UNIT_EXPRESSION_TREE } from './expression';
const Grouping = NODES.Grouping;

let PETTERN_ELEMENTS_TREE: Record<string, any>;
let PATTERN_PROPERTIES_TREE: Record<string, any>;

AWAIT_LIST.push(function () {
    PETTERN_ELEMENTS_TREE = createMatchTree(
        PatternElements,
        UNIT_EXPRESSION_TREE
    );
    PATTERN_PROPERTIES_TREE = createMatchTree(
        PatternProperties,
        UNIT_EXPRESSION_TREE
    );
});


const Patterns: Record<string, any> = {
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
                _prev: _NonCapturing("Punctuator  ...", MATCH_MARKS.BOUNDARY, "Success"),
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
                ["_prev", _NonCapturing("Punctuator ...", MATCH_MARKS.BOUNDARY, "Success")],
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
            _: _NonCapturing(MATCH_MARKS.BOUNDARY, "Success"),
            left: _Or(
                "ArrayPattern", "ObjectPattern",
                _Or("Identifier").pipe(
                    function (context: Context, identifier: Node) {
                        if (identifier instanceof Grouping) {
                            context[CONTEXT.parser].err(identifier);
                        } else {
                            validateBinding(context, identifier);
                        }
                    }
                )
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
                    node => isExpression(node)
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
                argument: _Or(_Or("Identifier").pipe(
                    function (context: Context, token: Token) {
                        validateBinding(context, token)
                    }
                ), "ArrayPattern", "ObjectPattern")
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
                success: _Or(MATCH_MARKS.BOUNDARY, "Success"),
                content: _Or(
                    _Or("Identifier").pipe(
                        function (context: Context, identifier: Token) {
                            if (identifier instanceof Grouping) {
                                context[CONTEXT.parser].err(identifier);
                            } else {
                                validateBinding(context, identifier);
                            }
                        }
                    ),
                    _Or("ArrayPattern", "ObjectPattern", "AssignmentPattern")
                ),
                _next: _NonCollecting(_Or("Punctuator ,", MATCH_MARKS.BOUNDARY))
            },
            [
                ["content", "RestElement"],
                ["_next", _NonCollecting(MATCH_MARKS.BOUNDARY)]
            ],
            {
                success: _Or(MATCH_MARKS.BOUNDARY, "Success"),
                content: _Mark(null),
                _next: _NonCollecting("Punctuator ,")
            }
        ]
    }
}


const PatternProperties = {
    Success: {
        handler: join_content,
        //precedence: 0,
        collector: {
            success: _Or(_NonCollecting(MATCH_MARKS.BOUNDARY), "Success"),
            content: "Property",
        }
    },
    Property: [
        {
            collector: [
                {
                    _prev: _NonCapturing(MATCH_MARKS.BOUNDARY, "Success"),
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
                            _Or("Identifier").pipe(function (context: Context, token: Token) {
                                validateBinding(context, token);
                            }),
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
                    _next: _NonCollecting(MATCH_MARKS.BOUNDARY, "Punctuator ,"),
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
                        _Mark(
                            function (context: Context) {
                                validateBinding(context, context[CONTEXT.collected].key);
                                return true;
                            }
                        )
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
                    _Or(MATCH_MARKS.BOUNDARY, "Success"),
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
