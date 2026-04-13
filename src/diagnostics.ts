import * as vscode from 'vscode';
import { VRL_FUNCTIONS, FALLIBLE_FUNCTIONS, VRL_FUNCTION_NAMES } from './vrlFunctions';

export class VrlDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('vrl');
    }

    public validateDocument(document: vscode.TextDocument): void {
        console.log(
            `[VRL] Validating document: ${document.fileName}, language: ${document.languageId}`
        );
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        console.log(`[VRL] Document has ${lines.length} lines`);

        this.checkDocumentSyntax(text, lines, diagnostics);
        this.checkControlFlowSyntax(lines, diagnostics);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i;

            if (!line.trim() || line.trim().startsWith('#')) {
                continue;
            }

            this.checkSemanticErrors(line, lineNumber, diagnostics);
            this.checkBestPractices(line, lineNumber, diagnostics);
        }

        console.log(`[VRL] Found ${diagnostics.length} diagnostics total`);
        const errorCount = diagnostics.filter(
            (d) => d.severity === vscode.DiagnosticSeverity.Error
        ).length;
        console.log(`[VRL] Found ${errorCount} error diagnostics`);

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private checkSyntaxErrors(
        line: string,
        lineNumber: number,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const trimmedLine = line.trim();

        // Check for unmatched parentheses
        const openParens = (line.match(/\(/g) || []).length;
        const closeParens = (line.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(lineNumber, 0, lineNumber, line.length),
                'Unmatched parentheses',
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'syntax-error';
            diagnostics.push(diagnostic);
        }

        // Check for unmatched braces
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(lineNumber, 0, lineNumber, line.length),
                'Unmatched braces',
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'syntax-error';
            diagnostics.push(diagnostic);
        }

        // Check for unmatched brackets
        const openBrackets = (line.match(/\[/g) || []).length;
        const closeBrackets = (line.match(/\]/g) || []).length;
        if (openBrackets !== closeBrackets) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(lineNumber, 0, lineNumber, line.length),
                'Unmatched brackets',
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'syntax-error';
            diagnostics.push(diagnostic);
        }

        // Check for invalid field paths
        const invalidFieldPath = /\.[^a-zA-Z_]/;
        if (invalidFieldPath.test(line)) {
            const match = line.match(invalidFieldPath);
            if (match) {
                const startPos = line.indexOf(match[0]);
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(lineNumber, startPos, lineNumber, startPos + match[0].length),
                    'Invalid field path syntax',
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.code = 'invalid-field-path';
                diagnostics.push(diagnostic);
            }
        }
    }

    private checkSemanticErrors(
        line: string,
        lineNumber: number,
        diagnostics: vscode.Diagnostic[]
    ): void {
        for (const func of FALLIBLE_FUNCTIONS) {
            const funcCallPattern = new RegExp(`\\b${func}\\s*\\(`);
            const match = line.match(funcCallPattern);

            if (match) {
                console.log(`[VRL] Found fallible function call: ${func} in line: ${line}`);
                const hasErrorHandling = this.hasProperErrorHandling(line, func);
                console.log(`[VRL] Has error handling: ${hasErrorHandling}`);
                if (!hasErrorHandling) {
                    const startPos = line.indexOf(func);
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(lineNumber, startPos, lineNumber, startPos + func.length),
                        `Fallible function '${func}' requires error handling. Use '${func}!(...)' to abort on error, '${func}(...) ?? default' for fallback, or 'result, err = ${func}(...)'`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.code = 'missing-error-handling';

                    const fixes: vscode.CodeAction[] = [];

                    const bangFix = new vscode.CodeAction(
                        `Use ${func}!(...) - abort on error`,
                        vscode.CodeActionKind.QuickFix
                    );
                    bangFix.edit = new vscode.WorkspaceEdit();
                    bangFix.edit.replace(
                        vscode.Uri.file(''),
                        new vscode.Range(
                            lineNumber,
                            startPos + func.length,
                            lineNumber,
                            startPos + func.length
                        ),
                        '!'
                    );
                    fixes.push(bangFix);

                    diagnostic.relatedInformation = [
                        new vscode.DiagnosticRelatedInformation(
                            new vscode.Location(
                                vscode.Uri.file(''),
                                new vscode.Range(
                                    lineNumber,
                                    startPos,
                                    lineNumber,
                                    startPos + func.length
                                )
                            ),
                            'Fallible functions must handle potential errors explicitly'
                        ),
                    ];

                    diagnostics.push(diagnostic);
                }
            }
        }

        const functionPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

        let match;
        while ((match = functionPattern.exec(line)) !== null) {
            const funcName = match[1];
            if (!VRL_FUNCTION_NAMES.includes(funcName)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(
                        lineNumber,
                        match.index,
                        lineNumber,
                        match.index + funcName.length
                    ),
                    `Unknown function '${funcName}'. Did you mean one of: ${this.getSimilarFunctions(funcName).join(', ')}?`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.code = 'unknown-function';
                diagnostics.push(diagnostic);
            }
        }
    }

    private checkBestPractices(
        line: string,
        lineNumber: number,
        diagnostics: vscode.Diagnostic[]
    ): void {
        if (line.includes('del(.)')) {
            const startPos = line.indexOf('del(.)');
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(lineNumber, startPos, lineNumber, startPos + 6),
                'Deleting the entire event (del(.)) will result in an empty event',
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.code = 'del-root-event';
            diagnostics.push(diagnostic);
        }

        const fallibleWithBang = /\b(parse_\w+|to_int|to_float|decode_\w+)!/;
        if (fallibleWithBang.test(line) && !line.includes('??')) {
            const match = line.match(fallibleWithBang);
            if (match) {
                const startPos = line.indexOf(match[0]);
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(lineNumber, startPos, lineNumber, startPos + match[0].length),
                    'Consider using null coalescing (??) for more graceful error handling',
                    vscode.DiagnosticSeverity.Hint
                );
                diagnostic.code = 'suggest-null-coalescing';
                diagnostics.push(diagnostic);
            }
        }

        if (line.includes('parse_regex') && line.includes('.*')) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(lineNumber, 0, lineNumber, line.length),
                'Regex patterns with .* can be slow on large inputs',
                vscode.DiagnosticSeverity.Information
            );
            diagnostic.code = 'regex-performance';
            diagnostics.push(diagnostic);
        }
    }

    private hasProperErrorHandling(line: string, funcName: string): boolean {
        const hasBang = new RegExp(`\\b${funcName}!\\s*\\(`).test(line);
        const hasNullCoalescing = line.includes('??');
        const hasExplicitErrorHandling = /\w+\s*,\s*\w+\s*=/.test(line);

        return hasBang || hasNullCoalescing || hasExplicitErrorHandling;
    }

    private getSimilarFunctions(input: string): string[] {
        return VRL_FUNCTION_NAMES.filter(
            (name) => this.levenshteinDistance(input.toLowerCase(), name.toLowerCase()) <= 3
        ).slice(0, 3);
    }

    private levenshteinDistance(str1: string, str2: string): number {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    private checkDocumentSyntax(
        _text: string,
        lines: string[],
        diagnostics: vscode.Diagnostic[]
    ): void {
        let braceCount = 0;
        let parenCount = 0;
        let bracketCount = 0;

        // Process line by line, stripping string literals first so that
        // braces/parens/brackets inside strings are not counted.
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const raw = lines[lineNum];
            // Strip double-quoted strings, single-quoted strings and VRL regex literals.
            const stripped = raw
                .replace(/r"[^"]*"/g, 'r""')
                .replace(/"(?:[^"\\]|\\.)*"/g, '""')
                .replace(/'(?:[^'\\]|\\.)*'/g, "''");

            for (let col = 0; col < stripped.length; col++) {
                const char = stripped[col];
                switch (char) {
                    case '{':
                        braceCount++;
                        break;
                    case '}':
                        braceCount--;
                        if (braceCount < 0) {
                            const diagnostic = new vscode.Diagnostic(
                                new vscode.Range(lineNum, col, lineNum, col + 1),
                                'Unexpected closing brace - no matching opening brace',
                                vscode.DiagnosticSeverity.Error
                            );
                            diagnostic.code = 'unmatched-closing-brace';
                            diagnostics.push(diagnostic);
                            braceCount = 0;
                        }
                        break;
                    case '(':
                        parenCount++;
                        break;
                    case ')':
                        parenCount--;
                        if (parenCount < 0) {
                            const diagnostic = new vscode.Diagnostic(
                                new vscode.Range(lineNum, col, lineNum, col + 1),
                                'Unexpected closing parenthesis - no matching opening parenthesis',
                                vscode.DiagnosticSeverity.Error
                            );
                            diagnostic.code = 'unmatched-closing-paren';
                            diagnostics.push(diagnostic);
                            parenCount = 0;
                        }
                        break;
                    case '[':
                        bracketCount++;
                        break;
                    case ']':
                        bracketCount--;
                        if (bracketCount < 0) {
                            const diagnostic = new vscode.Diagnostic(
                                new vscode.Range(lineNum, col, lineNum, col + 1),
                                'Unexpected closing bracket - no matching opening bracket',
                                vscode.DiagnosticSeverity.Error
                            );
                            diagnostic.code = 'unmatched-closing-bracket';
                            diagnostics.push(diagnostic);
                            bracketCount = 0;
                        }
                        break;
                }
            }
        }

        if (braceCount > 0) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(
                    lines.length - 1,
                    0,
                    lines.length - 1,
                    lines[lines.length - 1].length
                ),
                `Missing ${braceCount} closing brace${braceCount > 1 ? 's' : ''}`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'missing-closing-brace';
            diagnostics.push(diagnostic);
        }

        if (parenCount > 0) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(
                    lines.length - 1,
                    0,
                    lines.length - 1,
                    lines[lines.length - 1].length
                ),
                `Missing ${parenCount} closing parenthesis${parenCount > 1 ? 'es' : ''}`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'missing-closing-paren';
            diagnostics.push(diagnostic);
        }

        if (bracketCount > 0) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(
                    lines.length - 1,
                    0,
                    lines.length - 1,
                    lines[lines.length - 1].length
                ),
                `Missing ${bracketCount} closing bracket${bracketCount > 1 ? 's' : ''}`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'missing-closing-bracket';
            diagnostics.push(diagnostic);
        }
    }

    private checkControlFlowSyntax(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const prevLine = i > 0 ? lines[i - 1].trim() : '';

            if (line.startsWith('else ') || line.startsWith('else if ') || line === 'else') {
                if (prevLine.endsWith('}')) {
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(i, 0, i, line.length),
                        "In VRL, 'else' and 'else if' must be on the same line as the closing '}'. Use: '} else {' or '} else if condition {'",
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.code = 'vrl-else-same-line';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
