"use client";

import { useEffect, useRef, type ClipboardEvent } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
};

const ALLOWED_TAGS = new Set([
  "P", "DIV", "BR", "H1", "H2", "H3", "H4", "STRONG", "B", "EM", "I",
  "U", "S", "UL", "OL", "LI", "BLOCKQUOTE", "SPAN", "TABLE", "THEAD",
  "TBODY", "TFOOT", "TR", "TH", "TD",
]);
const ALLOWED_STYLE = new Set([
  "text-align", "vertical-align", "width", "min-width", "max-width",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-collapse", "padding", "padding-top", "padding-right",
  "padding-bottom", "padding-left", "background-color", "color",
  "font-weight", "font-style", "text-decoration",
]);

function cleanStyle(styleText: string): string {
  const source = document.createElement("span");
  source.setAttribute("style", styleText);
  const kept: string[] = [];
  for (const property of Array.from(source.style)) {
    const value = source.style.getPropertyValue(property).trim();
    if (
      ALLOWED_STYLE.has(property) &&
      value &&
      !/url\s*\(|expression\s*\(|javascript:|@import/i.test(value)
    ) {
      kept.push(`${property}: ${value}`);
    }
  }
  return kept.join("; ");
}

function copySafeNode(node: Node, target: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    target.appendChild(document.createTextNode(node.textContent || ""));
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const tag = node.tagName;
  if (!ALLOWED_TAGS.has(tag)) {
    // Discard active/unknown elements but retain the readable contents of benign wrappers.
    if (!["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "MATH"].includes(tag)) {
      node.childNodes.forEach((child) => copySafeNode(child, target));
    }
    return;
  }
  const clean = document.createElement(tag.toLowerCase());
  for (const attribute of ["colspan", "rowspan", "scope"]) {
    const value = node.getAttribute(attribute);
    if (value && /^\d{1,3}$/.test(value) && attribute !== "scope") {
      clean.setAttribute(attribute, value);
    } else if (value && attribute === "scope" && ["row", "col", "rowgroup", "colgroup"].includes(value)) {
      clean.setAttribute(attribute, value);
    }
  }
  const style = cleanStyle(node.getAttribute("style") || "");
  if (style) clean.setAttribute("style", style);
  node.childNodes.forEach((child) => copySafeNode(child, clean));
  target.appendChild(clean);
}

function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const clean = document.createElement("div");
  parsed.body.childNodes.forEach((node) => copySafeNode(node, clean));
  return clean.innerHTML;
}

export default function RichManuscriptEditor({
  value,
  onChange,
  placeholder = "Write or paste manuscript content here...",
  maxLength = 250000,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>("");

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastEmitted.current) return;
    // Existing plain-text/Markdown sections remain readable; saved rich HTML is sanitised.
    if (/<\s*(?:table|p|div|h[1-4])\b/i.test(value)) {
      editor.innerHTML = sanitizeHtml(value);
    } else {
      editor.textContent = value;
    }
    lastEmitted.current = value;
  }, [value]);

  function handleInput() {
    const editor = editorRef.current;
    if (!editor) return;
    const next = editor.innerHTML;
    if (next.length > maxLength) {
      editor.innerHTML = lastEmitted.current;
      return;
    }
    lastEmitted.current = next;
    onChange(next);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const plain = event.clipboardData.getData("text/plain");
    const fragmentHtml = html ? sanitizeHtml(html) : document.createTextNode(plain).textContent || "";
    const holder = document.createElement("div");
    if (html) holder.innerHTML = fragmentHtml;
    else holder.textContent = fragmentHtml;
    const fragment = document.createDocumentFragment();
    while (holder.firstChild) fragment.appendChild(holder.firstChild);
    const selection = window.getSelection();
    if (selection && selection.rangeCount && editorRef.current?.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(fragment);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editorRef.current?.appendChild(fragment);
    }
    handleInput();
  }

  return (
    <div
      ref={editorRef}
      className="rich-manuscript-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Manuscript section content"
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={handleInput}
      onPaste={handlePaste}
      style={{
        minHeight: 360,
        maxHeight: 720,
        overflowY: "auto",
        padding: 14,
        border: "1px solid var(--border, #cbd5e1)",
        borderRadius: 8,
        background: "var(--surface, #fff)",
        color: "var(--foreground, #172033)",
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    />
  );
}
