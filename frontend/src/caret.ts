// Compute the pixel position of a character index inside a <textarea> by
// mirroring its text and styles into a hidden div and measuring a marker span.
// This is the standard technique for placing overlays (remote carets) on a
// textarea, which otherwise exposes no per-character geometry.
const COPIED_PROPS = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "wordSpacing",
  "tabSize",
] as const;

export interface CaretXY {
  left: number;
  top: number;
  height: number;
}

export function caretCoords(ta: HTMLTextAreaElement, index: number): CaretXY {
  const style = getComputedStyle(ta);
  const div = document.createElement("div");
  for (const prop of COPIED_PROPS) {
    (div.style as any)[prop] = (style as any)[prop];
  }
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.overflowWrap = "break-word";
  div.style.top = "0";
  div.style.left = "-9999px";
  div.style.height = "auto";

  div.textContent = ta.value.slice(0, index);
  const marker = document.createElement("span");
  // A non-empty marker so it has a measurable box even at the end of the text.
  marker.textContent = ta.value.slice(index) || ".";
  div.appendChild(marker);

  document.body.appendChild(div);
  const left = marker.offsetLeft;
  const top = marker.offsetTop;
  const height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  document.body.removeChild(div);

  return { left, top, height };
}
