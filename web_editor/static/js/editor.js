/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Django Web IDE — Main JavaScript
 * 
 * Initializes:
 *   1. Monaco Editor (VS Code's editor engine) with Python/Django highlighting
 *   2. xterm.js terminal connected to real shell via WebSocket (Django Channels)
 *   3. File tree browser with CRUD operations
 *   4. Tab system with save/load
 *   5. Search across project files
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────

    let editor = null;           // Monaco editor instance
    let term = null;             // xterm.js terminal instance
    let fitAddon = null;         // xterm fit addon
    let ws = null;               // WebSocket connection to terminal
    let workspacePath = '';      // Current workspace root
    let openTabs = [];           // [{id, path, name, modified}]
    let activeTabId = null;
    let allFiles = [];           // All known files for quick-open

    // ── DOM shortcuts ─────────────────────────────────────────────────────

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ── Helpers ───────────────────────────────────────────────────────────

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function apiCall(endpoint, data) {
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return resp.json();
    }

    function getTimestamp() {
        return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  1. MONACO EDITOR — Initialization with Python/Django highlighting
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Monaco theme definitions with token rules for:
     *   - Functions (yellow/gold)
     *   - Classes (teal/green)
     *   - Keywords (blue/purple)
     *   - Strings (orange)
     *   - Comments (green, italic)
     *   - Decorators (purple)
     *   - Built-in functions (light blue)
     *   - Numbers (green)
     *   - Operators, delimiters, etc.
     */
    const THEMES = {
        'vs-dark': {
            label: 'Dark+',
            base: 'vs-dark',
            rules: [
                { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
                { token: 'comment.type', foreground: '6A9955', fontStyle: 'italic' },
                { token: 'keyword', foreground: '569CD6' },
                { token: 'keyword.control', foreground: 'C586C0' },
                { token: 'string', foreground: 'CE9178' },
                { token: 'string.escape', foreground: 'D7BA7D' },
                { token: 'number', foreground: 'B5CEA8' },
                { token: 'number.hex', foreground: 'B5CEA8' },
                { token: 'number.octal', foreground: 'B5CEA8' },
                { token: 'number.binary', foreground: 'B5CEA8' },
                { token: 'type', foreground: '4EC9B0' },
                { token: 'class', foreground: '4EC9B0' },
                { token: 'class.declaration', foreground: '4EC9B0', fontStyle: 'bold' },
                { token: 'function', foreground: 'DCDCAA' },
                { token: 'function.declaration', foreground: 'DCDCAA', fontStyle: 'bold' },
                { token: 'variable', foreground: '9CDCFE' },
                { token: 'variable.predefined', foreground: '4FC1FF' },
                { token: 'parameter', foreground: '9CDCFE' },
                { token: 'operator', foreground: 'D4D4D4' },
                { token: 'decorator', foreground: 'C586C0' },
                { token: 'tag', foreground: '569CD6' },
                { token: 'attribute.name', foreground: '9CDCFE' },
                { token: 'attribute.value', foreground: 'CE9178' },
                { token: 'delimiter', foreground: '808080' },
                { token: 'constant', foreground: '569CD6' },
                { token: 'magic', foreground: 'DCDCAA', fontStyle: 'italic' },
                { token: 'namespace', foreground: '4EC9B0' },
                { token: 'django.field', foreground: '4EC9B0' },
                { token: 'django.class', foreground: '4EC9B0' },
                { token: 'django.shortcut', foreground: 'DCDCAA' },
                { token: 'builtin', foreground: '4FC1FF' },
                { token: 'identifier', foreground: '9CDCFE' },
                { token: 'white', foreground: 'D4D4D4' },
            ],
            colors: {
                'editor.background': '#1E1E1E',
                'editor.foreground': '#D4D4D4',
                'editorCursor.foreground': '#AEAFAD',
                'editor.lineHighlightBackground': '#2A2D2E',
                'editor.selectionBackground': '#264F78',
                'editorLineNumber.foreground': '#858585',
                'editorLineNumber.activeForeground': '#C6C6C6',
            },
        },
        'monokai': {
            label: 'Monokai',
            base: 'vs-dark',
            rules: [
                { token: 'comment', foreground: '75715E', fontStyle: 'italic' },
                { token: 'comment.type', foreground: '75715E', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'F92672' },
                { token: 'keyword.control', foreground: 'F92672' },
                { token: 'string', foreground: 'E6DB74' },
                { token: 'string.escape', foreground: 'AE81FF' },
                { token: 'number', foreground: 'AE81FF' },
                { token: 'number.hex', foreground: 'AE81FF' },
                { token: 'number.octal', foreground: 'AE81FF' },
                { token: 'number.binary', foreground: 'AE81FF' },
                { token: 'type', foreground: 'A6E22E' },
                { token: 'class', foreground: 'A6E22E' },
                { token: 'class.declaration', foreground: 'A6E22E', fontStyle: 'bold' },
                { token: 'function', foreground: 'A6E22E' },
                { token: 'function.declaration', foreground: 'A6E22E', fontStyle: 'bold' },
                { token: 'variable', foreground: 'F8F8F2' },
                { token: 'variable.predefined', foreground: 'A6E22E' },
                { token: 'parameter', foreground: 'FD971F' },
                { token: 'operator', foreground: 'F92672' },
                { token: 'decorator', foreground: 'A6E22E' },
                { token: 'tag', foreground: 'F92672' },
                { token: 'attribute.name', foreground: 'A6E22E' },
                { token: 'attribute.value', foreground: 'E6DB74' },
                { token: 'delimiter', foreground: 'F8F8F2' },
                { token: 'constant', foreground: 'F92672' },
                { token: 'magic', foreground: 'A6E22E', fontStyle: 'italic' },
                { token: 'namespace', foreground: 'A6E22E' },
                { token: 'django.field', foreground: 'A6E22E' },
                { token: 'django.class', foreground: 'A6E22E' },
                { token: 'django.shortcut', foreground: 'A6E22E' },
                { token: 'builtin', foreground: 'A6E22E' },
                { token: 'identifier', foreground: 'F8F8F2' },
                { token: 'white', foreground: 'F8F8F2' },
            ],
            colors: { 'editor.background': '#272822', 'editor.foreground': '#F8F8F2' },
        },
        'dracula': {
            label: 'Dracula',
            base: 'vs-dark',
            rules: [
                { token: 'comment', foreground: '6272A4', fontStyle: 'italic' },
                { token: 'comment.type', foreground: '6272A4', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'FF79C6' },
                { token: 'keyword.control', foreground: 'FF79C6' },
                { token: 'string', foreground: 'F1FA8C' },
                { token: 'string.escape', foreground: 'BD93F9' },
                { token: 'number', foreground: 'BD93F9' },
                { token: 'number.hex', foreground: 'BD93F9' },
                { token: 'number.octal', foreground: 'BD93F9' },
                { token: 'number.binary', foreground: 'BD93F9' },
                { token: 'type', foreground: '8BE9FD' },
                { token: 'class', foreground: '8BE9FD', fontStyle: 'bold' },
                { token: 'class.declaration', foreground: '8BE9FD', fontStyle: 'bold' },
                { token: 'function', foreground: '50FA7B' },
                { token: 'function.declaration', foreground: '50FA7B', fontStyle: 'bold' },
                { token: 'variable', foreground: 'F8F8F2' },
                { token: 'variable.predefined', foreground: '50FA7B' },
                { token: 'parameter', foreground: 'FFB86C' },
                { token: 'operator', foreground: 'FF79C6' },
                { token: 'decorator', foreground: '50FA7B' },
                { token: 'tag', foreground: 'FF79C6' },
                { token: 'attribute.name', foreground: '50FA7B' },
                { token: 'attribute.value', foreground: 'F1FA8C' },
                { token: 'delimiter', foreground: 'F8F8F2' },
                { token: 'constant', foreground: 'FF79C6' },
                { token: 'magic', foreground: '50FA7B', fontStyle: 'italic' },
                { token: 'namespace', foreground: '8BE9FD' },
                { token: 'django.field', foreground: '8BE9FD' },
                { token: 'django.class', foreground: '8BE9FD' },
                { token: 'django.shortcut', foreground: '50FA7B' },
                { token: 'builtin', foreground: '50FA7B' },
                { token: 'identifier', foreground: 'F8F8F2' },
                { token: 'white', foreground: 'F8F8F2' },
            ],
            colors: { 'editor.background': '#282A36', 'editor.foreground': '#F8F8F2' },
        },
        'one-dark': {
            label: 'One Dark',
            base: 'vs-dark',
            rules: [
                { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
                { token: 'comment.type', foreground: '5C6370', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'C678DD' },
                { token: 'keyword.control', foreground: 'C678DD' },
                { token: 'string', foreground: '98C379' },
                { token: 'string.escape', foreground: '56B6C2' },
                { token: 'number', foreground: 'D19A66' },
                { token: 'number.hex', foreground: 'D19A66' },
                { token: 'number.octal', foreground: 'D19A66' },
                { token: 'number.binary', foreground: 'D19A66' },
                { token: 'type', foreground: 'E5C07B' },
                { token: 'class', foreground: 'E5C07B' },
                { token: 'class.declaration', foreground: 'E5C07B', fontStyle: 'bold' },
                { token: 'function', foreground: '61AFEF' },
                { token: 'function.declaration', foreground: '61AFEF', fontStyle: 'bold' },
                { token: 'variable', foreground: 'E06C75' },
                { token: 'variable.predefined', foreground: '61AFEF' },
                { token: 'parameter', foreground: 'E06C75' },
                { token: 'operator', foreground: 'ABB2BF' },
                { token: 'decorator', foreground: 'C678DD' },
                { token: 'tag', foreground: 'E06C75' },
                { token: 'attribute.name', foreground: 'D19A66' },
                { token: 'attribute.value', foreground: '98C379' },
                { token: 'delimiter', foreground: 'ABB2BF' },
                { token: 'constant', foreground: 'C678DD' },
                { token: 'magic', foreground: '61AFEF', fontStyle: 'italic' },
                { token: 'namespace', foreground: 'E5C07B' },
                { token: 'django.field', foreground: 'E5C07B' },
                { token: 'django.class', foreground: 'E5C07B' },
                { token: 'django.shortcut', foreground: '61AFEF' },
                { token: 'builtin', foreground: '61AFEF' },
                { token: 'identifier', foreground: 'E06C75' },
                { token: 'white', foreground: 'E06C75' },
            ],
            colors: { 'editor.background': '#282C34', 'editor.foreground': '#ABB2BF' },
        },
        'github-dark': {
            label: 'GitHub Dark',
            base: 'vs-dark',
            rules: [
                { token: 'comment', foreground: '8B949E', fontStyle: 'italic' },
                { token: 'comment.type', foreground: '8B949E', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'FF7B72' },
                { token: 'keyword.control', foreground: 'FF7B72' },
                { token: 'string', foreground: 'A5D6FF' },
                { token: 'string.escape', foreground: '79C0FF' },
                { token: 'number', foreground: '79C0FF' },
                { token: 'number.hex', foreground: '79C0FF' },
                { token: 'number.octal', foreground: '79C0FF' },
                { token: 'number.binary', foreground: '79C0FF' },
                { token: 'type', foreground: 'FFA657' },
                { token: 'class', foreground: 'FFA657' },
                { token: 'class.declaration', foreground: 'FFA657', fontStyle: 'bold' },
                { token: 'function', foreground: 'D2A8FF' },
                { token: 'function.declaration', foreground: 'D2A8FF', fontStyle: 'bold' },
                { token: 'variable', foreground: 'FFA657' },
                { token: 'variable.predefined', foreground: '79C0FF' },
                { token: 'parameter', foreground: 'C9D1D9' },
                { token: 'operator', foreground: 'FF7B72' },
                { token: 'decorator', foreground: 'D2A8FF' },
                { token: 'tag', foreground: '7EE787' },
                { token: 'attribute.name', foreground: '79C0FF' },
                { token: 'attribute.value', foreground: 'A5D6FF' },
                { token: 'delimiter', foreground: 'C9D1D9' },
                { token: 'constant', foreground: 'FF7B72' },
                { token: 'magic', foreground: 'D2A8FF', fontStyle: 'italic' },
                { token: 'namespace', foreground: 'FFA657' },
                { token: 'django.field', foreground: 'FFA657' },
                { token: 'django.class', foreground: 'FFA657' },
                { token: 'django.shortcut', foreground: 'D2A8FF' },
                { token: 'builtin', foreground: '79C0FF' },
                { token: 'identifier', foreground: 'C9D1D9' },
                { token: 'white', foreground: 'FFA657' },
            ],
            colors: { 'editor.background': '#0D1117', 'editor.foreground': '#C9D1D9' },
        },
        'solarized-dark': {
            label: 'Solarized Dark',
            base: 'vs-dark',
            rules: [
                { token: 'comment', foreground: '586E75', fontStyle: 'italic' },
                { token: 'comment.type', foreground: '586E75', fontStyle: 'italic' },
                { token: 'keyword', foreground: '859900' },
                { token: 'keyword.control', foreground: '859900' },
                { token: 'string', foreground: '2AA198' },
                { token: 'string.escape', foreground: 'CB4B16' },
                { token: 'number', foreground: 'D33682' },
                { token: 'number.hex', foreground: 'D33682' },
                { token: 'number.octal', foreground: 'D33682' },
                { token: 'number.binary', foreground: 'D33682' },
                { token: 'type', foreground: 'B58900' },
                { token: 'class', foreground: 'B58900', fontStyle: 'bold' },
                { token: 'class.declaration', foreground: 'B58900', fontStyle: 'bold' },
                { token: 'function', foreground: '268BD2' },
                { token: 'function.declaration', foreground: '268BD2', fontStyle: 'bold' },
                { token: 'variable', foreground: '839496' },
                { token: 'variable.predefined', foreground: '268BD2' },
                { token: 'parameter', foreground: '93A1A1' },
                { token: 'operator', foreground: '859900' },
                { token: 'decorator', foreground: 'B58900' },
                { token: 'tag', foreground: '268BD2' },
                { token: 'attribute.name', foreground: '93A1A1' },
                { token: 'attribute.value', foreground: '2AA198' },
                { token: 'delimiter', foreground: '93A1A1' },
                { token: 'constant', foreground: '859900' },
                { token: 'magic', foreground: '268BD2', fontStyle: 'italic' },
                { token: 'namespace', foreground: 'B58900' },
                { token: 'django.field', foreground: 'B58900' },
                { token: 'django.class', foreground: 'B58900' },
                { token: 'django.shortcut', foreground: '268BD2' },
                { token: 'builtin', foreground: '268BD2' },
                { token: 'identifier', foreground: '839496' },
                { token: 'white', foreground: '839496' },
            ],
            colors: { 'editor.background': '#002B36', 'editor.foreground': '#839496' },
        },
        'vs': {
            label: 'Light+',
            base: 'vs',
            rules: [
                { token: 'comment', foreground: '008000', fontStyle: 'italic' },
                { token: 'comment.type', foreground: '008000', fontStyle: 'italic' },
                { token: 'keyword', foreground: '0000FF' },
                { token: 'keyword.control', foreground: 'AF00DB' },
                { token: 'string', foreground: 'A31515' },
                { token: 'string.escape', foreground: 'EE0000' },
                { token: 'number', foreground: '098658' },
                { token: 'number.hex', foreground: '098658' },
                { token: 'number.octal', foreground: '098658' },
                { token: 'number.binary', foreground: '098658' },
                { token: 'type', foreground: '267F99' },
                { token: 'class', foreground: '267F99', fontStyle: 'bold' },
                { token: 'class.declaration', foreground: '267F99', fontStyle: 'bold' },
                { token: 'function', foreground: '795E26' },
                { token: 'function.declaration', foreground: '795E26', fontStyle: 'bold' },
                { token: 'variable', foreground: '001080' },
                { token: 'variable.predefined', foreground: '795E26' },
                { token: 'parameter', foreground: '001080' },
                { token: 'operator', foreground: '000000' },
                { token: 'decorator', foreground: '795E26' },
                { token: 'tag', foreground: '800000' },
                { token: 'attribute.name', foreground: 'FF0000' },
                { token: 'attribute.value', foreground: '0000FF' },
                { token: 'delimiter', foreground: '000000' },
                { token: 'constant', foreground: '0000FF' },
                { token: 'magic', foreground: '795E26', fontStyle: 'italic' },
                { token: 'namespace', foreground: '267F99' },
                { token: 'django.field', foreground: '267F99' },
                { token: 'django.class', foreground: '267F99' },
                { token: 'django.shortcut', foreground: '795E26' },
                { token: 'builtin', foreground: '795E26' },
                { token: 'identifier', foreground: '001080' },
                { token: 'white', foreground: '001080' },
            ],
            colors: { 'editor.background': '#FFFFFF', 'editor.foreground': '#000000' },
        },
    };

    function getSavedTheme() {
        return localStorage.getItem('webide_theme') || 'vs-dark';
    }

    /**
     * Initialize Monaco Editor with:
     *   - Custom Python tokenizer (produces function/class/decorator tokens)
     *   - Python hover provider (Django-aware tooltips)
     *   - Python completion provider (snippets for models, views, etc.)
     */
    function initMonaco() {
        require.config({
            paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' },
        });

        require(['vs/editor/editor.main'], function () {

            // ── Register custom Python tokenizer ──────────────────────────
            // Monaco's default Python tokenizer doesn't distinguish function
            // names from identifiers. We define a Monarch tokenizer that
            // produces tokens our themes can color differently.

            monaco.languages.setMonarchTokensProvider('python', {
                keywords: [
                    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
                    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
                    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
                    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
                    'try', 'while', 'with', 'yield',
                ],
                controlKeywords: [
                    'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally',
                    'with', 'as', 'return', 'yield', 'raise', 'break', 'continue', 'pass',
                    'del', 'global', 'nonlocal', 'assert', 'lambda', 'in', 'is',
                    'and', 'or', 'not', 'from', 'import',
                ],
                builtins: [
                    'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict',
                    'set', 'tuple', 'type', 'isinstance', 'enumerate', 'zip', 'map',
                    'filter', 'sorted', 'super', 'property', 'staticmethod', 'classmethod',
                    'open', 'abs', 'all', 'any', 'bin', 'bool', 'bytearray', 'bytes',
                    'callable', 'chr', 'complex', 'divmod', 'eval', 'exec', 'format',
                    'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'hex', 'id',
                    'input', 'issubclass', 'iter', 'locals', 'max', 'min', 'next',
                    'object', 'oct', 'ord', 'pow', 'repr', 'reversed', 'round', 'setattr',
                    'slice', 'sum', 'vars', '__import__',
                ],
                djangoFields: [
                    'CharField', 'IntegerField', 'FloatField', 'DecimalField', 'BooleanField',
                    'DateField', 'DateTimeField', 'TimeField', 'EmailField', 'URLField',
                    'SlugField', 'FileField', 'ImageField', 'TextField', 'ForeignKey',
                    'ManyToManyField', 'OneToOneField', 'AutoField', 'BigAutoField',
                    'SmallAutoField', 'PositiveIntegerField', 'PositiveSmallIntegerField',
                    'PositiveBigIntegerField', 'BigIntegerField', 'SmallIntegerField',
                    'BinaryField', 'UUIDField', 'IPAddressField', 'GenericIPAddressField',
                    'NullBooleanField', 'JSONField', 'ArrayField', 'HStoreField',
                ],
                djangoClasses: [
                    'Model', 'QuerySet', 'Manager', 'BaseManager',
                    'Serializer', 'ModelSerializer', 'HyperlinkedModelSerializer',
                    'APIView', 'GenericAPIView', 'ListCreateAPIView', 'RetrieveUpdateDestroyAPIView',
                    'ViewSet', 'ModelViewSet', 'ReadOnlyModelViewSet',
                    'TestCase', 'TransactionTestCase', 'SimpleTestCase',
                    'Command', 'BaseCommand',
                    'User', 'Group', 'Permission',
                    'Request', 'Response',
                ],
                djangoShortcuts: [
                    'render', 'redirect', 'get_object_or_404', 'get_list_or_404',
                ],
                operators: [
                    '=', '>', '<', '!', '~', '?', ':',
                    '==', '<=', '>=', '<>', '!=', '<<', '>>',
                    '**', '//', '+=', '-=', '*=', '/=', '%=', '&=',
                    '|=', '^=', '->', ':=', '@',
                ],
                symbols: /[=><!~?:&|+\-*/^%]+/,
                digits: /\d+(_+\d+)*/,
                octaldigits: /[0-7]+(_+[0-7]+)*/,
                hexdigits: /[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,

                tokenizer: {
                    root: [
                        [/# type:\s*ignore/, 'comment.type'],
                        [/#.*$/, 'comment'],

                        [/(f|fr|rf|F|FR|RF)"/, 'string', '@fstringDouble'],
                        [/(f|fr|rf|F|FR|RF)'/, 'string', '@fstringSingle'],
                        [/(r|b|u|R|B|U)"""[^"]*"""/, 'string'],
                        [/(r|b|u|R|B|U)'''[^']*'''/, 'string'],
                        [/"""/, 'string', '@tripleDouble'],
                        [/'''/, 'string', '@tripleSingle'],
                        [/(r|b|u|R|B|U)"/, 'string', '@doubleString'],
                        [/(r|b|u|R|B|U)'/, 'string', '@singleString'],
                        [/"/, 'string', '@doubleString'],
                        [/'/, 'string', '@singleString'],

                        [/\d+(\.\d+)?([eE][+-]?\d+)?j?/, 'number'],
                        [/\b0[xX][\da-fA-F]+(_+[\da-fA-F]+)*\b/, 'number.hex'],
                        [/\b0[oO][0-7]+(_+[0-7]+)*\b/, 'number.octal'],
                        [/\b0[bB][01]+(_+[01]+)*\b/, 'number.binary'],

                        [/@\w+/, 'decorator'],

                        [/\b(def)\s+(\w+)/, {
                            cases: {
                                '$2': ['keyword', 'function.declaration'],
                                '@default': ['keyword', 'identifier'],
                            },
                        }],
                        [/\b(class)\s+(\w+)/, {
                            cases: {
                                '$2': ['keyword', 'class.declaration'],
                                '@default': ['keyword', 'identifier'],
                            },
                        }],
                        [/\b(async\s+def)\s+(\w+)/, ['keyword', 'function.declaration']],
                        [/\b(async\s+for)\b/, 'keyword'],
                        [/\b(async\s+with)\b/, 'keyword'],

                        [/\b(True|False|None)\b/, 'constant'],
                        [/\b(self|cls)\b/, 'variable.predefined'],

                        [/\b(?:__\w+__)\b/, 'magic'],

                        [/\b(?:CharField|IntegerField|FloatField|DecimalField|BooleanField|DateField|DateTimeField|TimeField|EmailField|URLField|SlugField|FileField|ImageField|TextField|ForeignKey|ManyToManyField|OneToOneField|AutoField|BigAutoField|SmallAutoField|PositiveIntegerField|PositiveSmallIntegerField|PositiveBigIntegerField|BigIntegerField|SmallIntegerField|BinaryField|UUIDField|IPAddressField|GenericIPAddressField|NullBooleanField|JSONField|ArrayField|HStoreField)\b/, 'django.field'],

                        [/\b(?:Model|QuerySet|Manager|BaseManager|Serializer|ModelSerializer|HyperlinkedModelSerializer|APIView|GenericAPIView|ListCreateAPIView|RetrieveUpdateDestroyAPIView|ViewSet|ModelViewSet|ReadOnlyModelViewSet|TestCase|TransactionTestCase|SimpleTestCase|BaseCommand|User|Group|Permission|Request|Response)\b/, 'django.class'],

                        [/\b(?:render|redirect|get_object_or_404|get_list_or_404)\b/, 'django.shortcut'],

                        [/\b(?:models|views|admin|forms|serializers|urls|settings|exceptions|middleware|signals|utils|test|decorators|shortcuts|http|template|db|conf|contrib|dispatch|core|rest_framework)\b/, 'namespace'],

                        [/\b(Optional|Union|List|Dict|Tuple|Set|Any|Callable|Type|ClassVar|Final|Literal)\b/, 'type'],

                        [/\b[A-Z]\w*/, 'type'],

                        [/\b(?:print|len|range|str|int|float|list|dict|set|tuple|type|isinstance|enumerate|zip|map|filter|sorted|super|property|staticmethod|classmethod|open|abs|all|any|bin|bool|callable|chr|divmod|eval|exec|format|getattr|globals|hasattr|hash|hex|id|input|iter|locals|max|min|next|object|oct|ord|pow|repr|reversed|round|setattr|sum|vars)\b/, 'builtin'],

                        [/\b(?:if|elif|else|for|while|try|except|finally|with|as|return|yield|raise|break|continue|pass|del|global|nonlocal|assert|lambda)\b/, 'keyword.control'],

                        [/\b(?:and|or|not|in|is|from|import|class|def|async|await)\b/, 'keyword'],

                        [/[a-zA-Z_]\w*/, 'identifier'],

                        [/[()[\]{},;:@]/, 'delimiter'],
                        [/\.\.\./, 'delimiter'],
                        [/\./, 'delimiter'],

                        [/[=!<>]=?/, 'operator'],
                        [/\*\*|\/\/|[+\-*/%&|^~<>]/, 'operator'],

                        [/\s+/, 'white'],
                    ],

                    fstringDouble: [
                        [/[^\\"]+/, 'string'],
                        [/\\./, 'string.escape'],
                        [/"/, 'string', '@pop'],
                    ],
                    fstringSingle: [
                        [/[^\\']+/, 'string'],
                        [/\\./, 'string.escape'],
                        [/'/, 'string', '@pop'],
                    ],

                    tripleDouble: [
                        [/[^\\"]+/, 'string'],
                        [/\\./, 'string.escape'],
                        [/"""/, 'string', '@pop'],
                        [/"/, 'string'],
                    ],
                    tripleSingle: [
                        [/[^\\']+/, 'string'],
                        [/\\./, 'string.escape'],
                        [/'''/, 'string', '@pop'],
                        [/'/, 'string'],
                    ],

                    doubleString: [
                        [/[^\\"]+/, 'string'],
                        [/\\./, 'string.escape'],
                        [/"/, 'string', '@pop'],
                    ],
                    singleString: [
                        [/[^\\']+/, 'string'],
                        [/\\./, 'string.escape'],
                        [/'/, 'string', '@pop'],
                    ],
                },
            });

            // ── Define all themes ─────────────────────────────────────────

            for (const [id, def] of Object.entries(THEMES)) {
                monaco.editor.defineTheme(id, {
                    base: def.base,
                    inherit: false,
                    rules: def.rules,
                    colors: def.colors || {},
                });
            }

            // ── Create editor instance ────────────────────────────────────

            const savedTheme = getSavedTheme();
            const fontSize = parseInt(localStorage.getItem('webide_fontsize') || '14');
            const tabSize = parseInt(localStorage.getItem('webide_tabsize') || '4');
            const wordWrap = localStorage.getItem('webide_wordwrap') !== 'false';
            const minimap = localStorage.getItem('webide_minimap') !== 'false';

            editor = monaco.editor.create($('#editor-area'), {
                value: '',
                language: 'python',
                theme: savedTheme,
                automaticLayout: true,
                fontSize: fontSize,
                tabSize: tabSize,
                wordWrap: wordWrap ? 'on' : 'off',
                minimap: { enabled: minimap },
                scrollBeyondLastLine: false,
                padding: { top: 8 },
                glyphMargin: true,
                folding: true,
                bracketPairColorization: { enabled: true },
                suggest: {
                    showKeywords: true,
                    showSnippets: true,
                    showFunctions: true,
                    showVariables: true,
                },
            });

            // ── Keyboard shortcuts ────────────────────────────────────────

            // Ctrl+S — save file
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveCurrentFile());

            // Track cursor position
            editor.onDidChangeCursorPosition((e) => {
                $('#status-cursor').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
            });

            // Track modifications
            editor.onDidChangeModelContent(() => {
                const tab = openTabs.find(t => t.id === activeTabId);
                if (tab && !tab.modified) {
                    tab.modified = true;
                    renderTabs();
                }
            });

            // ── Python hover provider (Django-aware) ──────────────────────

            monaco.languages.registerHoverProvider('python', {
                provideHover(model, position) {
                    const word = model.getWordAtPosition(position);
                    if (!word) return null;

                    const HOVER_DB = {
                        // Python keywords
                        'def':       { label: 'keyword: def',      desc: 'Define a function' },
                        'class':     { label: 'keyword: class',    desc: 'Define a class' },
                        'import':    { label: 'keyword: import',   desc: 'Import a module' },
                        'from':      { label: 'keyword: from',     desc: 'Import from a module' },
                        'return':    { label: 'keyword: return',   desc: 'Return a value from a function' },
                        'if':        { label: 'keyword: if',       desc: 'Conditional execution' },
                        'else':      { label: 'keyword: else',     desc: 'Alternative branch' },
                        'elif':      { label: 'keyword: elif',     desc: 'Else if condition' },
                        'for':       { label: 'keyword: for',      desc: 'Iterate over a sequence' },
                        'while':     { label: 'keyword: while',    desc: 'Loop while condition is true' },
                        'try':       { label: 'keyword: try',      desc: 'Try block for exception handling' },
                        'except':    { label: 'keyword: except',   desc: 'Handle an exception' },
                        'with':      { label: 'keyword: with',     desc: 'Context manager' },
                        'lambda':    { label: 'keyword: lambda',   desc: 'Create an anonymous function' },
                        'yield':     { label: 'keyword: yield',    desc: 'Yield value in a generator' },
                        'pass':      { label: 'keyword: pass',     desc: 'Null operation (no action)' },
                        'break':     { label: 'keyword: break',    desc: 'Exit the nearest enclosing loop' },
                        'continue':  { label: 'keyword: continue', desc: 'Skip to next loop iteration' },
                        'None':      { label: 'NoneType',          desc: 'The absence of a value' },
                        'True':      { label: 'bool',              desc: 'Boolean True' },
                        'False':     { label: 'bool',              desc: 'Boolean False' },
                        'self':      { label: 'parameter: self',   desc: 'Reference to the current instance' },

                        // Built-in functions
                        'print':     { label: 'print(*objects, sep=" ", end="\\n")', desc: 'Print objects to stdout' },
                        'len':       { label: 'len(s)',             desc: 'Return the length of an object' },
                        'range':     { label: 'range(stop)',        desc: 'Create a sequence of numbers' },
                        'str':       { label: 'class str',         desc: 'Create a string object' },
                        'int':       { label: 'class int',         desc: 'Create an integer object' },
                        'list':      { label: 'class list',        desc: 'Create a mutable sequence' },
                        'dict':      { label: 'class dict',        desc: 'Create a mapping object' },
                        'super':     { label: 'super()',           desc: 'Return a proxy for the parent class' },

                        // Django-specific
                        'request':             { label: 'django.http.HttpRequest',            desc: 'The request object passed to Django views' },
                        'HttpResponse':        { label: 'django.http.HttpResponse',           desc: 'An HTTP response class' },
                        'JsonResponse':        { label: 'django.http.JsonResponse',           desc: 'An HTTP response class for JSON data' },
                        'redirect':            { label: 'redirect(to, *args, **kwargs)',      desc: 'Return an HttpResponseRedirect' },
                        'render':              { label: 'render(request, template, context)',  desc: 'Combine a template with context and return HttpResponse' },
                        'get_object_or_404':   { label: 'get_object_or_404(klass, *args)',    desc: 'Fetch an object or raise 404' },
                        'models':              { label: 'django.db.models',                    desc: 'Django ORM models module' },
                        'Model':               { label: 'class django.db.models.Model',       desc: 'Base class for all Django models' },
                        'CharField':           { label: 'CharField(max_length)',              desc: 'A string field with max length' },
                        'IntegerField':        { label: 'IntegerField',                       desc: 'An integer field' },
                        'ForeignKey':          { label: 'ForeignKey(to, on_delete)',           desc: 'A many-to-one relationship' },
                        'ManyToManyField':     { label: 'ManyToManyField(to)',                 desc: 'A many-to-many relationship' },
                        'TextField':           { label: 'TextField',                          desc: 'A large text field' },
                        'BooleanField':        { label: 'BooleanField',                       desc: 'A true/false field' },
                        'DateField':           { label: 'DateField',                          desc: 'A date field' },
                        'DateTimeField':       { label: 'DateTimeField',                      desc: 'A date and time field' },
                        'Serializer':          { label: 'rest_framework.Serializer',          desc: 'DRF base serializer class' },
                        'ModelSerializer':     { label: 'rest_framework.ModelSerializer',    desc: 'DRF model serializer' },
                        'APIView':             { label: 'rest_framework.views.APIView',       desc: 'DRF base API view class' },
                        'ModelViewSet':        { label: 'rest_framework.viewsets.ModelViewSet', desc: 'DRF model view set' },
                        'urlpatterns':         { label: 'list of URL patterns',               desc: 'Django URL configuration list' },
                        'path':                { label: 'path(route, view, name=None)',        desc: 'Django URL path converter' },
                    };

                    const info = HOVER_DB[word.word];
                    if (info) {
                        return {
                            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                            contents: [
                                { value: '**' + info.label + '**' },
                                { value: info.desc },
                            ],
                        };
                    }
                    return null;
                },
            });

            // ── Python completion provider (Django snippets) ──────────────

            monaco.languages.registerCompletionItemProvider('python', {
                triggerCharacters: ['.', "'", '"'],
                provideCompletionItems(model, position) {
                    const word = model.getWordUntilPosition(position);
                    const range = {
                        startLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endLineNumber: position.lineNumber,
                        endColumn: word.endColumn,
                    };

                    const snippets = [
                        // Python basics
                        { label: 'def',      kind: 'Keyword',  insert: 'def ${1:name}(${2:args}):\n\t${3:pass}' },
                        { label: 'class',    kind: 'Keyword',  insert: 'class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t${3:pass}' },
                        { label: 'for',      kind: 'Keyword',  insert: 'for ${1:item} in ${2:iterable}:\n\t${3:pass}' },
                        { label: 'if',       kind: 'Keyword',  insert: 'if ${1:condition}:\n\t${2:pass}' },
                        { label: 'try',      kind: 'Keyword',  insert: 'try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\t${3:print(e)}' },
                        { label: 'with',     kind: 'Keyword',  insert: 'with ${1:expr} as ${2:var}:\n\t${3:pass}' },
                        { label: 'return',   kind: 'Keyword',  insert: 'return ${1:value}' },
                        { label: 'import',   kind: 'Keyword',  insert: 'import ${1:module}' },
                        { label: 'from import', kind: 'Keyword', insert: 'from ${1:module} import ${2:name}' },

                        // Django Models
                        { label: 'models.Model', kind: 'Class', insert: 'class ${1:MyModel}(models.Model):\n\t${2:name} = models.CharField(max_length=${3:100})\n\n\tdef __str__(self):\n\t\treturn self.${2:name}', detail: 'Django Model' },
                        { label: 'models.CharField', kind: 'Property', insert: '${1:name} = models.CharField(max_length=${2:100})' },
                        { label: 'models.TextField', kind: 'Property', insert: '${1:description} = models.TextField(${2:blank=True, null=True})' },
                        { label: 'models.IntegerField', kind: 'Property', insert: '${1:count} = models.IntegerField(${2:default=0})' },
                        { label: 'models.ForeignKey', kind: 'Property', insert: '${1:user} = models.ForeignKey(${2:User}, on_delete=models.${3:CASCADE})' },
                        { label: 'models.DateTimeField', kind: 'Property', insert: '${1:created} = models.DateTimeField(auto_now_add=${2:True})' },
                        { label: 'models.BooleanField', kind: 'Property', insert: '${1:is_active} = models.BooleanField(${2:default=True})' },
                        { label: 'class Meta', kind: 'Snippet', insert: 'class Meta:\n\tverbose_name = "${1:model}"\n\tverbose_name_plural = "${2:models}"\n\tordering = ("${3:-created}",)', detail: 'Django Meta class' },

                        // Django Views
                        { label: 'def get', kind: 'Snippet', insert: 'def get(self, request):\n\t${1:pass}' },
                        { label: 'def post', kind: 'Snippet', insert: 'def post(self, request):\n\t${1:pass}' },

                        // Django REST Framework
                        { label: 'class Serializer', kind: 'Snippet', insert: 'class ${1:Model}Serializer(serializers.ModelSerializer):\n\tclass Meta:\n\t\tmodel = ${2:Model}\n\t\tfields = "${3:__all__}"', detail: 'DRF ModelSerializer' },
                        { label: 'class ViewSet', kind: 'Snippet', insert: 'class ${1:Model}ViewSet(viewsets.ModelViewSet):\n\tqueryset = ${2:Model}.objects.all()\n\tserializer_class = ${3:Model}Serializer', detail: 'DRF ViewSet' },
                        { label: 'class APIView', kind: 'Snippet', insert: 'class ${1:MyView}(APIView):\n\tdef get(self, request):\n\t\t${2:pass}\n\n\tdef post(self, request):\n\t\t${3:pass}', detail: 'DRF APIView' },

                        // URLs
                        { label: 'urlpatterns', kind: 'Snippet', insert: 'urlpatterns = [\n\tpath("${1:admin/}", admin.site.urls),\n\tpath("${2:api/}", include("${3:app}.urls")),\n]' },
                    ];

                    return {
                        suggestions: snippets.map(s => ({
                            label: s.label,
                            kind: monaco.languages.CompletionItemKind[s.kind] || monaco.languages.CompletionItemKind.Snippet,
                            insertText: s.insert,
                            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                            range,
                            detail: s.detail || '',
                        })),
                    };
                },
            });

            // ── Apply saved theme ─────────────────────────────────────────

            monaco.editor.setTheme(savedTheme);
            $('#theme-select').value = savedTheme;

            logOutput('Monaco Editor initialized (Python syntax highlighting active)', 'info');
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  2. XTERM.JS TERMINAL — Connected to real shell via WebSocket
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Initialize xterm.js terminal and connect to Django Channels WebSocket.
     * The WebSocket spawns a real bash/sh/cmd process on the server,
     * and xterm.js handles the rendering + input.
     */
    function initTerminal() {
        // Load xterm.js addons (they're loaded as global vars from CDN)
        const FitAddon = window.FitAddon?.FitAddon || window.fitAddon?.FitAddon;
        const WebLinksAddon = window.WebLinksAddon?.WebLinksAddon || window.webLinksAddon?.WebLinksAddon;

        term = new window.Terminal({
            theme: {
                background: '#1e1e1e',
                foreground: '#cccccc',
                cursor: '#aeafad',
                cursorAccent: '#1e1e1e',
                selectionBackground: '#264F78',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#ffffff',
            },
            fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
            fontSize: 14,
            cursorBlink: true,
            cursorStyle: 'bar',
            scrollback: 5000,
            allowProposedApi: true,
        });

        // Fit addon (auto-resize terminal to container)
        if (FitAddon) {
            fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
        }

        // Web links addon (clickable URLs in terminal)
        if (WebLinksAddon) {
            term.loadAddon(new WebLinksAddon());
        }

        // Mount terminal to DOM
        term.open($('#terminal-container'));
        if (fitAddon) fitAddon.fit();

        // Connect to WebSocket
        connectTerminalWS();

        // ── Handle user input → send to server ────────────────────────────
        term.onData((data) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data: data }));
            }
        });

        // ── Handle terminal resize → notify server ────────────────────────
        term.onResize(({ cols, rows }) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            if (fitAddon) fitAddon.fit();
        });

        logOutput('Terminal: connecting to shell via WebSocket...', 'info');
    }

    /**
     * Establish WebSocket connection to the terminal consumer.
     * Protocol: JSON messages over ws://host/ws/terminal/
     */
    function connectTerminalWS() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/terminal/?workspace=${encodeURIComponent(workspacePath || '')}`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            $('#terminal-status').classList.remove('disconnected');
            logOutput('Terminal: connected to shell', 'success');
            term.focus();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'output') {
                    term.write(msg.data);
                } else if (msg.type === 'exit') {
                    term.write('\r\n\x1b[33m[Shell exited with code ' + msg.code + ']\x1b[0m\r\n');
                    $('#terminal-status').classList.add('disconnected');
                    // Auto-reconnect after 2 seconds
                    setTimeout(connectTerminalWS, 2000);
                } else if (msg.type === 'error') {
                    term.write('\r\n\x1b[31mError: ' + msg.message + '\x1b[0m\r\n');
                } else if (msg.type === 'pong') {
                    // Keepalive response
                }
            } catch (e) {
                // Non-JSON message, write raw
                term.write(event.data);
            }
        };

        ws.onclose = () => {
            if (ws._keepaliveId) clearInterval(ws._keepaliveId);
            $('#terminal-status').classList.add('disconnected');
            logOutput('Terminal: connection lost, reconnecting in 2s...', 'warning');
            setTimeout(connectTerminalWS, 2000);
        };

        ws.onerror = () => {
            $('#terminal-status').classList.add('disconnected');
        };

        // Keepalive ping every 30 seconds
        const keepaliveId = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
        ws._keepaliveId = keepaliveId;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  3. FILE TREE — Browse, open, create, delete files
    // ═══════════════════════════════════════════════════════════════════════

    const IGNORE_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.idea', '.vscode']);

    // ── SVG File Icons ───────────────────────────────────────────────────────

    const SVG_ICONS = {
        folder: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 1.5H14a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-12a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5z"/></svg>',
        folderOpen: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 1.5H14a.5.5 0 0 1 .5.5v1H5.5L4 2H1.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H3l1.5-2h9.5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5H6.5L5 2.5H1.5a.5.5 0 0 0-.5.5z"/></svg>',
        python: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#3572A5"><path d="M7.5 1.1a3.8 3.8 0 0 0-3.6 3.7v1.5h3.6v.2H2.7A3.8 3.8 0 0 0 6.5 12.3a3.8 3.8 0 0 0 3.7-3.6V7.5H6.6V6h5.7v1.2a3.8 3.8 0 0 1-3.7 3.7 3.8 3.8 0 0 1-3.6-3.7A3.8 3.8 0 0 1 7.5 1.1z"/></svg>',
        html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#e34c26"><path d="M1 1h14l-1.3 12L7.5 15 2.3 13 1 1zm1.2 1.2l1 9.3 4.3 1.2 4.3-1.2 1-9.3H2.2zm3.3 3h2l.1 1.5h-2L5.4 8h4.1l-.2 1.5h-2.5L6.5 11l-.2-1.5-.3-1.8H5.5z"/></svg>',
        css: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#563d7c"><path d="M1 1h14l-1.2 11L7.5 15 2.2 13 1 1zm1.2 1.2l.8 7.8 4.5 1.2 4.5-1.2.7-7.8H2.2zm3 3h5.6l-.1 1.2H5.8l.2 2h4.8l-.3 2.5-2.9.8-2.9-.8-.2-1.5h1.2l.1.8 1.7.5 1.7-.5.2-2H4.8L4.7 5.2z"/></svg>',
        js: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#f1e05a"><rect x="1" y="1" width="14" height="14" rx="1"/><text x="8" y="12" text-anchor="middle" font-size="9" font-weight="bold" fill="#323330">JS</text></svg>',
        json: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#40d47e"><path d="M3 2v12M13 2v12M1 5h4M1 11h4M11 5h4M11 11h4"/></svg>',
        markdown: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#519aba"><path d="M1 2h14v12H1zm1.5 1v10h11V3zm1.5 7V6l2 2.5L8 6v4M10 6v4l2-1v-2l2 1v-4"/></svg>',
        yaml: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#cb171e"><path d="M2 2h3l1 2H2zM2 6h3l1 2H2zM2 10h3l1 2H2z"/><text x="9" y="10" font-size="7" fill="currentColor">YML</text></svg>',
        txt: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#808080"><path d="M3 1h7l3 3v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 1v12h9V5h-3V2H3z"/><line x1="4" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width=".7"/><line x1="4" y1="9" x2="11" y2="9" stroke="currentColor" stroke-width=".7"/><line x1="4" y1="11" x2="8" y2="11" stroke="currentColor" stroke-width=".7"/></svg>',
        file: '<svg width="16" height="16" viewBox="0 0 16 16" fill="#808080"><path d="M3 1h7l3 3v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 1v12h9V5h-3V2H3z"/></svg>',
        chevron: '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" class="chevron-svg"><path d="M4.5 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };

    function getFileIcon(name, isDir) {
        if (isDir) return { svg: SVG_ICONS.folder, cls: 'dir' };
        const ext = name.split('.').pop().toLowerCase();
        const map = {
            py: SVG_ICONS.python,
            html: SVG_ICONS.html, htm: SVG_ICONS.html,
            css: SVG_ICONS.css,
            js: SVG_ICONS.js,
            json: SVG_ICONS.json,
            md: SVG_ICONS.markdown,
            yml: SVG_ICONS.yaml, yaml: SVG_ICONS.yaml,
            txt: SVG_ICONS.txt,
            toml: SVG_ICONS.txt, cfg: SVG_ICONS.txt, ini: SVG_ICONS.txt,
        };
        return { svg: map[ext] || SVG_ICONS.file, cls: 'file-' + ext };
    }

    async function buildFileTree(dirPath, container, depth) {
        const data = await apiCall('/api/list/', { path: dirPath });
        if (data.error) return;

        for (const item of data.items) {
            if (IGNORE_DIRS.has(item.name)) continue;

            const info = getFileIcon(item.name, item.isDir);
            const row = document.createElement('div');
            row.className = `file-item ${info.cls}` + (item.isDir ? ' dir' : '');
            row.dataset.path = item.path;
            row.dataset.depth = depth;
            row.style.paddingLeft = (12 + depth * 16) + 'px';

            const chevronHtml = item.isDir
                ? `<span class="file-chevron">${SVG_ICONS.chevron}</span>`
                : '';

            row.innerHTML = chevronHtml +
                `<span class="file-icon">${info.svg}</span>` +
                `<span class="file-name">${escapeHtml(item.name)}</span>`;

            const childContainer = document.createElement('div');
            childContainer.className = 'file-children';

            if (item.isDir) {
                let loaded = false;

                row.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const chevron = row.querySelector('.file-chevron');
                    const iconEl = row.querySelector('.file-icon');
                    const isOpen = childContainer.children.length > 0 && childContainer.style.display !== 'none';

                    if (isOpen) {
                        childContainer.style.display = 'none';
                        row.classList.remove('open');
                        if (chevron) chevron.classList.remove('open');
                        if (iconEl) iconEl.innerHTML = SVG_ICONS.folder;
                    } else {
                        if (!loaded) {
                            await buildFileTree(item.path, childContainer, depth + 1);
                            loaded = true;
                        }
                        childContainer.style.display = '';
                        row.classList.add('open');
                        if (chevron) chevron.classList.add('open');
                        if (iconEl) iconEl.innerHTML = SVG_ICONS.folderOpen;
                    }
                });
            } else {
                row.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await openFile(item.path, item.name);
                });
            }

            // Right-click context menu
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e.clientX, e.clientY, item.path, item.name, item.isDir);
            });

            container.appendChild(row);

            if (item.isDir) {
                container.appendChild(childContainer);
                // Auto-expand first level
                if (depth < 1) {
                    await buildFileTree(item.path, childContainer, depth + 1);
                    row.classList.add('open');
                    const chevron = row.querySelector('.file-chevron');
                    if (chevron) chevron.classList.add('open');
                    const iconEl = row.querySelector('.file-icon');
                    if (iconEl) iconEl.innerHTML = SVG_ICONS.folderOpen;
                }
            }

            // Collect files for quick-open
            if (!item.isDir) {
                allFiles.push({ name: item.name, path: item.path });
            }
        }
    }

    async function refreshFileTree() {
        const tree = $('#file-tree');
        tree.innerHTML = '';
        allFiles = [];
        if (workspacePath) {
            await buildFileTree(workspacePath, tree, 0);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  4. TAB SYSTEM — Open, switch, close, save files
    // ═══════════════════════════════════════════════════════════════════════

    function getLangFromFilename(name) {
        const ext = name.split('.').pop().toLowerCase();
        const map = {
            py: 'python', html: 'html', htm: 'html', css: 'css',
            js: 'javascript', json: 'json', md: 'markdown', txt: 'plaintext',
            xml: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'toml', sh: 'shell',
        };
        return map[ext] || 'plaintext';
    }

    function findTab(filePath) {
        return openTabs.find(t => t.path === filePath);
    }

    async function openFile(filePath, name) {
        // If tab already open, just activate it
        let tab = findTab(filePath);
        if (tab) {
            activateTab(tab.id);
            return;
        }

        // Read file content
        const data = await apiCall('/api/read/', { path: filePath });
        if (data.error) {
            logOutput(`Error: ${data.error}`, 'error');
            return;
        }

        // Create tab
        tab = {
            id: 'tab-' + Date.now(),
            path: filePath,
            name: name || filePath.split(/[/\\]/).pop(),
            modified: false,
            _content: data.content,
        };
        openTabs.push(tab);

        // Hide welcome screen
        const welcome = $('#tab-welcome');
        if (welcome) welcome.classList.remove('active');
        const wsScreen = $('#welcome-screen');
        if (wsScreen) wsScreen.classList.add('hidden');

        // Set editor content and language
        if (editor) {
            editor.setValue(data.content);
            monaco.editor.setModelLanguage(editor.getModel(), getLangFromFilename(tab.name));
            editor.focus();
        }

        activeTabId = tab.id;
        renderTabs();
        updateStatusBar(tab.name);
        logOutput(`Opened: ${tab.name}`, 'info');
    }

    function activateTab(tabId) {
        const tab = openTabs.find(t => t.id === tabId);
        if (!tab || activeTabId === tabId) return;

        activeTabId = tabId;
        if (editor) {
            const savedPos = editor.getPosition();
            editor.setValue(tab._content || '');
            monaco.editor.setModelLanguage(editor.getModel(), getLangFromFilename(tab.name));
            if (savedPos) editor.setPosition(savedPos);
            editor.focus();
        }
        renderTabs();
        updateStatusBar(tab.name);
    }

    function closeTab(tabId) {
        const idx = openTabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;
        openTabs.splice(idx, 1);

        if (activeTabId === tabId) {
            if (openTabs.length > 0) {
                const next = openTabs[Math.min(idx, openTabs.length - 1)];
                activateTab(next.id);
            } else {
                activeTabId = null;
                if (editor) editor.setValue('');
                $('#tab-welcome').classList.add('active');
                $('#welcome-screen').classList.remove('hidden');
            }
        }
        renderTabs();
    }

    function renderTabs() {
        const tabBar = $('#tab-bar');
        tabBar.innerHTML = '';

        if (openTabs.length === 0) {
            tabBar.innerHTML = '<div class="tab-welcome active" id="tab-welcome">Welcome</div>';
            return;
        }

        for (const tab of openTabs) {
            const el = document.createElement('div');
            el.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.modified ? ' modified' : '');
            el.innerHTML =
                `<span class="tab-dot"></span>` +
                `<span>${escapeHtml(tab.name)}</span>` +
                `<span class="tab-close" data-close="${tab.id}">&times;</span>`;

            el.addEventListener('click', (e) => {
                if (e.target.dataset.close) {
                    e.stopPropagation();
                    closeTab(e.target.dataset.close);
                    return;
                }
                activateTab(tab.id);
            });

            // Middle-click to close
            el.addEventListener('auxclick', (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                }
            });

            tabBar.appendChild(el);
        }
    }

    async function saveCurrentFile() {
        const tab = openTabs.find(t => t.id === activeTabId);
        if (!tab) return;

        const content = editor ? editor.getValue() : '';
        const data = await apiCall('/api/write/', { path: tab.path, content });
        if (data.error) {
            logOutput(`Save error: ${data.error}`, 'error');
            return;
        }

        tab._content = content;
        tab.modified = false;
        renderTabs();
        logOutput(`Saved: ${tab.name}`, 'success');
    }

    function updateStatusBar(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const names = { py: 'Python', html: 'HTML', css: 'CSS', js: 'JavaScript', json: 'JSON', md: 'Markdown', yml: 'YAML', yaml: 'YAML', sh: 'Shell' };
        $('#status-filetype').textContent = names[ext] || 'Plain Text';
        $('#status-space').textContent = `Spaces: ${editor ? editor.getModel().getOptions().tabSize : 4}`;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  5. SEARCH — Find text across project files
    // ═══════════════════════════════════════════════════════════════════════

    let searchTimeout = null;

    async function performSearch() {
        const query = $('#search-input').value.trim();
        const results = $('#search-results');
        if (!query || !workspacePath) {
            results.innerHTML = '';
            return;
        }

        results.innerHTML = '<div class="search-count">Searching...</div>';

        const matchCase = $('#search-case').checked;
        const isRegex = $('#search-regex').checked;

        const data = await apiCall('/api/search/', { path: workspacePath, query, matchCase, isRegex });
        if (data.error) {
            results.innerHTML = `<div class="search-count">Error: ${escapeHtml(data.error)}</div>`;
            return;
        }

        if (data.results.length === 0) {
            results.innerHTML = '<div class="search-count">No results found.</div>';
            return;
        }

        let totalMatches = 0;
        for (const r of data.results) totalMatches += r.matches.length;
        results.innerHTML = `<div class="search-count">${totalMatches} results in ${data.results.length} files</div>`;

        for (const r of data.results) {
            const shortPath = r.file.replace(workspacePath, '').replace(/^[/\\]/, '');
            const fileEl = document.createElement('div');
            fileEl.className = 'search-result-file';
            fileEl.textContent = shortPath;
            fileEl.addEventListener('click', () => openFile(r.file, r.file.split(/[/\\]/).pop()));
            results.appendChild(fileEl);

            for (const m of r.matches) {
                const matchEl = document.createElement('div');
                matchEl.className = 'search-result-match';
                let highlighted;
                try {
                    const pattern = isRegex ? query : escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(pattern, matchCase ? 'g' : 'gi');
                    highlighted = escapeHtml(m.text).replace(regex, '<mark>$&</mark>');
                } catch {
                    highlighted = escapeHtml(m.text);
                }
                matchEl.innerHTML = `<span class="search-result-line">${m.line}</span><span class="search-result-text">${highlighted}</span>`;
                matchEl.addEventListener('click', () => openFile(r.file, r.file.split(/[/\\]/).pop()));
                results.appendChild(matchEl);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  6. CONTEXT MENU — Right-click file operations
    // ═══════════════════════════════════════════════════════════════════════

    let ctxTarget = null;

    function showContextMenu(x, y, path, name, isDir) {
        ctxTarget = { path, name, isDir };
        const menu = $('#context-menu');
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.add('visible');

        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
    }

    function hideContextMenu() {
        $('#context-menu').classList.remove('visible');
        ctxTarget = null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  7. QUICK OPEN (Ctrl+P) — Fuzzy file search
    // ═══════════════════════════════════════════════════════════════════════

    function showQuickOpen() {
        const qo = $('#quick-open');
        qo.classList.add('visible');
        const input = $('#quick-open-input');
        input.value = '';
        input.focus();
        updateQuickOpenList('');
    }

    function hideQuickOpen() {
        $('#quick-open').classList.remove('visible');
    }

    function updateQuickOpenList(query) {
        const list = $('#quick-open-list');
        list.innerHTML = '';

        const filtered = query
            ? allFiles.filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
            : allFiles.slice(0, 50);

        for (const file of filtered.slice(0, 50)) {
            const el = document.createElement('div');
            el.className = 'quick-open-item';
            const info = getFileIcon(file.name, false);
            el.innerHTML = `<span class="qo-icon">${info.svg}</span>${escapeHtml(file.name)}<span class="qo-path">${escapeHtml(file.path.replace(workspacePath, ''))}</span>`;
            el.addEventListener('click', () => {
                hideQuickOpen();
                openFile(file.path, file.name);
            });
            list.appendChild(el);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  8. OUTPUT LOG
    // ═══════════════════════════════════════════════════════════════════════

    function logOutput(text, type) {
        const log = $('#output-log');
        if (!log) return;
        const el = document.createElement('div');
        el.className = 'out-line';
        el.innerHTML = `<span class="out-time">[${getTimestamp()}]</span><span class="out-${type || 'info'}">${escapeHtml(text)}</span>`;
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  8.5 AI TEST GENERATOR — Generate pytest tests via GROQ
    // ═══════════════════════════════════════════════════════════════════════

    let aiLastTests = '';

    async function generateAITests() {
        if (!workspacePath) {
            logOutput('Open a folder first to generate tests', 'warning');
            return;
        }

        const status = $('#ai-status');
        const output = $('#ai-output');
        const filesList = $('#ai-files-list');
        const saveBtn = $('#btn-ai-save');
        const genBtn = $('#btn-ai-generate');

        status.innerHTML = '<span class="ai-loading">Scanning project and generating tests...</span>';
        output.innerHTML = '';
        filesList.innerHTML = '';
        genBtn.disabled = true;
        genBtn.textContent = 'Generating...';

        logOutput('AI: Scanning Django project for test generation...', 'info');

        try {
            const data = await apiCall('/api/ai/generate-tests/', { path: workspacePath });

            if (data.error) {
                status.innerHTML = `<span class="ai-error">${escapeHtml(data.error)}</span>`;
                logOutput('AI: ' + data.error, 'error');
                return;
            }

            // Show scanned files
            if (data.files_scanned && data.files_scanned.length > 0) {
                filesList.innerHTML = '<div class="ai-files-header">Scanned files:</div>' +
                    data.files_scanned.map(f => `<div class="ai-file-item">${escapeHtml(f)}</div>`).join('');
            }

            // Show generated tests
            aiLastTests = data.tests;
            const highlighted = escapeHtml(data.tests);
            output.innerHTML = `<pre class="ai-code"><code>${highlighted}</code></pre>`;

            status.innerHTML = `<span class="ai-success">Tests generated with ${escapeHtml(data.model || 'AI')}</span>`;
            saveBtn.style.display = 'flex';
            logOutput(`AI: Generated tests (model: ${data.model})`, 'success');
        } catch (err) {
            status.innerHTML = `<span class="ai-error">Error: ${escapeHtml(err.message)}</span>`;
            logOutput('AI test generation failed: ' + err.message, 'error');
        } finally {
            genBtn.disabled = false;
            genBtn.textContent = 'Generate Tests';
        }
    }

    async function saveAITestsToFile() {
        if (!aiLastTests || !workspacePath) return;
        const name = prompt('Save tests as:', 'tests/test_generated.py');
        if (!name) return;
        const fullPath = workspacePath + '/' + name;
        const data = await apiCall('/api/write/', { path: fullPath, content: aiLastTests });
        if (data.error) {
            logOutput('Save error: ' + data.error, 'error');
        } else {
            logOutput('Tests saved to: ' + name, 'success');
            await refreshFileTree();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  9. PANEL RESIZE — Drag to resize terminal height
    // ═══════════════════════════════════════════════════════════════════════

    function initResize() {
        const handle = $('#resize-handle');
        const panel = $('#bottom-panel');
        let startY, startH;

        handle.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            startH = panel.offsetHeight;

            const onMove = (e) => {
                const delta = startY - e.clientY;
                panel.style.height = Math.max(100, startH + delta) + 'px';
                if (fitAddon) fitAddon.fit();
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  10. DOCKER — Container logs and status
    // ═══════════════════════════════════════════════════════════════════════

    async function fetchDockerLogs() {
        const containerId = $('#docker-container-id')?.value.trim();
        if (!containerId) { logOutput('Enter a container ID', 'warning'); return; }
        const output = $('#docker-output');
        output.innerHTML = '<span class="ai-loading">Fetching logs...</span>';
        const data = await apiCall('/api/docker/logs/', { container_id: containerId, tail: 200 });
        if (data.error) {
            output.innerHTML = `<pre class="ai-code"><code>${escapeHtml(data.error)}</code></pre>`;
        } else {
            output.innerHTML = `<pre class="ai-code"><code>${escapeHtml(data.logs || '(no output)')}</code></pre>`;
        }
    }

    async function fetchDockerStatus() {
        const containerId = $('#docker-container-id')?.value.trim();
        if (!containerId) { logOutput('Enter a container ID', 'warning'); return; }
        const output = $('#docker-output');
        output.innerHTML = '<span class="ai-loading">Checking status...</span>';
        const data = await apiCall('/api/docker/status/', { container_id: containerId });
        if (data.error) {
            output.innerHTML = `<span class="ai-error">${escapeHtml(data.error)}</span>`;
        } else {
            const color = data.status === 'running' ? 'var(--green)' : 'var(--red)';
            output.innerHTML = `<span style="color:${color}; font-weight:600;">Status: ${escapeHtml(data.status)}</span>`;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  11. API CLIENT — HTTP request proxy with history
    // ═══════════════════════════════════════════════════════════════════════

    const API_HISTORY_KEY = 'djangonaut_api_history';
    let apiHistoryVisible = false;

    function getApiHistory() {
        try { return JSON.parse(localStorage.getItem(API_HISTORY_KEY) || '[]'); } catch { return []; }
    }

    function saveApiHistory(entry) {
        const history = getApiHistory();
        history.unshift(entry);
        if (history.length > 50) history.pop();
        localStorage.setItem(API_HISTORY_KEY, JSON.stringify(history));
    }

    async function sendApiRequest() {
        const method = $('#api-method')?.value || 'GET';
        const url = $('#api-url')?.value.trim();
        const headersRaw = $('#api-headers')?.value.trim() || '{}';
        const bodyRaw = $('#api-body')?.value.trim();

        if (!url) { logOutput('Enter a URL', 'warning'); return; }

        let headers = {};
        try { headers = JSON.parse(headersRaw); } catch { logOutput('Invalid headers JSON', 'error'); return; }

        let body = null;
        if (bodyRaw && method !== 'GET') {
            try { body = JSON.parse(bodyRaw); } catch { body = bodyRaw; }
        }

        const response = $('#api-response');
        response.innerHTML = '<span class="ai-loading">Sending request...</span>';

        const data = await apiCall('/api/http/proxy/', { method, url, headers, body });

        saveApiHistory({ method, url, status: data.status, time: Date.now() });

        if (data.error && !data.status) {
            response.innerHTML = `<span class="ai-error">${escapeHtml(data.error)}</span>`;
        } else {
            let bodyStr = data.body || '';
            try { bodyStr = JSON.stringify(JSON.parse(bodyStr), null, 2); } catch {}
            response.innerHTML =
                `<div style="margin-bottom:6px;"><span style="color:${data.status < 400 ? 'var(--green)' : 'var(--red)'}; font-weight:600;">${data.status}</span></div>` +
                `<pre class="ai-code"><code>${escapeHtml(bodyStr.slice(0, 5000))}</code></pre>`;
        }
    }

    function toggleApiHistory() {
        const list = $('#api-history-list');
        apiHistoryVisible = !apiHistoryVisible;
        if (!apiHistoryVisible) { list.style.display = 'none'; return; }
        const history = getApiHistory();
        list.style.display = 'block';
        list.innerHTML = history.length === 0
            ? '<div style="font-size:11px; color:var(--text-dim);">No history yet</div>'
            : history.slice(0, 20).map(h =>
                `<div class="api-history-item" style="display:flex; gap:6px; padding:3px 0; font-size:11px; cursor:pointer; color:var(--text-dim);" data-url="${escapeHtml(h.url)}" data-method="${h.method}">` +
                `<span style="color:${h.status < 400 ? 'var(--green)' : 'var(--red)'}; min-width:30px;">${h.status || 'ERR'}</span>` +
                `<span style="color:var(--accent); min-width:42px;">${h.method}</span>` +
                `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(h.url)}</span></div>`
            ).join('');

        list.querySelectorAll('.api-history-item').forEach(item => {
            item.addEventListener('click', () => {
                $('#api-url').value = item.dataset.url;
                $('#api-method').value = item.dataset.method;
                apiHistoryVisible = false;
                list.style.display = 'none';
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════

    document.addEventListener('DOMContentLoaded', () => {

        // ── Initialize editors ────────────────────────────────────────────
        initMonaco();
        initTerminal();
        initResize();

        // ── Activity Bar panel switching ──────────────────────────────────
        $$('.activity-icon[data-panel]').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.activity-icon[data-panel]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                $$('.sidebar-panel').forEach(p => p.classList.remove('active'));
                const panel = $(`#panel-${btn.dataset.panel}`);
                if (panel) panel.classList.add('active');
            });
        });

        // ── Bottom panel tabs ─────────────────────────────────────────────
        $$('.panel-tab[data-bpanel]').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.panel-tab[data-bpanel]').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                $$('.panel-content').forEach(p => p.classList.remove('active'));
                const panel = $(`#bpanel-${tab.dataset.bpanel}`);
                if (panel) panel.classList.add('active');
                if (tab.dataset.bpanel === 'terminal' && fitAddon) fitAddon.fit();
            });
        });

        // ── Open Folder ───────────────────────────────────────────────────
        $('#btn-open-folder').addEventListener('click', async () => {
            const path = prompt('Enter folder path to open:', workspacePath || '');
            if (!path) return;
            workspacePath = path;
            $('#folder-name').textContent = path.split(/[/\\]/).pop();
            await refreshFileTree();
            logOutput(`Opened folder: ${path}`, 'success');

            // Reconnect terminal with new workspace
            if (ws) ws.close();
            connectTerminalWS();
        });

        // ── New File / New Folder ─────────────────────────────────────────
        $('#btn-new-file').addEventListener('click', async () => {
            if (!workspacePath) { logOutput('Open a folder first', 'warning'); return; }
            const name = prompt('File name:', 'untitled.py');
            if (!name) return;
            await apiCall('/api/create-file/', { path: workspacePath + '/' + name });
            await refreshFileTree();
            logOutput(`Created file: ${name}`, 'success');
        });

        $('#btn-new-folder').addEventListener('click', async () => {
            if (!workspacePath) { logOutput('Open a folder first', 'warning'); return; }
            const name = prompt('Folder name:', 'new_folder');
            if (!name) return;
            await apiCall('/api/create-dir/', { path: workspacePath + '/' + name });
            await refreshFileTree();
            logOutput(`Created folder: ${name}`, 'success');
        });

        // ── Clear Terminal ────────────────────────────────────────────────
        $('#btn-clear-terminal').addEventListener('click', () => {
            if (term) term.clear();
        });

        // ── Search ────────────────────────────────────────────────────────
        $('#search-input').addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(performSearch, 300);
        });
        $('#search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { clearTimeout(searchTimeout); performSearch(); }
        });

        // ── Context menu items ────────────────────────────────────────────
        $$('.ctx-item').forEach(item => {
            item.addEventListener('click', async () => {
                if (!ctxTarget) return;
                hideContextMenu();
                const action = item.dataset.action;

                if (action === 'open') {
                    openFile(ctxTarget.path, ctxTarget.name);
                } else if (action === 'rename') {
                    const newName = prompt('Rename to:', ctxTarget.name);
                    if (!newName || newName === ctxTarget.name) return;
                    const dir = ctxTarget.path.replace(/[/\\][^/\\]+$/, '');
                    await apiCall('/api/rename/', { oldPath: ctxTarget.path, newPath: dir + '/' + newName });
                    await refreshFileTree();
                } else if (action === 'delete') {
                    if (!confirm(`Delete "${ctxTarget.name}"?`)) return;
                    await apiCall('/api/delete/', { path: ctxTarget.path });
                    const tab = findTab(ctxTarget.path);
                    if (tab) closeTab(tab.id);
                    await refreshFileTree();
                    logOutput(`Deleted: ${ctxTarget.name}`, 'info');
                }
            });
        });

        // ── Theme selector ────────────────────────────────────────────────
        $('#theme-select').addEventListener('change', (e) => {
            const themeId = e.target.value;
            localStorage.setItem('webide_theme', themeId);
            if (editor) monaco.editor.setTheme(themeId);
        });

        // ── Editor settings ───────────────────────────────────────────────
        $('#fontsize-select').addEventListener('change', (e) => {
            localStorage.setItem('webide_fontsize', e.target.value);
            if (editor) editor.updateOptions({ fontSize: parseInt(e.target.value) });
        });
        $('#tabsize-select').addEventListener('change', (e) => {
            localStorage.setItem('webide_tabsize', e.target.value);
            if (editor) editor.updateOptions({ tabSize: parseInt(e.target.value) });
        });
        $('#wordwrap-check').addEventListener('change', (e) => {
            localStorage.setItem('webide_wordwrap', e.target.checked);
            if (editor) editor.updateOptions({ wordWrap: e.target.checked ? 'on' : 'off' });
        });
        $('#minimap-check').addEventListener('change', (e) => {
            localStorage.setItem('webide_minimap', e.target.checked);
            if (editor) editor.updateOptions({ minimap: { enabled: e.target.checked } });
        });

        // ── AI Test Generator ────────────────────────────────────────────
        const aiGenBtn = $('#btn-ai-generate');
        if (aiGenBtn) aiGenBtn.addEventListener('click', generateAITests);
        const aiSaveBtn = $('#btn-ai-save');
        if (aiSaveBtn) aiSaveBtn.addEventListener('click', saveAITestsToFile);

        // ── Docker ───────────────────────────────────────────────────────
        const dockerLogsBtn = $('#btn-docker-logs');
        if (dockerLogsBtn) dockerLogsBtn.addEventListener('click', fetchDockerLogs);
        const dockerStatusBtn = $('#btn-docker-status');
        if (dockerStatusBtn) dockerStatusBtn.addEventListener('click', fetchDockerStatus);
        const dockerRefreshBtn = $('#btn-docker-refresh');
        if (dockerRefreshBtn) dockerRefreshBtn.addEventListener('click', fetchDockerLogs);

        // ── API Client ───────────────────────────────────────────────────
        const apiSendBtn = $('#btn-api-send');
        if (apiSendBtn) apiSendBtn.addEventListener('click', sendApiRequest);
        const apiHistoryBtn = $('#btn-api-history');
        if (apiHistoryBtn) apiHistoryBtn.addEventListener('click', toggleApiHistory);

        // ── Global keyboard shortcuts ─────────────────────────────────────
        document.addEventListener('keydown', (e) => {
            // Ctrl+S — save
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
            // Ctrl+O — open folder
            if (e.ctrlKey && e.key === 'o') { e.preventDefault(); $('#btn-open-folder').click(); }
            // Ctrl+` — focus terminal
            if (e.ctrlKey && e.key === '`') { e.preventDefault(); term && term.focus(); }
            // Ctrl+P — quick open
            if (e.ctrlKey && e.key === 'p') { e.preventDefault(); showQuickOpen(); }
            // Ctrl+W — close tab
            if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
            // Escape — close quick-open
            if (e.key === 'Escape') { hideQuickOpen(); hideContextMenu(); }
        });

        // ── Quick Open input ──────────────────────────────────────────────
        const qoInput = $('#quick-open-input');
        if (qoInput) {
            qoInput.addEventListener('input', (e) => updateQuickOpenList(e.target.value));
            qoInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') hideQuickOpen();
                if (e.key === 'Enter') {
                    const first = $('#quick-open-list .quick-open-item');
                    if (first) first.click();
                }
            });
        }

        // Close context menu and quick-open on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#context-menu') && !e.target.closest('.file-item')) {
                hideContextMenu();
            }
            if (!e.target.closest('#quick-open')) {
                hideQuickOpen();
            }
        });

        // ── Init complete ─────────────────────────────────────────────────
        logOutput('DjangoNAUT ready', 'success');
        logOutput('Monaco Editor: Python syntax highlighting active', 'info');
        logOutput('Terminal: WebSocket connecting to shell...', 'info');
    });

})();
