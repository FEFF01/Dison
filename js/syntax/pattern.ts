
import {
    Node, Token, Context, CONTEXT
} from '../interfaces';
import {
    createMatchTree,
    _Option, _Or, _Series, _NonCollecting, _NonCapturing, _Mark,
    TYPE_ALIAS, _Context, _Loop, NODES, MATCH_MARKS,
    validateBinding, validateLineTerminator, ASSIGNMENT_PUNCTUATORS_PATTERN, join_content, AWAIT_LIST
} from './head'
import { isExpression, isStatementListItem, get_inner_group, parse_and_extract } from './index';

import { PRIMARY_EXPRESSION_TREE } from './expression';
//import { MEMBER_EXPRESSION_TREE } from './expression';
const Grouping = NODES.Grouping;

let PETTERN_ELEMENTS_TREE: Record<string, any>;
let PATTERN_PROPERTIES_TREE: Record<string, any>;

AWAIT_LIST.push(function () {
    //({ MEMBER_EXPRESSION_TREE } = await require('./expression'));
    PETTERN_ELEMENTS_TREE = createMatchTree(
        PatternElements,
        PRIMARY_EXPRESSION_TREE
    );
    PATTERN_PROPERTIES_TREE = createMatchTree(
        PatternProperties,
        PRIMARY_EXPRESSION_TREE
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
                return context[CONTEXT.bindingElement] === context[CONTEXT.tokens];
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
                let tokens = context[CONTEXT.tokens];
                return context[CONTEXT.bindingElement] === tokens
                    || context[CONTEXT.isExpression];
            },
            function (context: Context) {
                return context[CONTEXT.bindingElement] === context[CONTEXT.tokens];
            }
        ],
        collector: [
            {
                type: _Mark("ObjectPattern"),
                _prev: _NonCapturing(ASSIGNMENT_PUNCTUATORS_PATTERN),
                properties: _Or("Punctuator {}"),
                _next: _NonCapturing(ASSIGNMENT_PUNCTUATORS_PATTERN)
            },
            [
                ["_prev", _NonCapturing("Punctuator  ,")],
                ["is_binding", _Mark(true)]
            ],
            ["_prev", _Mark()],
            {
                type: _Mark("ObjectPattern"),
                _prev: _NonCapturing("Punctuator ...", MATCH_MARKS.BOUNDARY, "Success"),
                properties: _Or("Punctuator {}"),
                is_binding: _Mark(true)
            }
        ]
    },
    AssignmentPattern: {
        filter(context: Context) {
            return context[CONTEXT.bindingElement] === context[CONTEXT.tokens];
        },
        precedence: 1.5,
        collector: {
            _: _NonCapturing(MATCH_MARKS.BOUNDARY, "Success"),
            left: _Or(
                "ArrayPattern", "ObjectPattern",
                _Or("Identifier").watch(
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
    "": {
        handler(context: Context) {
            let [{ token }, parser, tokens, left, right] = context;
            if (right - left >= 2 && context[CONTEXT.bindingElement] === tokens) {
                parser.err(token);
            }
            token = get_inner_group(token);
            let store = context.store(CONTEXT.bindingElement, token.content, CONTEXT.bindingSet, null);
            let node = parser.parseNode(
                PRIMARY_EXPRESSION_TREE,
                node => isExpression(node)
                    || node.type === "ArrayPattern"
                    || node.type === "ObjectPattern"
                    || node.type === "AssignmentPattern",
                context,
                token
            );
            context.restore(store);
            return new Grouping(node, token);
        },
        precedence: [100, new Number(3)],
        collector: [
            {
                _prev: _NonCapturing("Punctuator ,", MATCH_MARKS.BOUNDARY, "Success"),
                token: _Or("Punctuator ()"),
                _next: _NonCapturing(ASSIGNMENT_PUNCTUATORS_PATTERN)
            },
            [
                ["_prev", _Mark()],
                ["prevent_binding", _Mark(true)]
            ]
        ]
    }
};
export {
    Patterns,
    parseArrayPattern,
    parseObjectPattern
}


function parseArrayPattern(context: Context, token: Token): Node {
    let pattern = new NODES.ArrayPattern();
    context.wrap(CONTEXT.bindingElement, token.content);
    pattern.elements = parse_and_extract(PETTERN_ELEMENTS_TREE, context, token);
    context.unwrap();
    pattern.range = token.range;
    pattern.loc = token.loc;
    return pattern;
}
function parseObjectPattern(context: Context, token: Token): Node {
    let pattern = new NODES.ObjectPattern();
    context.wrap(CONTEXT.bindingElement, token.content);
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
                    _Or("Identifier").watch(
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
        precedence: 0,
        collector: {
            success: _Or(_NonCollecting(MATCH_MARKS.BOUNDARY), "Success"),
            content: "Property",
        }

    },
    Property: [
        {
            handler(context: Context) {
                let [collected, parser] = context;
                let { key, value } = collected;
                if (key.type === "Punctuator") {
                    collected.key = parser.parseExpression(context, key);//SequenceExpression
                }
                if (!value) {
                    collected.value = key;
                    validateBinding(context, key);
                } else {
                    let init: Node;
                    if (collected.shorthand) {
                        init = value;
                        value = key;
                        validateBinding(context, value);
                    } else {
                        if (value instanceof Array) {
                            init = value[1];
                            value = value[0];
                        }
                        if (value.type === "Identifier") {
                            validateBinding(context, value);
                        } else {
                            value = (
                                value.value === "[]"
                                    ? parseArrayPattern
                                    : parseObjectPattern
                            )(context, value);
                        }
                    }
                    collected.value = init ? {
                        type: "AssignmentPattern",
                        left: value,
                        right: init
                    } : value;
                }
                return collected;
            },
            collector: [
                {
                    _prev: _NonCapturing(MATCH_MARKS.BOUNDARY, "Property"),
                    key: "Punctuator []",
                    value: _Series(
                        _NonCollecting("Punctuator :"),
                        _Or("Identifier", "Punctuator [] {}"),
                        _Option(_Series(_NonCollecting("Punctuator ="), "[Expression]"))
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
                        _Or("Identifier").watch(
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
                    ["value", _Option(_Series(_NonCollecting("Punctuator ="), "[Expression]"))],
                    ["shorthand", _Mark(true)]
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
                    _Or(MATCH_MARKS.BOUNDARY, "Property"),
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
