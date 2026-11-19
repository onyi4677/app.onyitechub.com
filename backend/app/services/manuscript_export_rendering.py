"""Deterministic DOCX and PDF rendering for approved manuscript sections.

This layer renders only content already saved in a manuscript version. It does
not call an AI model, invent references, or read/write research source modules.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from io import BytesIO
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
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


def render_docx(
    title: str,
    sections: list[dict[str, Any]],
    project_title: str = "",
    article_type: str = "",
    generated_at: datetime | None = None,
) -> bytes:
    """Render a DOCX from saved section text; no source records are changed."""
    _validate(title, sections)
    generated = generated_at or datetime.now(timezone.utc)
    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.8)
    section.bottom_margin = Inches(0.8)
    section.left_margin = Inches(0.9)
    section.right_margin = Inches(0.9)

    heading = document.add_heading(title.strip(), level=0)
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if project_title.strip():
        p = document.add_paragraph(project_title.strip())
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if article_type.strip():
        p = document.add_paragraph(article_type.replace("_", " ").title())
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p = document.add_paragraph(f"Generated {generated.astimezone(timezone.utc).isoformat()}")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    document.add_page_break()

    for item in _ordered_sections(sections):
        document.add_heading(item["title"].strip(), level=1)
        body = item.get("content", "")
        paragraphs = [part.strip() for part in body.replace("\r\n", "\n").split("\n\n") if part.strip()]
        if not paragraphs:
            document.add_paragraph("[Section not yet drafted]")
        for paragraph_text in paragraphs:
            p = document.add_paragraph()
            p.paragraph_format.space_after = Pt(7)
            for index, line in enumerate(paragraph_text.split("\n")):
                if index:
                    p.add_run().add_break()
                p.add_run(line)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def render_pdf(
    title: str,
    sections: list[dict[str, Any]],
    project_title: str = "",
    article_type: str = "",
    generated_at: datetime | None = None,
) -> bytes:
    """Render a text-first PDF using ReportLab Platypus."""
    _validate(title, sections)
    generated = generated_at or datetime.now(timezone.utc)
    output = BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=22 * mm,
        leftMargin=22 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=title.strip(),
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
        "ManuscriptBody", parent=base["BodyText"], fontSize=10,
        leading=15, spaceAfter=8, alignment=0,
    )

    story = [Spacer(1, 35 * mm), Paragraph(escape(title.strip()), title_style)]
    if project_title.strip():
        story.append(Paragraph(escape(project_title.strip()), meta_style))
    if article_type.strip():
        story.append(Paragraph(escape(article_type.replace("_", " ").title()), meta_style))
    story.append(Paragraph(
        "Generated " + escape(generated.astimezone(timezone.utc).isoformat()),
        meta_style,
    ))
    story.append(PageBreak())

    for item in _ordered_sections(sections):
        section_flow = [Paragraph(escape(item["title"].strip()), section_style)]
        body = item.get("content", "")
        paragraphs = [part.strip() for part in body.replace("\r\n", "\n").split("\n\n") if part.strip()]
        if not paragraphs:
            paragraphs = ["[Section not yet drafted]"]
        for paragraph_text in paragraphs:
            safe_text = escape(paragraph_text).replace("\n", "<br/>")
            section_flow.append(Paragraph(safe_text, body_style))
        story.append(KeepTogether(section_flow) if len(section_flow) <= 2 else section_flow[0])
        if len(section_flow) > 2:
            story.extend(section_flow[1:])

    doc.build(story)
    return output.getvalue()
