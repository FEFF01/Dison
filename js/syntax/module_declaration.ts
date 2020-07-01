import {
    Context, CONTEXT, Token, Node
} from '../interfaces';
import {
    _Option, _Or, _Series, _NonCollecting, _Mark, TYPE_ALIAS, MATCH_MARKS,
    validateLineTerminator, NODES, _NonCapturing, join_content, createMatchTree
} from './head'
import { parse_and_extract } from './index';
let Grouping = NODES.Grouping;

const STRING_LITERAL_PATTERN = _Or("Literal").watch(
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
                _Or("Punctuator ,", MATCH_MARKS.BOUNDARY).watch(
                    function (context: Context) {
                        let [collected] = context;
                        collected.local = collected.imported;
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
                _Or("Punctuator ,", MATCH_MARKS.BOUNDARY).watch(
                    function (context: Context) {
                        let [collected] = context;
                        collected.exported = collected.local;
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
                    _Or("Punctuator {}").watch(
                        function (context: Context, token: Token) {
                            let [collected] = context;
                            collected.specifiers = parse_and_extract(IMPORT_SPECIFIERS_TREE, context, token);
                        }
                    ),
                    _Or("Identifier").watch(
                        function (context: Context, Identifier: Token) {
                            context[CONTEXT.collected].specifiers = [
                                {
                                    type: "ImportDefaultSpecifier",
                                    local: Identifier
                                }
                            ]
                        }
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
            if (collected.check_line_terminator) {
                delete collected.check_line_terminator;
                validateLineTerminator(context);
            }
            if (!context[CONTEXT.isModule]) {
                parser.err(collected);
            }
            return collected;
        },
        collector: {
            _: _NonCollecting(_Series("Keyword export", "Punctuator *", "Identifier from")),
            source: STRING_LITERAL_PATTERN,
            _next: _Option("Punctuator ;"),
            check_line_terminator: _Mark(true)
        },
    },
    "ExportNamedDeclaration": {
        handler: "ExportAllDeclaration",
        collector: [
            {
                _: _NonCollecting("Keyword export"),
                declaration: "VariableDeclaration",
                specifiers: _Mark(Array),
                source: _Mark(null)
            },
            {
                _: _NonCollecting("Keyword export"),
                declaration: _Mark(null),
                specifiers: _Or("Punctuator {}").watch(
                    function (context: Context, token: Token) {
                        let [collected] = context;
                        collected.specifiers = parse_and_extract(EXPORT_SPECIFIERS_TREE, context, token);
                    }
                ),
                source: _Mark(null),
                _next: _Option("Punctuator ;"),
                check_line_terminator: _Mark(true)
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