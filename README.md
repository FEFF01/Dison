# Dison
 A new parsers frame in JavaScript

> * 目标是能灵活简单任意扩展的做任何自定义语法分析
> * 测试例子基本实现了 `ES6` 的语法分析， 基本解析结果和`Esprima`没啥区别（`SourceLocation`有点不一样）

> * 由于使用的 `hash` 查找匹配，当前效率只有 `Esprima` 的 `1/3` 左右，到时候会将`hash`大头映射为数组下标查找，应该性能可以高一截，不过还有其他问题要处理，现在主要用于测试，这个改了不利于调试延后在做
> * (已完成)由于`Dison`现在词法解析和语法解析基本是分离的两个东西，非严格模式js的部分词法解析需要结合当前语境（主要是正则的分词），如下 `Keyword` 作为 `Identifier` 的情况接着的 `/` 解析可能会出问题（到时候需要将词法解析和语法解析整合，让语法和词法描述符风格一致和处理这些情况）：
```javascript
    yield
    /a/i    //这里是 yield 除 a 除 i
    function *f(){
        yield
        /a/i    //这里的 /a/i 为regexp
    }
```


> * Examples:
```javascript
{
    "BinaryExpression": {
        //匹配 collector 描述的结果最终被收集到 handler 中处理或直接作为语法树的一部分
        handler(context: Context) {
            let [collected] = context;
            collected.operator = collected.operator.value;
            return collected;
        },

        //可在结果被收集前进行最后的验证或者从这里返回结果
        validator(context: Context) {
            return context[CONTEXT.right] - context[CONTEXT.left] >= 2
        },

        /*
        两个相同优先级遵循先后顺序的左结合
        需要右结合 `Right-associative` 的两个同级匹配可用 `new Number(precedence)` 
        依据：
        extreme[MATCHED_RECORDS.precedence] > longest[MATCHED_RECORDS.precedence]
        || extreme[MATCHED_RECORDS.precedence] === Number(longest[MATCHED_RECORDS.precedence])
        */
        precedence: [16, 15, 14, 13, 12, 11, 10, 9, 8, 7],

        //收集器
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
    ]
}

```

```javascript
//用于多个地方的通用 pattern 可以在外部定义

const THROW_STRICT_RESERVED_WORDS_PATTERN = _Or(
    "Identifier implements interface package private protected public static yield let"
).watch(
    function (context: Context, token: Token) {
        if (context[CONTEXT.strict]) {
            context[CONTEXT.parser].err(token);
        }
    }
);

const IDENTIFIER_OR_THROW_STRICT_RESERVED_WORDS_PATTERN = _Or(
    "Identifier", THROW_STRICT_RESERVED_WORDS_PATTERN
);
const EXPRESSION_OR_THROW_STRICT_RESERVED_WORDS_PATTERN = _Or(
    "[Expression]", THROW_STRICT_RESERVED_WORDS_PATTERN
);
const IDENTIFIER_OR_VALIDATE_STRICT_RESERVED_WORDS_PATTERN = _Or("Identifier").watch(validateIdentifier);

```