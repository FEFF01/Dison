import { Token, SearchTree } from '../interfaces';
import Tokenizer from '../tokenizer';
declare function createSearchTree(data: Array<string | string[] | Record<string, any>>, root?: Record<string, any>, block_list?: Array<string>): SearchTree;
declare function escape_scan(tokenizer: Tokenizer, scope?: Record<string, any>, start?: number): any;
declare function search_scan(tokenizer: Tokenizer): Token;
export { createSearchTree, escape_scan, search_scan };
