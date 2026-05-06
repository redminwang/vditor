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
