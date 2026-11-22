"""Deterministic DOCX and PDF rendering for saved manuscript sections.

Supports legacy plain text, Markdown pipe tables, tab-separated tables, and
sanitised rich-text HTML (including tables pasted from Word). Source records
are never modified by this renderer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from html.parser import HTMLParser
from io import BytesIO
import re
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
    Table, TableStyle,
)


def _validate(title: str, sections: list[dict[str, Any]]) -> None:
    if not isinstance(title, str) or not title.strip():
        raise ValueError("A manuscript title is required.")
    if not isinstance(sections, list):
        raise ValueError("Manuscript sections must be a list.")
    seen: set[str] = set()
    for section in sections:
        if not isinstance(section, dict):
            raise ValueError("Each manuscript section must be an object.")
        section_id = section.get("section_id")
        heading = section.get("title")
        content = section.get("content", "")
        if not isinstance(section_id, str) or not section_id.strip() or section_id in seen:
            raise ValueError("Section identifiers must be unique and non-empty.")
        if not isinstance(heading, str) or not heading.strip():
            raise ValueError("Every manuscript section needs a title.")
        if not isinstance(content, str):
            raise ValueError("Section content must be text.")
        seen.add(section_id)


def _ordered_sections(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(sections, key=lambda item: (int(item.get("order", 0)), item["section_id"]))


class _RichContentParser(HTMLParser):
    """Extract safe text blocks and native table grids from stored HTML."""
    BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "li"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict[str, Any]] = []
        self.text_parts: list[str] = []
        self.in_table = False
        self.rows: list[list[str]] = []
        self.row: list[str] | None = None
        self.cell_parts: list[str] | None = None

    def _flush_text(self) -> None:
        text = "".join(self.text_parts).strip()
        if text:
            self.blocks.append({"type": "text", "text": re.sub(r"\s+", " ", text)})
        self.text_parts = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "table":
            self._flush_text()
            self.in_table = True
            self.rows = []
        elif self.in_table:
            if tag == "tr":
                self.row = []
            elif tag in {"td", "th"}:
                self.cell_parts = []
            elif tag == "br" and self.cell_parts is not None:
                self.cell_parts.append(" ")
        elif tag in self.BLOCK_TAGS:
            self._flush_text()
        elif tag == "br":
            self.text_parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.in_table:
            if tag in {"td", "th"} and self.cell_parts is not None:
                self.row = self.row if self.row is not None else []
                self.row.append(re.sub(r"\s+", " ", "".join(self.cell_parts)).strip())
                self.cell_parts = None
            elif tag == "tr" and self.row is not None:
                if self.row:
                    self.rows.append(self.row)
                self.row = None
            elif tag == "table":
                if self.row:
                    self.rows.append(self.row)
                if self.rows:
                    self.blocks.append({"type": "table", "rows": self.rows})
                self.in_table = False
                self.rows = []
        elif tag in self.BLOCK_TAGS:
            self._flush_text()

    def handle_data(self, data: str) -> None:
        if self.in_table:
            if self.cell_parts is not None:
                self.cell_parts.append(data)
        else:
            self.text_parts.append(data)

    def finish(self) -> list[dict[str, Any]]:
        self._flush_text()
        return self.blocks


def _split_markdown_row(line: str) -> list[str]:
    value = line.strip().strip("|")
    cells: list[str] = []
    current: list[str] = []
    escaped = False
    for char in value:
        if char == "|" and not escaped:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(char)
        escaped = (char == "\\") and not escaped
        if char != "\\":
            escaped = False
    cells.append("".join(current).strip())
    return cells


def _is_separator_row(line: str) -> bool:
    cells = _split_markdown_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) for c in cells)


def _content_blocks(content: str) -> list[dict[str, Any]]:
    """Convert stored content to text/table blocks without flattening grids."""
    value = content.replace("\r\n", "\n").replace("\r", "\n")
    if re.search(r"<\s*(?:table|p|div|h[1-4])\\b", value, re.I):
        parser = _RichContentParser()
        parser.feed(value)
        blocks = parser.finish()
        if blocks:
            return blocks

    lines = value.split("\n")
    blocks: list[dict[str, Any]] = []
    paragraph: list[str] = []

    def flush_paragraph() -> None:
        text = " ".join(part.strip() for part in paragraph if part.strip()).strip()
        if text:
            blocks.append({"type": "text", "text": text})
        paragraph.clear()

    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            flush_paragraph()
            index += 1
            continue

        # GitHub-flavoured Markdown pipe table: header, separator, then rows.
        if "|" in line and index + 1 < len(lines) and "|" in lines[index + 1] and _is_separator_row(lines[index + 1]):
            flush_paragraph()
            rows = [_split_markdown_row(line)]
            index += 2
            while index < len(lines) and "|" in lines[index] and lines[index].strip():
                rows.append(_split_markdown_row(lines[index]))
                index += 1
            width = max(len(row) for row in rows)
            rows = [row + [""] * (width - len(row)) for row in rows]
            blocks.append({"type": "table", "rows": rows})
            continue

        # Consecutive tab-separated lines form a table when at least two columns exist.
        if "\t" in line:
            flush_paragraph()
            rows = []
            while index < len(lines) and "\t" in lines[index]:
                rows.append([cell.strip() for cell in lines[index].split("\t")])
                index += 1
            width = max(len(row) for row in rows)
            rows = [row + [""] * (width - len(row)) for row in rows]
            blocks.append({"type": "table", "rows": rows})
            continue

        paragraph.append(line)
        index += 1

    flush_paragraph()
    return blocks


def _set_cell_shading(cell: Any, fill: str) -> None:
    shading = OxmlElement("w:shd")
    shading.set(qn("w:fill"), fill)
    cell._tc.get_or_add_tcPr().append(shading)


def _add_docx_table(document: Document, rows: list[list[str]]) -> None:
    if not rows:
        return
    columns = max(len(row) for row in rows)
    table = document.add_table(rows=len(rows), cols=columns)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    for row_index, row in enumerate(rows):
        for col_index in range(columns):
            cell = table.cell(row_index, col_index)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell.text = row[col_index] if col_index < len(row) else ""
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_after = Pt(2)
                for run in paragraph.runs:
                    run.font.name = "Arial"
                    run.font.size = Pt(8)
                    if row_index == 0:
                        run.bold = True
            if row_index == 0:
                _set_cell_shading(cell, "DCE6F1")
    # Repeat the header row when the table spans multiple pages.
    tr_pr = table.rows[0]._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)
    document.add_paragraph()


def render_docx(
    title: str,
    sections: list[dict[str, Any]],
    project_title: str = "",
    article_type: str = "",
    generated_at: datetime | None = None,
) -> bytes:
    """Render saved sections with native Word tables for structured content."""
    _validate(title, sections)
    generated = generated_at or datetime.now(timezone.utc)
    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.8)
    section.bottom_margin = Inches(0.8)
    section.left_margin = Inches(0.75)
    section.right_margin = Inches(0.75)

    heading = document.add_heading(title.strip(), level=0)
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if project_title.strip():
        p = document.add_paragraph(project_title.strip())
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if article_type.strip():
        p = document.add_paragraph(article_type.replace("_", " ").title())
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if any(item.get("status") != "approved" for item in sections):
        p = document.add_paragraph("WORKING DRAFT — one or more sections are not approved")
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p = document.add_paragraph(f"Generated {generated.astimezone(timezone.utc).isoformat()}")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    document.add_page_break()

    for item in _ordered_sections(sections):
        document.add_heading(item["title"].strip(), level=1)
        blocks = _content_blocks(item.get("content", ""))
        if not blocks:
            document.add_paragraph("[Section not yet drafted]")
        for block in blocks:
            if block["type"] == "table":
                _add_docx_table(document, block["rows"])
            else:
                p = document.add_paragraph(block["text"])
                p.paragraph_format.space_after = Pt(7)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def _pdf_table(rows: list[list[str]], available_width: float, body_style: ParagraphStyle) -> Table:
    columns = max(len(row) for row in rows)
    normalized = [row + [""] * (columns - len(row)) for row in rows]
    data = []
    for row_index, row in enumerate(normalized):
        data.append([
            Paragraph(("<b>" + escape(cell) + "</b>") if row_index == 0 else escape(cell).replace("\n", "<br/>"), body_style)
            for cell in row
        ])
    widths = [available_width / columns] * columns
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT", splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DCE6F1")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#172B4D")),
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#8996A5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F7FA")]),
    ]))
    return table


def render_pdf(
    title: str,
    sections: list[dict[str, Any]],
    project_title: str = "",
    article_type: str = "",
    generated_at: datetime | None = None,
) -> bytes:
    """Render text and structured tables using ReportLab Platypus."""
    _validate(title, sections)
    generated = generated_at or datetime.now(timezone.utc)
    output = BytesIO()
    doc = SimpleDocTemplate(
        output, pagesize=A4, rightMargin=17 * mm, leftMargin=17 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm, title=title.strip(),
        author="Onyitech Research Workspace",
    )
    base = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ManuscriptTitle", parent=base["Title"], alignment=TA_CENTER,
        fontName="Helvetica-Bold", fontSize=18, leading=23, spaceAfter=14,
    )
    meta_style = ParagraphStyle(
        "ManuscriptMeta", parent=base["Normal"], alignment=TA_CENTER,
        fontSize=9, leading=13, textColor=colors.grey, spaceAfter=6,
    )
    section_style = ParagraphStyle(
        "ManuscriptSection", parent=base["Heading1"], fontSize=14,
        leading=18, spaceBefore=14, spaceAfter=8, keepWithNext=True,
    )
    body_style = ParagraphStyle(
        "ManuscriptBody", parent=base["BodyText"], fontSize=8.5,
        leading=12, spaceAfter=7, alignment=0, wordWrap="CJK",
    )

    story = [Spacer(1, 30 * mm), Paragraph(escape(title.strip()), title_style)]
    if project_title.strip():
        story.append(Paragraph(escape(project_title.strip()), meta_style))
    if article_type.strip():
        story.append(Paragraph(escape(article_type.replace("_", " ").title()), meta_style))
    if any(item.get("status") != "approved" for item in sections):
        story.append(Paragraph("WORKING DRAFT — one or more sections are not approved", meta_style))
    story.append(Paragraph(
        "Generated " + escape(generated.astimezone(timezone.utc).isoformat()), meta_style,
    ))
    story.append(PageBreak())

    available_width = A4[0] - 34 * mm
    for item in _ordered_sections(sections):
        story.append(Paragraph(escape(item["title"].strip()), section_style))
        blocks = _content_blocks(item.get("content", ""))
        if not blocks:
            blocks = [{"type": "text", "text": "[Section not yet drafted]"}]
        for block in blocks:
            if block["type"] == "table":
                story.append(_pdf_table(block["rows"], available_width, body_style))
                story.append(Spacer(1, 7))
            else:
                story.append(Paragraph(escape(block["text"]).replace("\n", "<br/>"), body_style))

    doc.build(story)
    return output.getvalue()
