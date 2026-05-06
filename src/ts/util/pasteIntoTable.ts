import { hasClosestByMatchTag } from "./hasClosest";
import { getEditorRange, setRangeByWbr } from "./selection";

interface ICellPosition {
    row: number;
    col: number;
}

const extractCellMatrix = (sourceTable: HTMLTableElement): string[][] => {
    const matrix: string[][] = [];
    sourceTable.querySelectorAll("tr").forEach((row) => {
        const cells: string[] = [];
        row.querySelectorAll("th, td").forEach((cell) => {
            cells.push((cell as HTMLElement).innerHTML.trim());
        });
        if (cells.length > 0) {
            matrix.push(cells);
        }
    });
    return matrix;
};

const findCellPosition = (
    cell: HTMLTableCellElement,
    table: HTMLTableElement
): ICellPosition | null => {
    for (let r = 0; r < table.rows.length; r++) {
        for (let c = 0; c < table.rows[r].cells.length; c++) {
            if (table.rows[r].cells[c] === cell) {
                return { row: r, col: c };
            }
        }
    }
    return null;
};

// https://github.com/Vanessa219/vditor/issues/905
// When the caret is inside a TD/TH and the paste payload is a table fragment,
// fill cells of the existing table starting from the focused cell, expanding
// rows/columns as needed. Without this, insertHTML either inserts a sibling
// table (data-block path) or dumps the whole HTML fragment into a single cell.
//
// Caller contract: this helper leaves the editor selection collapsed at the
// end of the last filled cell. The post-paste finalizer in fixBrowserBehavior
// then runs SpinVditorDOM on the containing block and execAfterRender
// captures the undo entry, so no extra event dispatch is required here.
export const pasteIntoTable = (
    vditor: IVditor,
    cellElement: HTMLTableCellElement,
    sourceFragment: HTMLElement
): boolean => {
    const sourceTable = sourceFragment.querySelector("table");
    if (!sourceTable) {
        return false;
    }

    const matrix = extractCellMatrix(sourceTable);
    if (matrix.length === 0 || matrix[0].length === 0) {
        return false;
    }

    const targetTable = hasClosestByMatchTag(
        cellElement,
        "TABLE"
    ) as HTMLTableElement;
    if (!targetTable) {
        return false;
    }

    const start = findCellPosition(cellElement, targetTable);
    if (!start) {
        return false;
    }

    const editorElement = vditor[vditor.currentMode].element;
    editorElement.querySelectorAll("wbr").forEach((wbr) => wbr.remove());

    // Lute normalizes markdown tables to the header row's width on the next
    // SpinVditorDOM pass, so any column we append past that width is silently
    // trimmed. Pre-grow every existing row (header and body) to the final
    // width before filling, using <th> for the header row to keep <thead>
    // consistent.
    const maxRowWidth = matrix.reduce((m, row) => Math.max(m, row.length), 0);
    const finalWidth = Math.max(
        ...Array.from(targetTable.rows, (r) => r.cells.length),
        start.col + maxRowWidth,
    );
    for (let i = 0; i < targetTable.rows.length; i++) {
        const row = targetTable.rows[i];
        const isHeaderRow = !!hasClosestByMatchTag(row, "THEAD");
        while (row.cells.length < finalWidth) {
            if (isHeaderRow) {
                row.appendChild(document.createElement("th"));
            } else {
                row.insertCell(-1);
            }
        }
    }

    let lastFilledCell: HTMLTableCellElement | null = null;
    for (let r = 0; r < matrix.length; r++) {
        const rowIndex = start.row + r;
        let row: HTMLTableRowElement;
        if (rowIndex < targetTable.rows.length) {
            row = targetTable.rows[rowIndex];
        } else {
            row = targetTable.insertRow(-1);
            for (let pad = 0; pad < start.col; pad++) {
                row.insertCell(-1);
            }
        }
        for (let c = 0; c < matrix[r].length; c++) {
            const colIndex = start.col + c;
            let cell: HTMLTableCellElement;
            if (colIndex < row.cells.length) {
                cell = row.cells[colIndex];
            } else {
                cell = row.insertCell(-1);
            }
            cell.innerHTML = matrix[r][c];
            lastFilledCell = cell;
        }
    }

    if (lastFilledCell) {
        lastFilledCell.insertAdjacentHTML("beforeend", "<wbr>");
        setRangeByWbr(editorElement, getEditorRange(vditor));
    }

    return true;
};

// Vditor's wysiwyg.copy() clears text/html and only emits a markdown form on
// the clipboard. When the markdown is just a row fragment (no header+separator
// pair) Lute's Md2VditorDOM doesn't recognize it as a table, so the textPlain
// paste branch needs to detect the row fragment itself. Splits on pipes,
// drops the optional alignment separator line, returns null if nothing
// looked table-shaped. Trims surrounding whitespace per cell.
export const parseMarkdownTableRows = (text: string): string[][] | null => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) {
        return null;
    }
    const matrix: string[][] = [];
    for (const line of lines) {
        // Real markdown table rows are pipe-bounded: "| a | b | c |".
        // Refusing unbounded text protects against false positives like shell
        // pipes ("cmd | grep foo"), inline code, or natural sentences that
        // happen to contain a single "|".
        if (!/^\|.*\|$/.test(line)) {
            return null;
        }
        // Skip the alignment separator line, e.g. |---|:--:|---|
        if (/^\|[\s\-:|]+\|$/.test(line)) {
            continue;
        }
        const cells = line.slice(1, -1).split("|").map((c) => c.trim());
        if (cells.length === 0) {
            return null;
        }
        matrix.push(cells);
    }
    return matrix.length > 0 ? matrix : null;
};

const escapeHtml = (s: string): string =>
    s.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

export const buildTableFragmentFromMatrix = (matrix: string[][]): HTMLElement => {
    const fragment = document.createElement("div");
    const rowsHtml = matrix
        .map(
            (row) =>
                "<tr>" +
                row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("") +
                "</tr>"
        )
        .join("");
    fragment.innerHTML = `<table><tbody>${rowsHtml}</tbody></table>`;
    return fragment;
};
