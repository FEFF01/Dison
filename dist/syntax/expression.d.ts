import { Node, Token, Context } from '../interfaces';
import { parseArrayPattern, parseObjectPattern } from './pattern';
declare const Expressions: Record<string, any>;
declare let PRIMARY_EXPRESSION_TREE: Record<string, any>;
declare let EXPRESSION_TREE: Record<string, any>;
export { Expressions, EXPRESSION_TREE, PRIMARY_EXPRESSION_TREE, parseArrayPattern, parseObjectPattern, parse_params, parse_arguments, };
declare function parse_arguments(context: Context, tokens: Array<Token>): Node[];
declare function parse_params(context: Context, tokens: Array<Token>): Node[];
