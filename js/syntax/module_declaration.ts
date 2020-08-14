import {
    Context, CONTEXT, Token, Node
} from '../interfaces';
import {
    _Punctuator,
    _Keyword,
    _Identifier,
    _Pattern,
    _Option, _Or, _Series, _NonCollecting, _Mark, TYPE_ALIAS, MATCH_MARKS,
    validateLineTerminator, NODES, _NonCapturing, join_content, createMatchTree
} from './head'
import { parse_and_extract, parse_next_statement } from './index';
let Grouping = NODES.Grouping;

const STRING_LITERAL_PATTERN = _Or("Literal").pipe(
    function (context: Context, token: Token) {
        if (token instanceof Grouping || typeof token.value !== "string") {
            context[CONTEXT.parser].err(token);
        }
    }
)

let ImportSpecifiers = {
    "Success": {
        handler: join_content,
        precedence: 0,
        collector: [
            {
                success: _Or(MATCH_MARKS.BOUNDARY, "Success"),
                content: "ImportSpecifier",
            }
        ]
    },
    ImportSpecifier: {
        collector: {
            _prev: _NonCapturing("Success", MATCH_MARKS.BOUNDARY),
            imported: "Identifier",
            local: _Or(
                _Series(
                    _NonCollecting("Identifier as"),
                    "Identifier",
                    _NonCollecting("Punctuator ,", MATCH_MARKS.BOUNDARY)
                ),
                _Or("Punctuator ,", MATCH_MARKS.BOUNDARY).pipe(
                    function (context: Context) {
                        let [collected] = context;
                        return collected.imported;
                    }
                )
            )
        }

    }
}

const IMPORT_SPECIFIERS_TREE = createMatchTree(ImportSpecifiers);
const EXPORT_SPECIFIERS_TREE = createMatchTree({
    "Success": {
        handler: join_content,
        precedence: 0,
        collector: [
            {
                success: _Or(MATCH_MARKS.BOUNDARY, "Success"),
                content: "ExportSpecifier",
            }
        ]
    },
    ExportSpecifier: {
        collector: {
            _prev: _NonCapturing("Success", MATCH_MARKS.BOUNDARY),
            local: "Identifier",
            exported: _Or(
                _Series(
                    _NonCollecting("Identifier as"),
                    "Identifier",
                    _NonCollecting("Punctuator ,", MATCH_MARKS.BOUNDARY)
                ),
                _Or("Punctuator ,", MATCH_MARKS.BOUNDARY).pipe(
                    function (context: Context) {
                        let [collected] = context;
                        return collected.local;
                    }
                )
            )
        }
    }
});

const ModuleDeclarations: Record<string, any> = {
    "ImportDeclaration": {
        handler(context: Context) {
            let [collected, parser] = context;
            validateLineTerminator(context);
            if (!context[CONTEXT.isModule]) {
                parser.err(collected);
            }
            return collected;
        },
        collector: [
            {
                token: _NonCollecting("Keyword import"),
                specifiers: _Or(
                    _Punctuator("{}").pipe(
                        function (context: Context, token: Token) {
                            return parse_and_extract(IMPORT_SPECIFIERS_TREE, context, token);
                        }
                    ),
                    _Series(
                        _NonCollecting("Punctuator *"),
                        _NonCollecting("Identifier as"),
                        _Identifier().pipe(
                            function (context: Context, token: Token) {
                                return [
                                    {
                                        type: "ImportNamespaceSpecifier",
                                        local: token
                                    }
                                ]
                            }
                        )
                    ),
                    _Series(
                        _Identifier().pipe(
                            function (context: Context, Identifier: Token) {
                                return {
                                    type: "ImportDefaultSpecifier",
                                    local: Identifier
                                }
                            }
                        ),
                        _Option(
                            _Series(
                                _NonCollecting("Punctuator ,"),
                                _Or(
                                    _Series(
                                        _Punctuator("{}").pipe(
                                            function (context: Context, token: Token) {
                                                return parse_and_extract(IMPORT_SPECIFIERS_TREE, context, token);
                                            }
                                        ),
                                        _Mark(
                                            function (context: Context) {
                                                let [collected] = context;
                                                let specifiers = collected.specifiers;
                                                specifiers.splice(1, 1, ...specifiers[1]);
                                            }
                                        )
                                    ),
                                    _Series(
                                        _NonCollecting("Punctuator *"),
                                        _NonCollecting("Identifier as"),
                                        _Identifier().pipe(
                                            function (context: Context, token: Token) {
                                                return {
                                                    type: "ImportNamespaceSpecifier",
                                                    local: token
                                                }
                                            }
                                        )
                                    )
                                )
                            )
                        ),
                        _Mark(function () { })//使结果收集为数组
                    )
                ),
                _: _NonCollecting("Identifier from"),
                source: STRING_LITERAL_PATTERN,
                _next: _Option("Punctuator ;")
            }
        ]
    },
    "ExportAllDeclaration": {
        handler(context: Context) {
            let [collected, parser] = context;
            validateLineTerminator(context);
            if (!context[CONTEXT.isModule]) {
                parser.err(collected);
            }
            return collected;
        },
        collector: {
            _: _NonCollecting(_Series("Keyword export", "Punctuator *", "Identifier from")),
            source: STRING_LITERAL_PATTERN,
            _next: _Option("Punctuator ;"),
        },
    },
    "ExportNamedDeclaration": {
        handler(context: Context) {
            let [collected, parser] = context;
            collected.declaration || validateLineTerminator(context);
            if (!context[CONTEXT.isModule]) {
                parser.err(collected);
            }
            return collected;
        },
        collector: [
            {
                _: _NonCollecting("Keyword export"),
                declaration: "VariableDeclaration",
                specifiers: _Mark(() => []),
                source: _Mark(null)
            },
            {
                _: _NonCollecting("Keyword export"),
                declaration: _Mark(null),
                specifiers: _Punctuator("{}").pipe(
                    function (context: Context, token: Token) {
                        return parse_and_extract(EXPORT_SPECIFIERS_TREE, context, token);
                    }
                ),
                source: _Mark(null),
                _next: _Option("Punctuator ;")
            }
        ]
    },
    "ExportDefaultDeclaration": {
        handler(context: Context) {
            let [collected] = context;
            validateLineTerminator(context);
            if (!context[CONTEXT.isModule]) {
                context[CONTEXT.parser].err(collected);
            }
            return collected;
        },
        precedence: 1.5,
        collector: [
            {
                type: _Mark("ExportDefaultDeclaration"),
                _: _NonCollecting("Keyword export"),
                __: _NonCollecting("Keyword default"),
                declaration: "[Expression]",
                _next: _Option("Punctuator ;")
            }
        ]
    }
}
export default ModuleDeclarations;